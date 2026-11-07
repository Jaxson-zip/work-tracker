import { Star } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { parseTaskInput } from "../taskInputParser";
import { PeopleOptions } from "./TaskActions";
import type { WorkContext } from "./types";

// 一行记下一件事。文字里的日期自动识别（复用原项目的中文时间解析），需要时才选负责人。
export default function QuickAdd({ ctx }: { ctx: WorkContext }) {
  const [text, setText] = useState("");
  // null 表示跟随文字里识别到的日期；用户动过日期框后以用户为准。
  const [date, setDate] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState(ctx.userId);
  const [note, setNote] = useState("");
  const [important, setImportant] = useState(false);
  const parsed = useMemo(() => (text.trim() ? parseTaskInput(text.trim()) : null), [text]);
  const dueDate = date ?? parsed?.dueDate ?? "";
  const forOther = ownerId !== ctx.userId;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const title = date === null ? parsed?.title || text.trim() : text.trim();
    const result = await ctx.execute("create_task", {
      title,
      ownerId,
      dueDate: dueDate || null,
      priority: important ? "high" : "normal",
      handoffNote: forOther ? note.trim() : "",
    });
    if (!result.ok) return;
    setText("");
    setDate(null);
    setNote("");
    setImportant(false);
    setOwnerId(ctx.userId);
  }

  return (
    <form className="quick-add" onSubmit={(event) => void submit(event)}>
      <div className="quick-add-line">
        <input
          className="quick-add-text"
          aria-label="记一件事"
          placeholder="记一件事，例如：周五跟进合同"
          maxLength={160}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="primary" disabled={ctx.busy || !text.trim()}>
          记下
        </button>
      </div>
      <div className={`quick-add-options ${text.trim() ? "" : "quick-add-idle"}`}>
        <label className="inline-field">
          负责人
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <PeopleOptions members={ctx.members} />
          </select>
        </label>
        <label className="inline-field">
          截止
          <input type="date" value={dueDate} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button
          type="button"
          className={`toggle ${important ? "toggle-on" : ""}`}
          aria-pressed={important}
          onClick={() => setImportant(!important)}
        >
          <Star size={14} fill={important ? "currentColor" : "none"} /> 关键
        </button>
        {date === null && parsed?.dueDate && <span className="muted">已从文字识别</span>}
      </div>
      {forOther && (
        <input
          className="quick-add-note"
          aria-label="给对方的说明"
          placeholder="给对方的说明（对方接收后才算他的）"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
    </form>
  );
}
