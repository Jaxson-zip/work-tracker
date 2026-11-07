import { Fragment, useEffect, useRef } from "react";
import { handoffChain, historyOf, memberName, sourceOf, whereNow } from "./logic";
import TaskActions from "./TaskActions";
import type { TaskActivity, TeamTask, WorkContext } from "./types";

function describe({ action, actor_id, detail }: TaskActivity, ctx: WorkContext): string {
  const actor = memberName(ctx.members, actor_id);
  if (action === "created") return `${actor} 写了这条待办`;
  if (action === "handoff") return `${actor} 交给 ${memberName(ctx.members, detail.to)}`;
  if (action === "accepted") return `${actor} 接手了`;
  if (action === "rejected") return `${actor} 退回了`;
  if (action === "withdrawn") return `${actor} 撤回了交接`;
  if (action === "done") return `${actor} 完成了`;
  return `${actor} 重新打开了`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// 点开待办看到的就是流转：谁写的、交给过谁、现在在哪、每一步说了什么。
export default function TaskDetail({ task, ctx, onClose }: { task: TeamTask; ctx: WorkContext; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const history = historyOf(ctx.activities, task.id);
  const chain = handoffChain(task, history);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" aria-label="待办流转">
        <div className="drawer-top">
          <span className="where">{whereNow(task, ctx.members, ctx.userId)}</span>
          <button ref={closeRef} type="button" className="link" onClick={onClose}>
            关闭
          </button>
        </div>
        <h2 className="drawer-title">{task.title}</h2>
        <p className="muted">
          {sourceOf(task, history, ctx.members)}
          {task.due_date ? ` · 截止 ${task.due_date}` : ""}
        </p>
        <p className="chain" aria-label="交接链">
          {chain.map((id, index) => (
            <Fragment key={`${id}-${index}`}>
              {index > 0 && <span className="chain-arrow"> → </span>}
              <span className={index === chain.length - 1 && !task.pending_owner_id ? "chain-now" : undefined}>
                {memberName(ctx.members, id)}
              </span>
            </Fragment>
          ))}
          {task.pending_owner_id && (
            <>
              <span className="chain-arrow"> → </span>
              <span className="chain-now">{memberName(ctx.members, task.pending_owner_id)}（待接手）</span>
            </>
          )}
        </p>
        <TaskActions task={task} ctx={ctx} scope="detail" />
        <section className="drawer-section">
          <h3>流转经过</h3>
          <ol className="timeline">
            {history.map((item) => (
              <li key={item.id}>
                <div>{describe(item, ctx)}</div>
                {item.detail.note && <p className="timeline-note">{item.detail.note}</p>}
                <time>{formatTime(item.created_at)}</time>
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </>
  );
}
