import { useEffect, useRef, useState, type FormEvent } from "react";
import { membersByDepartment, taskActions, type TaskAction } from "./logic";
import type { Member, TeamTask, WorkContext } from "./types";

export function PeopleOptions({ members, excludeId }: { members: Member[]; excludeId?: string }) {
  return (
    <>
      {membersByDepartment(members.filter((person) => person.user_id !== excludeId)).map(({ department, members: people }) => (
        <optgroup key={department} label={department || "未分组"}>
          {people.map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {person.display_name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

export interface DialogConfig {
  title: string;
  description?: string;
  reasonLabel: string;
  reasonRequired: boolean;
  confirmLabel: string;
  danger?: boolean;
  personLabel?: string;
  excludeId?: string;
  onConfirm: (values: { reason: string; personId: string }) => Promise<boolean>;
}

export function ActionDialog({
  config,
  members,
  busy,
  onClose,
}: {
  config: DialogConfig;
  members: Member[];
  busy: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [personId, setPersonId] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await config.onConfirm({ reason: reason.trim(), personId })) onClose();
  }
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(event) => event.target === ref.current && onClose()}>
      <form onSubmit={(event) => void submit(event)} className="form-stack">
        <h2>{config.title}</h2>
        {config.description && <p className="muted">{config.description}</p>}
        {config.personLabel && (
          <label>
            {config.personLabel}
            <select required autoFocus value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="" disabled>
                请选择
              </option>
              <PeopleOptions members={members} excludeId={config.excludeId} />
            </select>
          </label>
        )}
        <label>
          {config.reasonLabel}
          <textarea
            rows={3}
            maxLength={1000}
            required={config.reasonRequired}
            autoFocus={!config.personLabel}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            className={config.danger ? "danger-solid" : "primary"}
            disabled={busy || (config.reasonRequired && !reason.trim()) || (Boolean(config.personLabel) && !personId)}
          >
            {config.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// 接收、退回、转交、状态流转的按钮。列表行只放常用操作，详情里放全部。
export default function TaskActions({ task, ctx, scope }: { task: TeamTask; ctx: WorkContext; scope: "row" | "detail" }) {
  const [dialog, setDialog] = useState<DialogConfig | null>(null);
  const actions = taskActions(task, ctx.userId, ctx.role).filter((action) => scope === "detail" || action.inline);
  const versioned = { taskId: task.id, expectedVersion: task.version };

  function run(action: TaskAction) {
    if (action.kind === "accept") return void ctx.execute("accept_transfer", { taskId: task.id });
    if (action.kind === "withdraw") return void ctx.execute("withdraw_transfer", { taskId: task.id });
    if (action.kind === "ack") return void ctx.execute("ack_return", { taskId: task.id });
    if (action.kind === "reject") {
      return setDialog({
        title: `退回「${task.title}」`,
        description: "事项会回到原负责人，对方会收到你写的原因。",
        reasonLabel: "退回原因",
        reasonRequired: true,
        confirmLabel: "退回",
        danger: true,
        onConfirm: async ({ reason }) => (await ctx.execute("reject_transfer", { taskId: task.id, reason })).ok,
      });
    }
    if (action.kind === "transfer") {
      return setDialog({
        title: `转交「${task.title}」`,
        description: "对方接收后才算他的，接收前仍然由当前负责人负责。",
        personLabel: "转给谁",
        excludeId: task.owner_id,
        reasonLabel: "说明（为什么转、需要注意什么）",
        reasonRequired: true,
        confirmLabel: "转交",
        onConfirm: async ({ reason, personId }) => (await ctx.execute("transfer_task", { ...versioned, ownerId: personId, reason })).ok,
      });
    }
    if (action.kind !== "status") return;
    if (!action.reason) return void ctx.execute("transition_task", { ...versioned, status: action.status });
    setDialog({
      title: action.label,
      reasonLabel: action.reason,
      reasonRequired: true,
      confirmLabel: action.label,
      danger: action.status === "cancelled",
      onConfirm: async ({ reason }) => (await ctx.execute("transition_task", { ...versioned, status: action.status, reason })).ok,
    });
  }

  if (!actions.length) return null;
  return (
    <div className="task-actions">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={action.primary ? "primary" : action.kind === "status" && action.status === "cancelled" ? "danger" : undefined}
          disabled={ctx.busy}
          onClick={() => run(action)}
        >
          {action.label}
        </button>
      ))}
      {dialog && <ActionDialog config={dialog} members={ctx.members} busy={ctx.busy} onClose={() => setDialog(null)} />}
    </div>
  );
}
