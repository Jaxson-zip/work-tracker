import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const demoUsers = [
  { id: "11111111-1111-4111-8111-111111111111", name: "林晓", department: "产品部" },
  { id: "22222222-2222-4222-8222-222222222222", name: "陈晨", department: "运营部" },
  { id: "33333333-3333-4333-8333-333333333333", name: "周宁", department: "技术部" },
];

function dayOffset(days: number) {
  return new Date(Date.now() + days * 86400000).toLocaleDateString("en-CA");
}

export async function createDemoDatabase(dataDir?: string) {
  const db = new PGlite(dataDir);
  // This auth shim exists ONLY in the opt-in loopback development server.
  // Production uses Supabase Auth. No user-controlled SQL reaches this database.
  let queue = Promise.resolve();
  async function command(userId: string, action: string, payload: Record<string, unknown>) {
    if (!demoUsers.some((user) => user.id === userId)) throw new Error("Unknown demo identity");
    const result = queue.then(async () => {
      return db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
        await tx.exec("set local role authenticated");
        const response = await tx.query<{ result: any }>("select public.wt_command($1,$2::jsonb) as result", [
          action,
          JSON.stringify(payload),
        ]);
        return response.rows[0].result;
      });
    });
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function seed() {
    await db.exec(`create schema auth; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role;`);
    for (let i = 0; i < demoUsers.length; i++) {
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
        demoUsers[i].id,
        `demo${i}@example.test`,
        JSON.stringify({ display_name: demoUsers[i].name }),
      ]);
    }
    const dir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
    for (const file of (await readdir(dir)).sort()) await db.exec(await readFile(join(dir, file), "utf8"));

    const [lin, chen, zhou] = demoUsers.map((user) => user.id);
    const workspace = await command(lin, "create_workspace", { name: "产品协作组", department: demoUsers[0].department });
    const workspaceId = workspace.id;
    for (const [index, role] of [
      [1, "member"],
      [2, "admin"],
    ] as const) {
      const invite = await command(lin, "invite", { workspaceId, role });
      await command(demoUsers[index].id, "join_workspace", { code: invite.code, department: demoUsers[index].department });
    }
    const task = (actor: string, fields: Record<string, unknown>) => command(actor, "create_task", { workspaceId, ...fields });

    await task(lin, {
      title: "确认客户反馈，落实本周交付",
      body: "确认交付范围、负责人和最后验收口径。",
      ownerId: lin,
      priority: "high",
      dueDate: dayOffset(0),
      nextAction: "联系客户确认三个待定条款",
    });
    await task(lin, { title: "更新下季度产品路线图", ownerId: lin, dueDate: dayOffset(5), nextAction: "汇总各部门需求" });
    await task(lin, { title: "提交上周复盘", ownerId: lin, dueDate: dayOffset(-2) });
    // 别人转给林晓，等待接收
    await task(chen, {
      title: "供应商合同续签",
      body: "合同月底到期，需要法务复核。",
      ownerId: lin,
      dueDate: dayOffset(3),
      handoffNote: "我下周出差，请你跟进",
      nextAction: "把修改稿发给法务",
    });
    // 林晓转给周宁，被退回
    const returned = await task(lin, { title: "排查线上导出失败", ownerId: zhou, handoffNote: "客户在催，麻烦看一下" });
    await command(zhou, "reject_transfer", { workspaceId, taskId: returned.id, reason: "这周在做版本发布，请先找陈晨确认复现步骤" });
    // 林晓转给陈晨，已接收并提交，等林晓验收
    const meeting = await task(lin, {
      title: "整理项目会议纪要",
      body: "把会议结论转成可跟进的事项。",
      ownerId: chen,
      dueDate: dayOffset(1),
      nextAction: "补全行动项",
    });
    const accepted = await command(chen, "accept_transfer", { workspaceId, taskId: meeting.id });
    await command(chen, "transition_task", { workspaceId, taskId: meeting.id, expectedVersion: accepted.version, status: "review" });
    // 其他同事的事项，在团队视图里看到
    await task(zhou, { title: "灰度发布新版本", ownerId: zhou, priority: "high", dueDate: dayOffset(1) });
    const blocked = await task(chen, { title: "筹备客户培训", ownerId: chen, dueDate: dayOffset(4) });
    const started = await command(chen, "transition_task", {
      workspaceId,
      taskId: blocked.id,
      expectedVersion: blocked.version,
      status: "in_progress",
    });
    await command(chen, "transition_task", {
      workspaceId,
      taskId: blocked.id,
      expectedVersion: started.version,
      status: "blocked",
      reason: "等客户确认场地",
    });
    await command(lin, "create_record", {
      workspaceId,
      title: "客户希望下周看到完整交付方案",
      body: "沟通已完成，后续需要整理方案并复核。可以转成待办。",
      occurredOn: dayOffset(0),
      important: true,
    });
    await command(chen, "create_record", {
      workspaceId,
      title: "运营周会：活动延期到月底",
      body: "素材还没到位，活动顺延两周。",
      occurredOn: dayOffset(-1),
    });
  }
  try {
    const exists = await db.query<{ name: string | null }>("select to_regclass('public.wt_workspaces')::text as name");
    if (!exists.rows[0].name) await seed();
    return { command, close: () => db.close() };
  } catch (error) {
    await db.close();
    throw error;
  }
}
