import { dueLabel, handoffChain, historyOf, lastRejection, memberName, myLists, sourceOf, teamLists, whereNow } from "./logic";
import TaskActions from "./TaskActions";
import type { TeamTask, WorkContext } from "./types";

function Row({ task, ctx, overview }: { task: TeamTask; ctx: WorkContext; overview?: boolean }) {
  const history = historyOf(ctx.activities, task.id);
  const incoming = task.pending_owner_id === ctx.userId;
  const mine = task.owner_id === ctx.userId && !task.pending_owner_id && task.status === "open";
  const due = task.status === "open" && task.due_date ? dueLabel(task.due_date, ctx.today) : null;
  const rejection = lastRejection(history);
  return (
    <div className="task-row">
      <div className="task-main">
        <button type="button" className={`task-title ${task.status === "done" ? "task-done" : ""}`} onClick={() => ctx.openTask(task.id)}>
          {task.title}
        </button>
        <div className="task-meta">
          {overview ? (
            <span>
              {handoffChain(task, history)
                .map((id) => memberName(ctx.members, id))
                .join(" → ")}
            </span>
          ) : (
            mine && <span>{sourceOf(task, history, ctx.members)}</span>
          )}
          {(overview || (!mine && !incoming)) && <span className="where">{whereNow(task, ctx.members, ctx.userId)}</span>}
          {due && <span className={due.overdue ? "text-danger" : undefined}>{due.text}</span>}
        </div>
        {!overview && incoming && (
          <p className="row-note">
            {memberName(ctx.members, task.handoff_by)} 交给你{task.handoff_note ? `：${task.handoff_note}` : ""}
          </p>
        )}
        {!overview && mine && rejection && (
          <p className="row-note row-note-danger">
            {memberName(ctx.members, rejection.actor_id)} 退回：{rejection.detail.note}
          </p>
        )}
      </div>
      {!overview && <TaskActions task={task} ctx={ctx} scope="row" />}
    </div>
  );
}

function Group({
  title,
  tasks,
  ctx,
  tone,
  overview,
}: {
  title: string;
  tasks: TeamTask[];
  ctx: WorkContext;
  tone?: string;
  overview?: boolean;
}) {
  if (!tasks.length) return null;
  return (
    <section className={`group ${tone ?? ""}`} aria-label={title}>
      <h2>
        {title} <span className="count">{tasks.length}</span>
      </h2>
      <div className="task-list">
        {tasks.map((task) => (
          <Row key={task.id} task={task} ctx={ctx} overview={overview} />
        ))}
      </div>
    </section>
  );
}

function DoneGroup({ tasks, ctx, overview }: { tasks: TeamTask[]; ctx: WorkContext; overview?: boolean }) {
  if (!tasks.length) return null;
  return (
    <details className="group">
      <summary>
        已完成 <span className="count">{tasks.length}</span>
      </summary>
      <div className="task-list">
        {tasks.slice(0, 20).map((task) => (
          <Row key={task.id} task={task} ctx={ctx} overview={overview} />
        ))}
      </div>
    </details>
  );
}

export function MyTasks({ tasks, ctx }: { tasks: TeamTask[]; ctx: WorkContext }) {
  const lists = myLists(tasks, ctx.activities, ctx.userId);
  const empty = !lists.incoming.length && !lists.mine.length && !lists.passed.length;
  return (
    <>
      <Group title="等我接手" tasks={lists.incoming} ctx={ctx} tone="group-incoming" />
      <Group title="我的待办" tasks={lists.mine} ctx={ctx} />
      <Group title="我交出去的" tasks={lists.passed} ctx={ctx} tone="group-quiet" />
      {empty && <p className="empty">没有待办。在上面写第一条吧。</p>}
      <DoneGroup tasks={lists.done} ctx={ctx} />
    </>
  );
}

// 管理者看全队：每件事走到了谁手上。点开能看完整经过。
export function TeamTasks({ tasks, ctx }: { tasks: TeamTask[]; ctx: WorkContext }) {
  const lists = teamLists(tasks);
  return (
    <>
      <Group title="进行中" tasks={lists.open} ctx={ctx} overview />
      {!lists.open.length && <p className="empty">团队现在没有进行中的待办。</p>}
      <DoneGroup tasks={lists.done} ctx={ctx} overview />
    </>
  );
}
