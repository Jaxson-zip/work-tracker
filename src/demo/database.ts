import type { PGlite } from "@electric-sql/pglite";
import type { GroupMessage } from "../team/types";

// 演示和正式环境跑同一份迁移，只有 auth 模式是这里补的（正式环境由 Supabase 提供）。
export const demoUsers = [
  { id: "11111111-1111-4111-8111-111111111111", name: "林晓" },
  { id: "22222222-2222-4222-8222-222222222222", name: "陈晨" },
  { id: "33333333-3333-4333-8333-333333333333", name: "周宁" },
];

function dayOffset(days: number) {
  return new Date(Date.now() + days * 86400000).toLocaleDateString("en-CA");
}

export async function openDemoDatabase(db: PGlite, migrations: string[]) {
  let queue: Promise<unknown> = Promise.resolve();
  function inOrder<T>(work: () => Promise<T>) {
    const result = queue.then(work);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function command(userId: string, action: string, payload: Record<string, unknown>) {
    if (!demoUsers.some((user) => user.id === userId)) throw new Error("Unknown demo identity");
    return inOrder(() =>
      db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
        await tx.exec("set local role authenticated");
        const response = await tx.query<{ result: any }>("select public.wt_command($1,$2::jsonb) as result", [
          action,
          JSON.stringify(payload),
        ]);
        return response.rows[0].result;
      }),
    );
  }

  // 演示版没有发送服务：把刚入队的群消息取出来给页面看，内容就是真实发送用的那一份。
  function takeMessages() {
    return inOrder(async () => {
      const response = await db.query<GroupMessage>(`with taken as (
          update public.wt_outbox set status='sent',sent_at=now() where status='pending' returning payload,created_at
        )
        select t.payload->>'message' as message,
          (select coalesce(jsonb_agg(public.wt_name(id::uuid)),'[]') from jsonb_array_elements_text(t.payload->'mention_ids') id) as mentions
        from taken t order by t.created_at`);
      return response.rows;
    });
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

    // 交出去两天没人接：管理者应该一眼看到它卡住了
    const coupon = await create(chen, { title: "优惠券接口对接", dueDate: dayOffset(4) });
    await handoff(chen, coupon, zhou, "优惠券接口写完了，请测试满减和过期两种情况。");

    // 演示数据是一次写入的，把时间摊开，流转才像真实发生过。
    await db.exec(`update public.wt_activities a
      set created_at = now() - (b.rn * case when t.title = '优惠券接口对接' then interval '2 days' else interval '7 hours' end)
      from (select id, row_number() over (partition by task_id order by seq desc) as rn from public.wt_activities) b, public.wt_tasks t
      where b.id = a.id and t.id = a.task_id`);
  }

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
  for (const migration of migrations) await db.exec(migration);
  await seedStory();
  await takeMessages();
  return { command, takeMessages, close: () => db.close() };
}
