import { Star } from "lucide-react";
import { dueLabel, isOpen } from "./logic";
import TaskActions from "./TaskActions";
import { statusLabels, type Member, type TeamTask, type WorkContext } from "./types";

export const memberName = (members: Member[], id: string | null) =>
  members.find((member) => member.user_id === id)?.display_name ?? "已离开的成员";

// 转交相关的上下文：这件事为什么在这里。
function HandoffNote({ task, ctx }: { task: TeamTask; ctx: WorkContext }) {
  if (task.pending_owner_id === ctx.userId) {
    return (
      <p className="row-note">
        {memberName(ctx.members, task.handoff_by)} 转给你{task.handoff_note ? `：${task.handoff_note}` : ""}
      </p>
    );
  }
  if (task.returned_to) {
    return (
      <p className="row-note row-note-danger">
        {memberName(ctx.members, task.returned_by)} 退回：{task.returned_note}
      </p>
    );
  }
  return null;
}

// overview 用于全部事项：只看谁在做、进度如何，操作都在详情里。
export default function TaskRow({ task, ctx, overview }: { task: TeamTask; ctx: WorkContext; overview?: boolean }) {
  const open = isOpen(task);
  const due = open && task.due_date ? dueLabel(task.due_date, ctx.today) : null;
  const followUp = open && task.follow_up_date && task.follow_up_date <= ctx.today;
  const waitingOn = task.pending_owner_id === ctx.userId ? "你" : memberName(ctx.members, task.pending_owner_id);
  return (
    <div className="task-row">
      <div className="task-main">
        <button type="button" className={`task-title ${open ? "" : "task-closed"}`} onClick={() => ctx.openTask(task.id)}>
          {task.priority === "high" && <Star className="task-star" size={14} fill="currentColor" aria-label="关键事项" />}
          {task.title}
        </button>
        <div className="task-meta">
          {overview && <span>{memberName(ctx.members, task.owner_id)}</span>}
          {due && <span className={due.overdue ? "text-danger" : undefined}>{due.text}</span>}
          {followUp && <span>今天要跟进</span>}
          {task.next_action && <span className="task-next">下一步：{task.next_action}</span>}
          {task.pending_owner_id && (overview || task.pending_owner_id !== ctx.userId) && <span className="tag">等{waitingOn}接收</span>}
          {!overview && task.status === "review" && task.owner_id === ctx.userId && (
            <span className="tag">等{memberName(ctx.members, task.created_by)}验收</span>
          )}
          {!overview && task.status === "blocked" && <span className="tag tag-danger">受阻</span>}
          {overview && task.returned_to && <span className="tag tag-danger">转交被退回</span>}
          {!overview && !open && <span className="tag">{statusLabels[task.status]}</span>}
        </div>
        {!overview && <HandoffNote task={task} ctx={ctx} />}
      </div>
      {overview ? (
        <span className={`tag status-${task.status}`}>{statusLabels[task.status]}</span>
      ) : (
        <TaskActions task={task} ctx={ctx} scope="row" />
      )}
    </div>
  );
}
