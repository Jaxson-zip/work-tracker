import { useEffect, useRef, useState, type FormEvent } from "react";
import { historyOf, memberName, rowActions, taskActions, type TaskAction } from "./logic";
import type { TeamTask, WorkContext } from "./types";

const labels: Record<TaskAction, string> = {
  accept: "接手",
  reject: "退回",
  withdraw: "撤回",
  complete: "完成",
  handoff: "交给下一位",
  reopen: "重新打开",
  delete: "删除",
};
const primaryActions: TaskAction[] = ["accept", "complete"];

// 交接和退回都要写说明，共用一个弹窗。
function NoteDialog({ task, mode, ctx, onClose }: { task: TeamTask; mode: "handoff" | "reject"; ctx: WorkContext; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [toUserId, setToUserId] = useState("");
  const handoff = mode === "handoff";
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = handoff
      ? await ctx.execute("handoff_task", { taskId: task.id, expectedVersion: task.version, toUserId, note: note.trim() })
      : await ctx.execute("reject_task", { taskId: task.id, note: note.trim() });
    if (done) onClose();
  }
  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <h2>{handoff ? `交接「${task.title}」` : `退回「${task.title}」`}</h2>
        {handoff && (
          <label>
            交给谁
            <select required autoFocus value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
              <option value="" disabled>
                请选择
              </option>
              {ctx.members
                .filter((member) => member.user_id !== task.owner_id)
                .map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {memberName(ctx.members, member.user_id)}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          {handoff ? "交接说明" : "退回原因"}
          <textarea
            rows={4}
            required
            maxLength={1000}
            autoFocus={!handoff}
            placeholder={handoff ? "做到哪了、对方要做什么、有什么要注意的" : "为什么接不了，需要对方先做什么"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {handoff && <p className="muted">对方点“接手”之前，这件事还算在当前负责人手上。</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={ctx.busy || !note.trim() || (handoff && !toUserId)}>
            {handoff ? "交出去" : "退回"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function TaskActions({ task, ctx, scope }: { task: TeamTask; ctx: WorkContext; scope: "row" | "detail" }) {
  const [dialog, setDialog] = useState<"handoff" | "reject" | null>(null);
  const available = scope === "row" ? rowActions : taskActions;
  const actions = available(task, historyOf(ctx.activities, task.id), ctx.userId, ctx.role);
  const versioned = { taskId: task.id, expectedVersion: task.version };

  function run(action: TaskAction) {
    if (action === "handoff" || action === "reject") setDialog(action);
    else if (action === "accept") void ctx.execute("accept_task", { taskId: task.id });
    else if (action === "withdraw") void ctx.execute("withdraw_task", { taskId: task.id });
    else if (action === "complete") void ctx.execute("complete_task", versioned);
    else if (action === "reopen") void ctx.execute("reopen_task", versioned);
    else if (window.confirm(`删除「${task.title}」？`)) void ctx.execute("delete_task", { taskId: task.id });
  }

  if (!actions.length) return null;
  return (
    <div className="task-actions">
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          className={primaryActions.includes(action) ? "primary" : action === "delete" ? "danger" : undefined}
          disabled={ctx.busy}
          onClick={() => run(action)}
        >
          {labels[action]}
        </button>
      ))}
      {dialog && <NoteDialog task={task} mode={dialog} ctx={ctx} onClose={() => setDialog(null)} />}
    </div>
  );
}
