import { useMemo, useState, type FormEvent } from "react";
import { parseTaskInput } from "../taskInputParser";
import { dueLabel, memberName } from "./logic";
import PersonPicker from "./PersonPicker";
import type { WorkContext } from "./types";

// 写一条待办：默认自己做，也可以直接交给别人。文字里的日期会自动识别。
export default function NewTask({ ctx }: { ctx: WorkContext }) {
  const [text, setText] = useState("");
  const [ownerId, setOwnerId] = useState(ctx.userId);
  const [note, setNote] = useState("");
  // 识别错了可以不要：记下这段文字不再识别，改了文字再重新识别。
  const [ignored, setIgnored] = useState("");
  const parsed = useMemo(() => (text.trim() && text !== ignored ? parseTaskInput(text.trim()) : null), [text, ignored]);
  const dueDate = parsed?.dueDate ?? null;
  const forOther = ownerId !== ctx.userId;
  const toName = memberName(ctx.members, ownerId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload = { title: parsed?.title || text.trim(), ownerId, dueDate, note: forOther ? note.trim() : "" };
    const created = await ctx.execute("create_task", payload, forOther ? `已交给${toName}，等对方接手。` : "记下了。");
    if (!created) return;
    setText("");
    setIgnored("");
    setNote("");
    setOwnerId(ctx.userId);
    ctx.onCreated(String(created.id));
  }

  return (
    <form className="new-task" onSubmit={(event) => void submit(event)}>
      <input
        className="field-soft new-task-text"
        aria-label="写一条待办"
        placeholder="写一条待办，比如：周五前联调退款接口"
        maxLength={160}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {dueDate && (
        <span className="new-task-due">
          识别到：{dueLabel(dueDate, ctx.today).text}
          <button type="button" className="link quiet" onClick={() => setIgnored(text)}>
            不要日期
          </button>
        </span>
      )}
      {forOther && (
        <textarea
          className="field-soft"
          aria-label="交接说明"
          rows={2}
          placeholder="交接说明：做到哪了、对方要做什么"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <div className="new-task-bar">
        <PersonPicker
          label="交给"
          value={ownerId}
          onChange={setOwnerId}
          options={[
            { id: ctx.userId, label: "我自己" },
            ...ctx.members
              .filter((member) => member.user_id !== ctx.userId)
              .map((member) => ({ id: member.user_id, label: member.display_name })),
          ]}
        />
        <button className="primary" disabled={ctx.busy || !text.trim()}>
          {forOther ? `交给${toName}` : "记下"}
        </button>
      </div>
    </form>
  );
}
