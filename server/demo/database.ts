import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const demoUsers = [
  { id: "11111111-1111-4111-8111-111111111111", name: "林晓" },
  { id: "22222222-2222-4222-8222-222222222222", name: "陈晨" },
  { id: "33333333-3333-4333-8333-333333333333", name: "周宁" },
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
    await seedStory();
  }
  // 演示场景：林晓做前端（也是团队管理者），陈晨做后端，周宁做测试。
  async function seedStory() {
    const [lin, chen, zhou] = demoUsers.map((user) => user.id);
    const workspaceId = (await command(lin, "create_workspace", { name: "订单系统项目组" })).id;
    for (const user of [chen, zhou]) {
      const invite = await command(lin, "invite", { workspaceId });
      await command(user, "join_workspace", { code: invite.code });
    }
    const create = (actor: string, fields: Record<string, unknown>) => command(actor, "create_task", { workspaceId, ...fields });
    const act = (actor: string, action: string, fields: Record<string, unknown>) => command(actor, action, { workspaceId, ...fields });
    const handoff = (actor: string, task: { id: string; version: number }, toUserId: string, note: string) =>
      act(actor, "handoff_task", { taskId: task.id, expectedVersion: task.version, toUserId, note });

    // 前端 → 后端 → 又交回前端，等林晓接手
    const orders = await create(lin, { title: "订单列表接口联调", dueDate: dayOffset(1) });
    await handoff(lin, orders, chen, "页面做完了，先用的 Mock。需要后端提供分页和订单状态字段。");
    const atBackend = await act(chen, "accept_task", { taskId: orders.id });
    await handoff(chen, atBackend, lin, "接口已发到测试环境，文档在项目 wiki，请前端切到真实接口联调。");

    // 交出去被退回，事情还在林晓手上
    const payment = await create(lin, { title: "支付回调联调", dueDate: dayOffset(3) });
    await handoff(lin, payment, zhou, "前端支付页做完了，请帮忙测回调流程。");
    await act(zhou, "reject_task", { taskId: payment.id, note: "回调地址还没配，测不了。请先找陈晨确认。" });

    // 林晓自己写的
    await create(lin, { title: "登录页改版", dueDate: dayOffset(-2) });
    await create(lin, { title: "整理下周发布清单", dueDate: dayOffset(0) });

    // 林晓交出去，已被后端接手
    const speed = await create(lin, { title: "首页加载优化", dueDate: dayOffset(5) });
    await handoff(lin, speed, chen, "前端已做懒加载，接口响应还要优化。");
    await act(chen, "accept_task", { taskId: speed.id });

    // 走完全程：前端 → 后端 → 测试 → 完成
    const signup = await create(lin, { title: "注册流程联调" });
    await handoff(lin, signup, chen, "注册页面已完成，请对接短信验证码接口。");
    const signupBackend = await act(chen, "accept_task", { taskId: signup.id });
    await handoff(chen, signupBackend, zhou, "接口联调通过，请测试。");
    const signupTest = await act(zhou, "accept_task", { taskId: signup.id });
    await act(zhou, "complete_task", { taskId: signup.id, expectedVersion: signupTest.version });

    // 和林晓无关的事，只有管理者在全队视图里能看到
    const permission = await create(chen, { title: "用户权限接口", dueDate: dayOffset(2) });
    await handoff(chen, permission, zhou, "接口写完了，请测试各角色的权限。");
    await act(zhou, "accept_task", { taskId: permission.id });
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
