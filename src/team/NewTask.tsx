import { useMemo, useState, type FormEvent } from "react";
import { parseTaskInput } from "../taskInputParser";
import type { WorkContext } from "./types";

// 写一条待办：默认自己做，也可以直接交给别人。文字里的日期会自动识别。
export default function NewTask({ ctx }: { ctx: WorkContext }) {
  const [text, setText] = useState("");
  const [ownerId, setOwnerId] = useState(ctx.userId);
  const [note, setNote] = useState("");
  // null 表示跟随文字里识别到的日期；用户动过日期框后以用户为准。
  const [date, setDate] = useState<string | null>(null);
  const parsed = useMemo(() => (text.trim() ? parseTaskInput(text.trim()) : null), [text]);
  const dueDate = date ?? parsed?.dueDate ?? "";
  const forOther = ownerId !== ctx.userId;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const title = date === null ? parsed?.title || text.trim() : text.trim();
    if (!(await ctx.execute("create_task", { title, ownerId, dueDate: dueDate || null, note: forOther ? note.trim() : "" }))) return;
    setText("");
    setDate(null);
    setNote("");
    setOwnerId(ctx.userId);
  }

  return (
    <form className="new-task" onSubmit={(event) => void submit(event)}>
      <input
        className="new-task-text"
        aria-label="写一条待办"
        placeholder="写一条待办，例如：周五前联调订单接口"
        maxLength={160}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {forOther && (
        <input
          className="new-task-note"
          aria-label="交接说明"
          placeholder="交接说明：做到哪了、还要做什么（可选）"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <div className="new-task-bar">
        <label className="inline-field">
          交给
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {ctx.members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.user_id === ctx.userId ? "我自己" : member.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          截止
          <input type="date" value={dueDate} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="primary new-task-submit" disabled={ctx.busy || !text.trim()}>
          {forOther ? "交出去" : "记下"}
        </button>
      </div>
    </form>
  );
}
