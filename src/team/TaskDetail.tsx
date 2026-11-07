import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { dueLabel, isOpen } from "./logic";
import TaskActions from "./TaskActions";
import { memberName } from "./TaskRow";
import { statusLabels, type Member, type TaskActivity, type TeamTask, type WorkContext } from "./types";

const actionLabels: Record<string, string> = {
  created: "创建了事项",
  updated: "修改了内容",
  transition: "变更状态",
  comment: "补充跟进",
  handoff: "发起转交",
  handoff_accepted: "接收了转交",
  handoff_rejected: "退回了转交",
  handoff_withdrawn: "撤回了转交",
  return_ack: "确认了退回",
};

function describe({ action, detail }: TaskActivity, members: Member[]): string {
  const parts: string[] = [];
  if (action === "handoff" && typeof detail.to_owner === "string") parts.push(`转给 ${memberName(members, detail.to_owner)}`);
  if (typeof detail.to === "string") parts.push(statusLabels[detail.to as keyof typeof statusLabels] ?? "");
  for (const key of ["reason", "comment"]) if (typeof detail[key] === "string" && detail[key]) parts.push(String(detail[key]));
  return parts.filter(Boolean).join(" · ");
}

function EditForm({ task, ctx, onDone }: { task: TeamTask; ctx: WorkContext; onDone: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body);
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [followUpDate, setFollowUpDate] = useState(task.follow_up_date ?? "");
  const [nextAction, setNextAction] = useState(task.next_action);
  const [priority, setPriority] = useState(task.priority);
  const [baseVersion] = useState(task.version);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await ctx.execute("update_task", {
      taskId: task.id,
      expectedVersion: baseVersion,
      title: title.trim(),
      body,
      dueDate: dueDate || null,
      followUpDate: followUpDate || null,
      nextAction,
      priority,
    });
    if (result.ok) onDone();
  }
  return (
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      {baseVersion !== task.version && (
        <p className="form-error" role="alert">
          别人刚改过这件事。取消后重新打开，能看到最新内容。
        </p>
      )}
      <label>
        标题
        <input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        说明
        <textarea rows={3} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label>
        下一步
        <input maxLength={1000} value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="接下来具体要做什么" />
      </label>
      <div className="field-row">
        <label>
          截止日期
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label>
          下次跟进
          <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
        </label>
      </div>
      <label>
        重要程度
        <select value={priority} onChange={(e) => setPriority(e.target.value as TeamTask["priority"])}>
          <option value="normal">普通</option>
          <option value="high">关键事项</option>
          <option value="low">低</option>
        </select>
      </label>
      <div className="dialog-actions">
        <button type="button" onClick={onDone}>
          取消
        </button>
        <button className="primary" disabled={ctx.busy || !title.trim() || baseVersion !== task.version}>
          保存
        </button>
      </div>
    </form>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function TaskDetail({
  task,
  activities,
  ctx,
  onClose,
}: {
  task: TeamTask;
  activities: TaskActivity[];
  ctx: WorkContext;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const canEdit = ctx.role !== "member" || task.owner_id === ctx.userId || task.created_by === ctx.userId;
  const due = task.due_date ? dueLabel(task.due_date, ctx.today) : null;
  const history = activities.filter((activity) => activity.task_id === task.id).reverse();
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  async function addComment(event: FormEvent) {
    event.preventDefault();
    if ((await ctx.execute("comment_task", { taskId: task.id, comment: comment.trim() })).ok) setComment("");
  }
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" aria-label="事项详情">
        <div className="drawer-top">
          <span className={`tag status-${task.status}`}>{statusLabels[task.status]}</span>
          <button ref={closeRef} type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {editing ? (
          <EditForm task={task} ctx={ctx} onDone={() => setEditing(false)} />
        ) : (
          <>
            <h2 className="drawer-title">{task.title}</h2>
            {task.pending_owner_id && (
              <p className="callout">
                等 {memberName(ctx.members, task.pending_owner_id)} 接收{task.handoff_note ? `：${task.handoff_note}` : ""}
              </p>
            )}
            {task.returned_to && (
              <p className="callout callout-danger">
                {memberName(ctx.members, task.returned_by)} 退回：{task.returned_note}
              </p>
            )}
            <TaskActions task={task} ctx={ctx} scope="detail" />
            {task.next_action && (
              <p className="next-action">
                <span className="muted">下一步</span>
                {task.next_action}
              </p>
            )}
            <dl className="facts">
              <Fact label="负责人">{memberName(ctx.members, task.owner_id)}</Fact>
              <Fact label="发起人">{memberName(ctx.members, task.created_by)}</Fact>
              <Fact label="截止">
                {due ? <span className={due.overdue && isOpen(task) ? "text-danger" : undefined}>{task.due_date}</span> : "未设置"}
              </Fact>
              <Fact label="跟进">{task.follow_up_date ?? "未设置"}</Fact>
            </dl>
            {task.body && <p className="task-body">{task.body}</p>}
            {canEdit && (
              <button type="button" className="link" onClick={() => setEditing(true)}>
                编辑内容和日期
              </button>
            )}
          </>
        )}
        <section className="drawer-section">
          <h3>跟进和经过</h3>
          <form className="comment-form" onSubmit={(event) => void addComment(event)}>
            <input
              aria-label="补充跟进"
              maxLength={2000}
              placeholder="补充进展或沟通结果"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button disabled={ctx.busy || !comment.trim()}>添加</button>
          </form>
          <ol className="timeline">
            {history.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{memberName(ctx.members, item.actor_id)}</strong> {actionLabels[item.action] ?? item.action}
                </div>
                {describe(item, ctx.members) && <p>{describe(item, ctx.members)}</p>}
                <time>
                  {new Date(item.created_at).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </>
  );
}
