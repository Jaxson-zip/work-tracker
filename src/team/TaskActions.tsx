import { useState, type FormEvent } from "react";
import { historyOf, memberName, taskActions, whereNow } from "./logic";
import PersonPicker from "./PersonPicker";
import type { TaskForm, TeamTask, WorkContext } from "./types";

function HandoffForm({ task, ctx, onClose }: { task: TeamTask; ctx: WorkContext; onClose: () => void }) {
  const [toUserId, setToUserId] = useState("");
  const [note, setNote] = useState("");
  const toName = memberName(ctx.members, toUserId);
  const holder = task.owner_id === ctx.userId ? "你" : memberName(ctx.members, task.owner_id);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await ctx.execute(
      "handoff_task",
      { taskId: task.id, expectedVersion: task.version, toUserId, note: note.trim() },
      `已交给${toName}。对方接手之前，这件事还算在${holder}手上。`,
    );
    if (done) onClose();
  }
  return (
    <form className="flow-form" onSubmit={(event) => void submit(event)}>
      <PersonPicker
        label="交给谁"
        value={toUserId}
        onChange={setToUserId}
        options={ctx.members
          .filter((member) => member.user_id !== task.owner_id)
          .map((member) => ({ id: member.user_id, label: member.display_name }))}
      />
      <label>
        交接说明
        <textarea
          className="field-soft"
          rows={3}
          maxLength={1000}
          placeholder="做到哪了、对方要做什么、有什么要注意的"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="flow-actions">
        <button className="primary" disabled={ctx.busy || !toUserId || !note.trim()}>
          {toUserId ? `交给${toName}` : "交出去"}
        </button>
        <button type="button" onClick={onClose}>
          取消
        </button>
      </div>
    </form>
  );
}

function RejectForm({ task, ctx, onClose }: { task: TeamTask; ctx: WorkContext; onClose: () => void }) {
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await ctx.execute("reject_task", { taskId: task.id, note: note.trim() }, "已退回，事情还在原来的人手上。");
    if (done) onClose();
  }
  return (
    <form className="flow-form flow-form-wait" onSubmit={(event) => void submit(event)}>
      <label>
        退回原因
        <textarea
          className="field-soft"
          rows={3}
          maxLength={1000}
          autoFocus
          placeholder="为什么接不了，需要对方先做什么"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="flow-actions">
        <button className="wait" disabled={ctx.busy || !note.trim()}>
          退回
        </button>
        <button type="button" onClick={onClose}>
          取消
        </button>
      </div>
    </form>
  );
}

// 操作都在流转面板里。管理者替别人处理只是兜底（比如有人要离开团队），用不显眼的文字链接。
export default function TaskActions({
  task,
  ctx,
  form,
  onForm,
}: {
  task: TeamTask;
  ctx: WorkContext;
  form: TaskForm;
  onForm: (form: TaskForm) => void;
}) {
  const actions = taskActions(task, historyOf(ctx.activities, task.id), ctx.userId, ctx.role);
  const has = (action: (typeof actions)[number]) => actions.includes(action);
  const versioned = { taskId: task.id, expectedVersion: task.version };
  const closeForm = () => onForm(null);
  const myHandoff = task.owner_id === ctx.userId || task.handoff_by === ctx.userId;
  const canHandOffForOther = has("handoff") && !has("complete");
  const canWithdrawForOther = has("withdraw") && !myHandoff;
  const onlyWatching = !has("accept") && !has("complete") && !has("reopen") && !(has("withdraw") && myHandoff);

  function remove() {
    if (window.confirm(`删除「${task.title}」？`)) void ctx.execute("delete_task", { taskId: task.id }, "已删除。");
  }

  return (
    <>
      {has("accept") && (
        <div className="flow-actions">
          <button
            type="button"
            className="primary wide"
            disabled={ctx.busy}
            onClick={() => void ctx.execute("accept_task", { taskId: task.id }, "接手了。这件事现在在你手上。")}
          >
            接手
          </button>
          <button type="button" disabled={ctx.busy} onClick={() => onForm("reject")}>
            退回
          </button>
        </div>
      )}
      {has("complete") && form !== "handoff" && (
        <div className="flow-actions">
          <button type="button" className="primary wide" disabled={ctx.busy} onClick={() => onForm("handoff")}>
            做完了，交给下一位
          </button>
          <button type="button" disabled={ctx.busy} onClick={() => void ctx.execute("complete_task", versioned, "这件事结束了。")}>
            到此结束
          </button>
          {has("delete") && (
            <button type="button" className="link quiet" disabled={ctx.busy} onClick={remove}>
              删除
            </button>
          )}
        </div>
      )}
      {has("withdraw") && myHandoff && (
        <div className="flow-actions">
          <button
            type="button"
            disabled={ctx.busy}
            onClick={() => void ctx.execute("withdraw_task", { taskId: task.id }, "已撤回，事情回到负责人手上。")}
          >
            撤回交接
          </button>
          <span className="muted">
            对方接手之前，这件事还算在{task.owner_id === ctx.userId ? "你" : memberName(ctx.members, task.owner_id)}手上。
          </span>
        </div>
      )}
      {has("reopen") && (
        <div className="flow-actions">
          <button type="button" disabled={ctx.busy} onClick={() => void ctx.execute("reopen_task", versioned, "已重新打开。")}>
            重新打开
          </button>
        </div>
      )}
      {onlyWatching && (
        <p className="flow-watch">
          {task.status === "open" ? `这件事${whereNow(task, ctx.members, ctx.userId)}，这里只看流转。` : "这件事已经结束，这里只看流转。"}
          {canHandOffForOther && form !== "handoff" && (
            <button type="button" className="link quiet" disabled={ctx.busy} onClick={() => onForm("handoff")}>
              代为交接
            </button>
          )}
          {canWithdrawForOther && (
            <button
              type="button"
              className="link quiet"
              disabled={ctx.busy}
              onClick={() => void ctx.execute("withdraw_task", { taskId: task.id }, "已撤回，事情回到负责人手上。")}
            >
              代为撤回
            </button>
          )}
        </p>
      )}
      {form === "handoff" && has("handoff") && <HandoffForm task={task} ctx={ctx} onClose={closeForm} />}
      {form === "reject" && has("reject") && <RejectForm task={task} ctx={ctx} onClose={closeForm} />}
    </>
  );
}
