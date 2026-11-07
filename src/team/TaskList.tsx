import { useEffect, useState, type ReactNode } from "react";
import { dueLabel, handoffChain, historyOf, lastRejection, memberName, myLists, sourceOf, teamGroups, waitText, whereNow } from "./logic";
import type { TeamTask, WorkContext } from "./types";

function chainText(task: TeamTask, ctx: WorkContext) {
  const chain = handoffChain(task, historyOf(ctx.activities, task.id));
  return chain.length > 1 ? chain.map((id) => memberName(ctx.members, id)).join(" → ") : "自己写的";
}

function withWait(text: string, task: TeamTask, ctx: WorkContext) {
  const waiting = waitText(task, historyOf(ctx.activities, task.id));
  return waiting ? `${text} · ${waiting}` : text;
}

function Due({ task, ctx }: { task: TeamTask; ctx: WorkContext }) {
  if (task.status !== "open" || !task.due_date) return null;
  const due = dueLabel(task.due_date, ctx.today);
  return <span className={due.overdue ? "task-due text-danger" : "task-due"}>{due.text}</span>;
}

// 一行就是一个入口：点开在右边看流转和操作，行里不放按钮。
function Row({ task, ctx, meta, tone }: { task: TeamTask; ctx: WorkContext; meta: string; tone?: "where" | "wait" }) {
  return (
    <button type="button" className="task-row" aria-pressed={ctx.selectedId === task.id} onClick={() => ctx.openTask(task.id)}>
      <span className="task-main">
        <span className={task.status === "done" ? "task-title task-done" : "task-title"}>{task.title}</span>
        <span className={`task-meta ${tone ? `tone-${tone}` : ""}`}>{meta}</span>
      </span>
      <Due task={task} ctx={ctx} />
    </button>
  );
}

function Group({ title, count, tone, children }: { title: string; count: number; tone?: string; children: ReactNode }) {
  if (!count) return null;
  return (
    <section className="group" aria-label={title}>
      <h2 className={tone ? `tone-${tone}` : undefined}>
        {title} · {count}
      </h2>
      <div className="task-list">{children}</div>
    </section>
  );
}

function DoneGroup({ tasks, ctx }: { tasks: TeamTask[]; ctx: WorkContext }) {
  const [open, setOpen] = useState(false);
  const selectedDone = tasks.some((task) => task.id === ctx.selectedId);
  // 刚完成的事还开着流转，要让它在列表里看得到。
  useEffect(() => {
    if (selectedDone) setOpen(true);
  }, [selectedDone]);
  if (!tasks.length) return null;
  return (
    <section className="group" aria-label="已完成">
      <button type="button" className="done-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} 已完成 · {tasks.length}
      </button>
      {open && (
        <div className="task-list">
          {tasks.slice(0, 20).map((task) => (
            <Row key={task.id} task={task} ctx={ctx} meta={chainText(task, ctx)} />
          ))}
        </div>
      )}
    </section>
  );
}

// 只有等我接手的卡片带按钮：这是别人在等我做的决定。
function IncomingCard({ task, ctx }: { task: TeamTask; ctx: WorkContext }) {
  const from = memberName(ctx.members, task.handoff_by);
  const due = task.due_date ? dueLabel(task.due_date, ctx.today).text : "没有截止日期";
  return (
    <article className="incoming-card" data-selected={ctx.selectedId === task.id}>
      <button type="button" className="incoming-open" onClick={() => ctx.openTask(task.id)}>
        <span className="incoming-from">
          {from} 交给你 · {due}
        </span>
        <span className="incoming-title">{task.title}</span>
        <span className="incoming-note">{task.handoff_note || "没有写说明"}</span>
      </button>
      <div className="incoming-actions">
        <button
          type="button"
          className="primary"
          disabled={ctx.busy}
          onClick={() => void ctx.execute("accept_task", { taskId: task.id }, "接手了。这件事现在在你手上。")}
        >
          接手
        </button>
        <button type="button" disabled={ctx.busy} onClick={() => ctx.openTask(task.id, "reject")}>
          退回
        </button>
      </div>
    </article>
  );
}

function mineMeta(task: TeamTask, ctx: WorkContext) {
  const history = historyOf(ctx.activities, task.id);
  const rejection = lastRejection(history);
  if (rejection) return { meta: `${memberName(ctx.members, rejection.actor_id)} 退回：${rejection.detail.note}`, tone: "wait" as const };
  return { meta: sourceOf(task, history, ctx.members) };
}

export function MyTasks({ tasks, ctx }: { tasks: TeamTask[]; ctx: WorkContext }) {
  const lists = myLists(tasks, ctx.activities, ctx.userId);
  const empty = !lists.incoming.length && !lists.mine.length && !lists.passed.length;
  return (
    <>
      {lists.incoming.length > 0 && (
        <section className="group" aria-label="等我接手">
          <h2 className="tone-wait">等我接手 · {lists.incoming.length}</h2>
          {lists.incoming.map((task) => (
            <IncomingCard key={task.id} task={task} ctx={ctx} />
          ))}
        </section>
      )}
      <Group title="我手上" count={lists.mine.length}>
        {lists.mine.map((task) => (
          <Row key={task.id} task={task} ctx={ctx} {...mineMeta(task, ctx)} />
        ))}
      </Group>
      <Group title="我交出去的" count={lists.passed.length}>
        {lists.passed.map((task) => (
          <Row key={task.id} task={task} ctx={ctx} meta={withWait(whereNow(task, ctx.members, ctx.userId), task, ctx)} tone="where" />
        ))}
      </Group>
      {empty && <p className="empty">手上没有待办。在上面写第一条吧。</p>}
      <DoneGroup tasks={lists.done} ctx={ctx} />
    </>
  );
}

// 管理者看全队：先看卡在交接路上的，再按人看各自手上的。
export function TeamTasks({ tasks, ctx }: { tasks: TeamTask[]; ctx: WorkContext }) {
  const groups = teamGroups(tasks, ctx.members);
  return (
    <>
      <Group title="交接中，等人接手" count={groups.moving.length} tone="wait">
        {groups.moving.map((task) => (
          <Row
            key={task.id}
            task={task}
            ctx={ctx}
            meta={withWait(`${memberName(ctx.members, task.handoff_by)} → ${memberName(ctx.members, task.pending_owner_id)}`, task, ctx)}
            tone="wait"
          />
        ))}
      </Group>
      {groups.holders.map(({ member, tasks: held }) => (
        <Group key={member.user_id} title={`${member.display_name}手上`} count={held.length}>
          {held.map((task) => (
            <Row key={task.id} task={task} ctx={ctx} meta={chainText(task, ctx)} />
          ))}
        </Group>
      ))}
      {!groups.moving.length && !groups.holders.length && <p className="empty">团队现在没有进行中的待办。</p>}
      <DoneGroup tasks={groups.done} ctx={ctx} />
    </>
  );
}
