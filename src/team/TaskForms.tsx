import { useState } from "react";
import { parseTaskInput } from "../taskInputParser";
import type { AffairRecord, Member, TeamTask } from "./types";
export type Execute = (action: string, payload: Record<string, unknown>) => Promise<{ ok: boolean; data?: Record<string, unknown> }>;
export function TaskForm({ members, userId, record, execute, onClose, busy }: { members: Member[]; userId: string; record?: AffairRecord; execute: Execute; onClose: () => void; busy: boolean }) {
  const [title, setTitle] = useState(record?.title ?? ""); const [body, setBody] = useState(record?.body ?? "");
  const [ownerId, setOwnerId] = useState(userId); const [dueDate, setDueDate] = useState(""); const [followUpDate, setFollowUpDate] = useState("");
  const [nextAction, setNextAction] = useState(""); const [priority, setPriority] = useState("normal");
  return <section className="work-composer"><div className="section-heading"><h2>{record ? "将记录转为待办" : "新增待办"}</h2><button type="button" onClick={onClose}>取消</button></div>
    <form onSubmit={async e => { e.preventDefault(); const result = await execute(record ? "record_to_task" : "create_task", { title: title.trim(), body, ownerId, dueDate: dueDate || null, followUpDate: followUpDate || null, nextAction, priority, ...(record ? { recordId: record.id } : {}) }); if (result.ok) onClose(); }}>
      <label>任务标题<input autoFocus required maxLength={160} value={title} readOnly={Boolean(record)} onChange={e => setTitle(e.target.value)} placeholder="例如：明天下午3点确认合同条款" /></label>
      {!record && <button className="text-button" type="button" onClick={() => { const parsed = parseTaskInput(title); if (parsed.dueDate) { setTitle(parsed.title); setDueDate(parsed.dueDate); } }}>识别标题中的日期</button>}
      <label>事项说明<textarea maxLength={10000} value={body} readOnly={Boolean(record)} onChange={e => setBody(e.target.value)} rows={2} placeholder="背景、预期结果或需要注意的细节" /></label>
      <div className="field-grid"><label>负责人<select required value={ownerId} onChange={e => setOwnerId(e.target.value)}>{members.map(m => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></label><label>优先级<select value={priority} onChange={e => setPriority(e.target.value)}><option value="normal">普通</option><option value="high">关键事项</option><option value="low">低</option></select></label><label>截止日期<input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label><label>下次跟进<input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} /></label></div>
      <label>下一步动作<input maxLength={1000} value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="明确下一次要做什么，例如：联系客户确认交付日期" /></label>
      <div className="form-footer"><span>创建后进入「待接单」，由负责人开始推进。</span><button className="primary" disabled={busy || !title.trim()}>{busy ? "正在保存…" : "创建待办"}</button></div>
    </form></section>;
}
export function RecordForm({ execute, onClose, busy, today }: { execute: Execute; onClose: () => void; busy: boolean; today: string }) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [occurredOn, setOccurredOn] = useState(today); const [important, setImportant] = useState(false);
  return <section className="work-composer"><div className="section-heading"><h2>记录一件事</h2><button type="button" onClick={onClose}>取消</button></div><form onSubmit={async e => { e.preventDefault(); if ((await execute("create_record", { title: title.trim(), body, occurredOn, important })).ok) onClose(); }}>
    <label>事项标题<input autoFocus required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="今天发生了什么，或有哪些需要记住的事？" /></label><label>详细记录<textarea rows={4} maxLength={10000} value={body} onChange={e => setBody(e.target.value)} placeholder="会议要点、沟通结论、后续安排…" /></label><div className="field-grid"><label>发生日期<input type="date" required value={occurredOn} onChange={e => setOccurredOn(e.target.value)} /></label><label className="checkbox-label"><input type="checkbox" checked={important} onChange={e => setImportant(e.target.checked)} />标记为关键事项</label></div><div className="form-footer"><span>先记录，再决定是否转成任务。</span><button className="primary" disabled={busy || !title.trim()}>{busy ? "正在保存…" : "保存记录"}</button></div>
  </form></section>;
}
export const editableTaskPayload = (task: TeamTask) => ({ title: task.title, body: task.body, priority: task.priority, dueDate: task.due_date, followUpDate: task.follow_up_date, nextAction: task.next_action });

