import { canEdit, chainNodes, dueLabel, historyOf, memberName, sourceOf, waitText, whereNow } from "./logic";
import TaskActions from "./TaskActions";
import type { Member, TaskActivity, TaskForm, TeamTask, WorkContext } from "./types";

const chainTags = { past: "经手", now: "现在在这", wait: "等接手", done: "完成" };

function Chain({ task, history, ctx }: { task: TeamTask; history: TaskActivity[]; ctx: WorkContext }) {
  return (
    <ol className="chain" aria-label="交接链">
      {chainNodes(task, history).map((node, index) => {
        const name = memberName(ctx.members, node.id);
        return (
          <li key={`${node.id}-${index}`} className="chain-step">
            {index > 0 && (
              <span className="chain-arrow" aria-hidden="true">
                →
              </span>
            )}
            <span className={`chain-node chain-${node.state}`}>
              <span className="chain-avatar">{name.slice(-1)}</span>
              <span className="chain-name">{node.id === ctx.userId ? `${name}（你）` : name}</span>
              <span className="chain-tag">{chainTags[node.state]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function describeEdit(actor: string, detail: TaskActivity["detail"]): string {
  const changes: string[] = [];
  if (detail.title) changes.push(`把标题改成「${detail.title}」`);
  if ("due" in detail) changes.push(detail.due ? `把截止日期改成 ${detail.due}` : "取消了截止日期");
  return `${actor} ${changes.join("，")}`;
}

function describe({ action, actor_id, detail }: TaskActivity, members: Member[]): string {
  const actor = memberName(members, actor_id);
  if (action === "edited") return describeEdit(actor, detail);
  if (action === "created") return `${actor} 写了这条待办`;
  if (action === "handoff") return `${actor} 交给 ${memberName(members, detail.to)}`;
  if (action === "accepted") return `${actor} 接手了`;
  if (action === "rejected") return `${actor} 退回了`;
  if (action === "withdrawn") return `${actor} 撤回了交接`;
  if (action === "done") return `${actor} 完成了`;
  return `${actor} 重新打开了`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Timeline({ history, members }: { history: TaskActivity[]; members: Member[] }) {
  return (
    <section className="flow-history" aria-label="流转经过">
      <h2>流转经过</h2>
      <ol className="timeline">
        {history.map((item) => (
          <li key={item.id} className={`timeline-item timeline-${item.action}`}>
            <span className="timeline-dot" aria-hidden="true" />
            <div className="timeline-body">
              <div className="timeline-head">
                <span className="timeline-text">{describe(item, members)}</span>
                <time>{formatTime(item.created_at)}</time>
              </div>
              {item.detail.note && <p className="timeline-note">{item.detail.note}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// 右边常驻的流转：谁写的、交给过谁、现在在哪、每一步说了什么，能做的操作也都在这。
export default function TaskFlow({
  task,
  ctx,
  form,
  onForm,
  onBack,
}: {
  task: TeamTask | null;
  ctx: WorkContext;
  form: TaskForm;
  onForm: (form: TaskForm) => void;
  onBack: () => void;
}) {
  const back = (
    <button type="button" className="link flow-back" onClick={onBack}>
      ← 返回
    </button>
  );
  if (!task) {
    return (
      <main className="pane-flow">
        {back}
        <p className="empty">点左边一条待办，这里看它怎么流转。</p>
      </main>
    );
  }
  const history = historyOf(ctx.activities, task.id);
  const due = task.status === "open" && task.due_date ? dueLabel(task.due_date, ctx.today) : null;
  const tone = task.pending_owner_id ? "wait" : task.status === "open" ? "where" : "";
  const waiting = waitText(task, history);
  return (
    <main className="pane-flow">
      {back}
      <div className="flow-head">
        <span className={`flow-where tone-${tone}`}>
          {whereNow(task, ctx.members, ctx.userId)}
          {waiting && ` · ${waiting}`}
        </span>
        <h1>{task.title}</h1>
        <span className="flow-source">
          {sourceOf(task, history, ctx.members)}
          {due && (
            <>
              {" · "}
              <span className={due.overdue ? "text-danger" : undefined}>{due.text}</span>
            </>
          )}
          {canEdit(task, ctx.userId, ctx.role) && form !== "edit" && (
            <button type="button" className="link quiet" onClick={() => onForm("edit")}>
              修改
            </button>
          )}
        </span>
      </div>
      <Chain task={task} history={history} ctx={ctx} />
      <TaskActions task={task} ctx={ctx} form={form} onForm={onForm} />
      <Timeline history={history} members={ctx.members} />
    </main>
  );
}
