import { useState } from "react";
import { availableTransitions } from "./logic";
import { editableTaskPayload, type Execute } from "./TaskForms";
import { statusLabels, type Member, type TaskActivity, type TeamRole, type TeamTask } from "./types";
const actionLabels: Record<string, string> = { created: "创建任务", create_task: "创建任务", updated: "更新任务", update_task: "更新任务", transfer: "转交任务", transition: "变更状态", comment: "跟进记录", record_to_task: "记录转待办" };
export default function TaskDetail({ task, members, activities, userId, role, execute, busy, onClose, onReload }: { task: TeamTask; members: Member[]; activities: TaskActivity[]; userId: string; role: TeamRole; execute: Execute; busy: boolean; onClose: () => void; onReload: () => void }) {
  const [draft, setDraft] = useState(() => editableTaskPayload(task)); const [version] = useState(task.version);
  const [reason, setReason] = useState(""); const [ownerId, setOwnerId] = useState(task.owner_id); const [comment, setComment] = useState("");
  const canEdit = role !== "member" || task.owner_id === userId || task.created_by === userId;
  const stale = version !== task.version;
  const memberName = (id: string) => members.find(m => m.user_id === id)?.display_name ?? "已离开成员";
  const base = { taskId: task.id, expectedVersion: version };
  return <aside className="work-detail" aria-label="任务详情"><div className="detail-top"><span className={`status-badge status-${task.status}`}>{statusLabels[task.status]}</span><button type="button" onClick={onClose}>关闭详情</button></div><h2>{task.title}</h2><p className="detail-byline">{memberName(task.owner_id)} 负责 · {memberName(task.created_by)} 创建</p>
    {stale && <div className="work-banner error" role="alert">其他成员已更新此任务。请先加载最新内容，再操作。<button type="button" onClick={onReload}>加载最新内容</button></div>}
    <form onSubmit={async e => { e.preventDefault(); await execute("update_task", { ...base, ...draft }); }}><fieldset disabled={busy || !canEdit || stale}>
      <label>任务标题<input required maxLength={160} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>事项说明<textarea maxLength={10000} rows={3} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label><div className="field-grid"><label>截止日期<input type="date" value={draft.dueDate ?? ""} onChange={e => setDraft({ ...draft, dueDate: e.target.value || null })} /></label><label>下次跟进<input type="date" value={draft.followUpDate ?? ""} onChange={e => setDraft({ ...draft, followUpDate: e.target.value || null })} /></label></div><label>优先级<select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as TeamTask["priority"] })}><option value="normal">普通</option><option value="high">关键事项</option><option value="low">低</option></select></label><label>下一步动作<input maxLength={1000} value={draft.nextAction} onChange={e => setDraft({ ...draft, nextAction: e.target.value })} placeholder="下一步要做什么？" /></label>{canEdit && <button className="primary" disabled={!draft.title.trim()}>保存任务</button>}</fieldset></form>
    <section className="detail-section"><h3>推进与流转</h3>{availableTransitions(task, userId, role).length > 0 && <><label>说明 / 受阻或退回原因<textarea rows={2} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="受阻、退回、重新打开及转交时必填" /></label><div className="flow-buttons">{availableTransitions(task, userId, role).map(status => <button key={status} type="button" disabled={busy || stale || ((status === "blocked" || (status === "in_progress" && (task.status === "review" || task.status === "done"))) && !reason.trim())} onClick={() => void execute("transition_task", { ...base, status, reason })}>{status === "in_progress" && task.status === "pending" ? "接单并开始" : status === "review" ? "提交验收" : status === "done" ? "验收通过" : status === "blocked" ? "标记受阻" : task.status === "review" ? "退回继续推进" : "继续推进"}</button>)}</div></>}
      {canEdit && <div className="transfer-fields"><label>转交负责人<select value={ownerId} onChange={e => setOwnerId(e.target.value)}>{!members.some(m => m.user_id === task.owner_id) && <option value={task.owner_id}>原负责人已离开，请重新指派</option>}{members.map(m => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></label>{availableTransitions(task, userId, role).length === 0 && <label>转交原因<input maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>}<button type="button" disabled={busy || stale || ownerId === task.owner_id || !reason.trim()} onClick={() => void execute("transfer_task", { ...base, ownerId, reason })}>确认转交</button></div>}
      {!canEdit && availableTransitions(task, userId, role).length === 0 && <p className="secondary">你可以查看与补充跟进记录，当前任务由负责人推进。</p>}
    </section>
    <section className="detail-section"><h3>跟进记录与操作历史</h3><form onSubmit={async e => { e.preventDefault(); if ((await execute("comment_task", { taskId: task.id, comment: comment.trim() })).ok) setComment(""); }}><label>补充跟进记录<textarea rows={2} maxLength={1000} value={comment} onChange={e => setComment(e.target.value)} placeholder="进展、沟通结果或需要协助的内容" /></label><button type="submit" disabled={busy || !comment.trim()}>添加跟进</button></form><ol className="activity-list">{activities.filter(a => a.task_id === task.id).map(a => <li key={a.id}><span className="activity-dot" /><div><strong>{memberName(a.actor_id)}</strong> {actionLabels[a.action] ?? a.action}<p>{formatDetail(a.detail, memberName)}</p><time>{new Date(a.created_at).toLocaleString("zh-CN")}</time></div></li>)}</ol></section>
  </aside>;
}
function formatDetail(detail: Record<string, unknown>, name: (id: string) => string): string {
  const parts: string[] = [];
  if (detail.to || detail.status || detail.to_status) { const value = String(detail.to ?? detail.status ?? detail.to_status); parts.push(`状态：${statusLabels[value as keyof typeof statusLabels] ?? value}`); }
  for (const key of ["reason", "comment", "message", "text"]) if (typeof detail[key] === "string") parts.push(String(detail[key]));
  if (typeof detail.owner_id === "string") parts.push(`负责人：${name(detail.owner_id)}`);
  if (typeof detail.to_owner_id === "string") parts.push(`负责人：${name(detail.to_owner_id)}`);
  if (typeof detail.from_owner === "string" && typeof detail.to_owner === "string") parts.push(`${name(detail.from_owner)} → ${name(detail.to_owner)}`);
  return parts.join(" · ");
}

