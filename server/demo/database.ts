import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
export const demoUsers = [
  { id: "11111111-1111-4111-8111-111111111111", name: "林晓 · 所有者" },
  { id: "22222222-2222-4222-8222-222222222222", name: "陈晨 · 成员" },
  { id: "33333333-3333-4333-8333-333333333333", name: "周宁 · 管理员" },
];
export async function createDemoDatabase(dataDir?: string) {
  const db = new PGlite(dataDir);
  // This auth shim exists ONLY in the opt-in loopback development server.
  // Production uses Supabase Auth. No user-controlled SQL reaches this database.
  let queue = Promise.resolve();
  async function command(userId: string, action: string, payload: Record<string, unknown>) {
    if (!demoUsers.some(user => user.id === userId)) throw new Error("Unknown demo identity");
    const result = queue.then(async () => {
      return db.transaction(async tx => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
        await tx.exec("set local role authenticated");
        const response = await tx.query<{ result: any }>("select public.wt_command($1,$2::jsonb) as result", [action, JSON.stringify(payload)]);
        return response.rows[0].result;
      });
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  try {
    const exists = await db.query<{ name: string | null }>("select to_regclass('public.wt_workspaces')::text as name");
    if (!exists.rows[0].name) {
      await db.exec(`create schema auth; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        create table auth.users(id uuid primary key,email text);
        create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;`);
      for (let i = 0; i < demoUsers.length; i++) await db.query("insert into auth.users values($1,$2)", [demoUsers[i].id, `demo${i}@example.test`]);
      await db.exec(await readFile(new URL("../../supabase/migrations/202611060001_work_tracker.sql", import.meta.url), "utf8"));
      const workspace = await command(demoUsers[0].id, "create_workspace", { name: "产品协作组 · 本地演示" });
      await command(demoUsers[0].id, "update_profile", { displayName: "林晓" });
      for (let i = 1; i < demoUsers.length; i++) {
        const invite = await command(demoUsers[0].id, "invite", { workspaceId: workspace.id, role: i === 2 ? "admin" : "member" });
        await command(demoUsers[i].id, "join_workspace", { code: invite.code });
        await command(demoUsers[i].id, "update_profile", { displayName: i === 1 ? "陈晨" : "周宁" });
      }
      const today = new Date().toLocaleDateString("en-CA");
      const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA");
      await command(demoUsers[0].id, "create_task", { workspaceId: workspace.id, title: "确认客户反馈，落实本周交付", body: "演示数据：确认交付范围、负责人和最后验收口径。", ownerId: demoUsers[0].id, priority: "high", dueDate: today, followUpDate: today, nextAction: "联系客户确认三个待定条款" });
      const review = await command(demoUsers[0].id, "create_task", { workspaceId: workspace.id, title: "整理项目会议纪要", body: "演示数据：将会议结论转成可跟进的事项。", ownerId: demoUsers[1].id, dueDate: yesterday, nextAction: "补全行动项并提交验收" });
      await command(demoUsers[1].id, "transition_task", { workspaceId: workspace.id, taskId: review.id, expectedVersion: 1, status: "in_progress" });
      await command(demoUsers[1].id, "transition_task", { workspaceId: workspace.id, taskId: review.id, expectedVersion: 2, status: "review" });
      await command(demoUsers[0].id, "create_record", { workspaceId: workspace.id, title: "客户希望下周看到完整交付方案", body: "演示记录：沟通已完成，后续需要陈晨整理方案、周宁复核。可点击右侧转成待办。", occurredOn: today, important: true });
    }
    return { command, close: () => db.close() };
  } catch (error) { await db.close(); throw error; }
}
