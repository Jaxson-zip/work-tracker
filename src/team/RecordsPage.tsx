import { Star } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ActionDialog, type DialogConfig } from "./TaskActions";
import { memberName } from "./TaskRow";
import type { AffairRecord, TeamTask, WorkContext } from "./types";

function RecordForm({ ctx }: { ctx: WorkContext }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [occurredOn, setOccurredOn] = useState(ctx.today);
  const [important, setImportant] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await ctx.execute("create_record", { title: title.trim(), body, occurredOn, important });
    if (!result.ok) return;
    setTitle("");
    setBody("");
    setImportant(false);
    setOccurredOn(ctx.today);
  }
  return (
    <form className="quick-add" onSubmit={(event) => void submit(event)}>
      <div className="quick-add-line">
        <input
          className="quick-add-text"
          aria-label="记录一件事"
          placeholder="今天发生了什么？会议结论、沟通结果……"
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="primary" disabled={ctx.busy || !title.trim()}>
          记录
        </button>
      </div>
      {title.trim() && (
        <textarea
          className="quick-add-note"
          aria-label="详细内容"
          rows={2}
          maxLength={10000}
          placeholder="详细内容（可选）"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      )}
      <div className="quick-add-options">
        <label className="inline-field">
          日期
          <input type="date" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </label>
        <button
          type="button"
          className={`toggle ${important ? "toggle-on" : ""}`}
          aria-pressed={important}
          onClick={() => setImportant(!important)}
        >
          <Star size={14} fill={important ? "currentColor" : "none"} /> 关键
        </button>
      </div>
    </form>
  );
}

export default function RecordsPage({ records, tasks, ctx }: { records: AffairRecord[]; tasks: TeamTask[]; ctx: WorkContext }) {
  const [dialog, setDialog] = useState<DialogConfig | null>(null);
  const sorted = [...records].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));

  function convert(record: AffairRecord) {
    setDialog({
      title: "生成待办",
      description: `「${record.title}」`,
      personLabel: "谁来负责",
      reasonLabel: "下一步要做什么",
      reasonRequired: false,
      confirmLabel: "生成待办",
      onConfirm: async ({ reason, personId }) =>
        (
          await ctx.execute("record_to_task", {
            recordId: record.id,
            ownerId: personId,
            nextAction: reason,
            priority: record.important ? "high" : "normal",
          })
        ).ok,
    });
  }

  return (
    <>
      <header className="page-header">
        <h1>事务记录</h1>
        <p className="muted">先记下来，需要跟进的再生成待办</p>
      </header>
      <RecordForm ctx={ctx} />
      {sorted.length === 0 ? (
        <div className="empty">
          <p>还没有记录。</p>
        </div>
      ) : (
        <div className="task-list">
          {sorted.map((record) => {
            const linked = record.task_id && tasks.some((task) => task.id === record.task_id);
            return (
              <article className="task-row" key={record.id}>
                <div className="task-main">
                  <div className="record-title">
                    {record.important && <Star className="task-star" size={14} fill="currentColor" aria-label="关键事项" />}
                    {record.title}
                  </div>
                  {record.body && <p className="record-body">{record.body}</p>}
                  <div className="task-meta">
                    <span>{record.occurred_on}</span>
                    <span>{memberName(ctx.members, record.created_by)}</span>
                    {record.source === "feishu" && <span className="tag">飞书</span>}
                  </div>
                </div>
                <div className="task-actions">
                  {linked ? (
                    <button type="button" onClick={() => ctx.openTask(record.task_id!)}>
                      查看待办
                    </button>
                  ) : (
                    <button type="button" disabled={ctx.busy} onClick={() => convert(record)}>
                      生成待办
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {dialog && <ActionDialog config={dialog} members={ctx.members} busy={ctx.busy} onClose={() => setDialog(null)} />}
    </>
  );
}
