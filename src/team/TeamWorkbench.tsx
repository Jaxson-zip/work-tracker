import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getToday } from "../dateUtils";
import { fetchTeamSnapshot, teamCommand } from "./client";
import { keyMatters } from "./logic";
import TaskDetail from "./TaskDetail";
import { RecordForm, TaskForm, type Execute } from "./TaskForms";
import { TeamIntegrations, TeamMembers } from "./TeamSettings";
import { statusLabels, type AffairRecord, type TaskStatus, type TeamSnapshot } from "./types";
type Tab = "mine" | "tasks" | "records" | "members" | "integrations";
const tabs: { id: Tab; label: string; mark: string; subtitle: string }[] = [
  { id: "mine", label: "我的关键事项", mark: "◎", subtitle: "关注现在需要你推进的事" }, { id: "tasks", label: "团队待办", mark: "☷", subtitle: "每件事，都有负责人和下一步" }, { id: "records", label: "日常事务记录", mark: "≡", subtitle: "留下结论，让后续行动有据可循" }, { id: "members", label: "成员与身份", mark: "◇", subtitle: "明确谁参与，以及谁可以做什么" }, { id: "integrations", label: "飞书与通知", mark: "↗", subtitle: "从日常沟通进入任务闭环" },
];
export default function TeamWorkbench({ session }: { session: Session }) {
  const [data, setData] = useState<TeamSnapshot | null>(null); const [workspaceId, setWorkspaceId] = useState<string>();
  const [tab, setTab] = useState<Tab>("mine"); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TaskStatus | "all">("all"); const [owner, setOwner] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null); const [editorEpoch, setEditorEpoch] = useState(0);
  const [composer, setComposer] = useState<"task" | "record" | null>(null); const [sourceRecord, setSourceRecord] = useState<AffairRecord>();
  const [creatingTeam, setCreatingTeam] = useState(false);
  const requestEpoch = useRef(0); const currentWorkspace = useRef(workspaceId); currentWorkspace.current = workspaceId;
  const mounted = useRef(true); const mutationLock = useRef(false);
  const load = useCallback(async (id?: string, silent = false) => {
    const epoch = ++requestEpoch.current;
    if (!silent) setLoading(true);
    try { const snapshot = await fetchTeamSnapshot(id); if (!mounted.current || epoch !== requestEpoch.current) return; setData(snapshot); setError(""); }
    catch (e) { if (mounted.current && epoch === requestEpoch.current) setError(e instanceof Error ? e.message : "读取团队失败"); }
    finally { if (mounted.current && epoch === requestEpoch.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; void load(workspaceId); const interval = window.setInterval(() => { if (document.visibilityState !== "hidden") void load(workspaceId, true); }, 30000); return () => { mounted.current = false; requestEpoch.current++; window.clearInterval(interval); }; }, [workspaceId, load]);
  const selectedWorkspace = data?.workspaces.find(w => w.id === workspaceId) ?? data?.workspaces[0];
  const effectiveWorkspaceId = selectedWorkspace?.id;
  const selectedWorkspaceRef = useRef(effectiveWorkspaceId); selectedWorkspaceRef.current = effectiveWorkspaceId;
  const execute: Execute = async (action, payload) => {
    if (mutationLock.current) return { ok: false };
    mutationLock.current = true; setBusy(true); setError(""); setNotice("");
    const selectedAtStart = selectedWorkspaceRef.current;
    try {
      const result = await teamCommand(action, { workspaceId: selectedAtStart, ...payload });
      if (!mounted.current || selectedWorkspaceRef.current !== selectedAtStart) return { ok: true, data: result };
      setNotice("已保存");
      if (action === "create_workspace" || action === "join_workspace") { const id = String(result.id ?? result.workspace_id ?? ""); if (id) { setData(null); setWorkspaceId(id); } else await load(currentWorkspace.current, true); setCreatingTeam(false); }
      else { await load(currentWorkspace.current, true); if (["update_task", "transition_task", "transfer_task"].includes(action)) setEditorEpoch(n => n + 1); }
      return { ok: true, data: result };
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "操作失败，请重试"); return { ok: false }; }
    finally { mutationLock.current = false; if (mounted.current) setBusy(false); }
  };
  const today = getToday(); const me = data?.members.find(m => m.user_id === session.user.id); const role = me?.role ?? "member";
  const tasks = data?.tasks ?? []; const keyTasks = keyMatters(tasks, session.user.id, today);
  const activeTasks = tasks.filter(t => t.status !== "done"); const overdueCount = activeTasks.filter(t => t.owner_id === session.user.id && t.due_date && t.due_date < today).length;
  const followupCount = activeTasks.filter(t => t.owner_id === session.user.id && t.follow_up_date && t.follow_up_date <= today).length;
  const reviewCount = tasks.filter(t => t.status === "review" && (t.created_by === session.user.id || role !== "member")).length;
  const visibleTasks = (tab === "mine" ? keyTasks : tasks).filter(t => (status === "all" || t.status === status) && (owner === "all" || t.owner_id === owner) && `${t.title} ${t.body} ${t.next_action}`.toLowerCase().includes(query.toLowerCase()));
  const selectedTask = tasks.find(t => t.id === selectedId); const title = tabs.find(t => t.id === tab)!;
  function switchTeam(id: string) { if ((composer || selectedId) && !window.confirm("切换团队会关闭当前编辑，请先确认已保存。继续切换？")) return; setData(null); setWorkspaceId(id); setSelectedId(null); setComposer(null); setSourceRecord(undefined); setError(""); setNotice(""); setStatus("all"); setOwner("all"); setQuery(""); }
  function switchTab(next: Tab) { if (composer && !window.confirm("关闭尚未保存的录入并切换页面？")) return; setTab(next); setComposer(null); setSourceRecord(undefined); setSelectedId(null); setStatus("all"); setOwner("all"); setQuery(""); }
  return <main className="team-layout"><aside className="team-sidebar"><div className="workspace-label">当前团队</div><select className="workspace-select" aria-label="切换团队" value={effectiveWorkspaceId ?? ""} disabled={busy || loading} onChange={e => switchTeam(e.target.value)}>{data?.workspaces.length ? data.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>) : <option value="">尚未加入团队</option>}</select><button className="text-button new-team-button" type="button" disabled={busy} onClick={() => setCreatingTeam(v => !v)}>＋ 创建或加入团队</button><nav className="team-nav" aria-label="团队导航">{tabs.map(t => <button type="button" key={t.id} className={tab === t.id ? "active" : ""} onClick={() => switchTab(t.id)}><span>{t.mark}</span>{t.label}{t.id === "mine" && keyTasks.length > 0 && <b>{keyTasks.length}</b>}</button>)}</nav><div className="sidebar-foot"><span className="person-avatar">{(data?.profile.display_name ?? session.user.email ?? "我").slice(0, 1)}</span><div><strong>{data?.profile.display_name ?? "我的账号"}</strong><small>{me ? ({ owner: "团队所有者", admin: "团队管理员", member: "团队成员" })[me.role] : "创建团队即可开始"}</small></div></div></aside>
    <section className="team-main"><header className="team-page-header"><div><p className="eyebrow">{new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })} / {selectedWorkspace?.name ?? "新工作空间"}</p><h1>{title.label}</h1><p className="secondary">{title.subtitle}</p></div>{effectiveWorkspaceId && <div className="header-buttons"><button type="button" disabled={busy} onClick={() => { setSourceRecord(undefined); setComposer("record"); }}>＋ 记录事务</button><button className="primary" type="button" disabled={busy} onClick={() => { setSourceRecord(undefined); setComposer("task"); }}>＋ 新增待办</button></div>}</header>
      {error && <div className="work-banner error" role="alert"><span>{error}</span><button type="button" disabled={busy} onClick={() => void load(workspaceId)}>重新读取</button></div>}{notice && <div className="save-notice" role="status">{notice}</div>}
      {(creatingTeam || (!loading && data && !data.workspaces.length)) && <TeamEntry execute={execute} busy={busy} />}
      {loading && !data ? <div className="work-empty" role="status">正在读取团队工作空间…</div> : data && effectiveWorkspaceId ? <>
        {composer === "task" && <TaskForm key={sourceRecord?.id ?? "new"} members={data.members} userId={session.user.id} record={sourceRecord} execute={execute} busy={busy} onClose={() => { setComposer(null); setSourceRecord(undefined); }} />}{composer === "record" && <RecordForm execute={execute} busy={busy} today={today} onClose={() => setComposer(null)} />}
        {tab === "mine" && <div className="attention-strip"><button type="button" onClick={() => { setTab("tasks"); setStatus("all"); setOwner(session.user.id); }}><b>{overdueCount}</b><span>我的逾期事项</span></button><button type="button" onClick={() => { setTab("mine"); setStatus("all"); }}><b>{followupCount}</b><span>到期需要跟进</span></button><button type="button" onClick={() => { setTab("tasks"); setStatus("review"); setOwner("all"); }}><b>{reviewCount}</b><span>等待验收</span></button><div><span className="attention-note">把事项记住，<br /><strong>把下一步说清楚。</strong></span></div></div>}
        {(tab === "mine" || tab === "tasks") && <><div className="work-filters"><input aria-label="搜索任务" placeholder="搜索任务或下一步动作…" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="筛选状态" value={status} onChange={e => setStatus(e.target.value as TaskStatus | "all")}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select><select aria-label="筛选负责人" value={owner} onChange={e => setOwner(e.target.value)}><option value="all">全部负责人</option>{data.members.map(m => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select><button type="button" disabled={loading} onClick={() => void load(workspaceId, true)}>刷新</button></div><div className="task-table"><div className="task-table-header"><span>任务 / 下一步动作</span><span>负责人</span><span>截止 / 跟进</span><span>状态</span></div>{visibleTasks.length === 0 ? <div className="work-empty"><div className="empty-symbol">✓</div><h3>{query || status !== "all" || owner !== "all" ? "没有符合筛选的任务" : tab === "mine" ? "当前没有急需推进的关键事项" : "从第一件待办开始"}</h3><p>{tab === "mine" ? "关键、高优先级、待接单、受阻、到期跟进和待验收事项会出现在这里。" : "记录负责人和下一步动作，让事情真正开始推进。"}</p><button type="button" onClick={() => { setComposer("task"); setSourceRecord(undefined); }}>新增待办</button></div> : visibleTasks.map(task => <button type="button" className={`task-table-row ${selectedId === task.id ? "selected" : ""}`} key={task.id} onClick={() => { if (selectedId && selectedId !== task.id && !window.confirm("切换任务会关闭当前未保存的编辑。继续？")) return; setSelectedId(task.id); }}><span className="task-title-cell"><strong>{task.priority === "high" && <i aria-label="关键事项">★</i>}{task.title}</strong><small>{task.next_action || "尚未填写下一步动作"}</small></span><span className="table-owner">{data.members.find(m => m.user_id === task.owner_id)?.display_name ?? "已离开成员"}</span><span className={`task-dates ${task.due_date && task.due_date < today && task.status !== "done" ? "overdue" : ""}`}>{task.due_date ?? "未设截止"}{task.follow_up_date && <small>跟进 {task.follow_up_date}</small>}</span><span className={`status-badge status-${task.status}`}>{statusLabels[task.status]}</span></button>)}</div></>}
        {tab === "records" && <div className="records-feed">{data.records.length === 0 ? <div className="work-empty"><h3>把今天值得记住的事留下来</h3><p>会议结论、沟通记录、临时想法，都可以先记录，再转成待办。</p><button type="button" onClick={() => setComposer("record")}>记录第一件事</button></div> : data.records.map(record => <article className="affair-record" key={record.id}><div className="record-date"><time>{record.occurred_on}</time><small>{record.source === "feishu" ? "飞书录入" : "手动记录"}</small></div><div className="record-content"><h3>{record.important && <span className="important-star">★ </span>}{record.title}</h3><p>{record.body || "未填写详细内容"}</p><small>{data.members.find(m => m.user_id === record.created_by)?.display_name ?? "已离开成员"} 记录</small></div>{record.task_id ? <button type="button" onClick={() => { setTab("tasks"); setSelectedId(record.task_id); }}>查看关联待办</button> : <button type="button" disabled={busy} onClick={() => { setSourceRecord(record); setComposer("task"); }}>转为待办 →</button>}</article>)}</div>}
        {tab === "members" && <TeamMembers key={effectiveWorkspaceId} data={data} userId={session.user.id} execute={execute} busy={busy} />}{tab === "integrations" && <TeamIntegrations key={effectiveWorkspaceId} data={data} execute={execute} busy={busy} />}
      </> : !loading && !data && !error ? <div className="work-empty">创建或加入团队即可开始。</div> : null}
    </section>{selectedTask && data && <TaskDetail key={`${selectedTask.id}:${editorEpoch}`} task={selectedTask} members={data.members} activities={data.activities} userId={session.user.id} role={role} execute={execute} busy={busy} onClose={() => setSelectedId(null)} onReload={() => setEditorEpoch(n => n + 1)} />}
  </main>;
}
function TeamEntry({ execute, busy }: { execute: Execute; busy: boolean }) {
  const [name, setName] = useState(""); const [code, setCode] = useState("");
  return <section className="team-entry"><form onSubmit={async e => { e.preventDefault(); if ((await execute("create_workspace", { name: name.trim() })).ok) setName(""); }}><h2>创建工作团队</h2><p>一个人也可以创建团队，先管理自己的关键事务。</p><label>团队名称<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="例如：项目推进小组" /></label><button className="primary" disabled={busy || !name.trim()}>创建团队</button></form><form onSubmit={async e => { e.preventDefault(); if ((await execute("join_workspace", { code: code.trim() })).ok) setCode(""); }}><h2>加入已有团队</h2><p>请管理员生成邀请凭证，在这里填写。</p><label>邀请凭证<input required value={code} onChange={e => setCode(e.target.value)} placeholder="粘贴邀请凭证" /></label><button disabled={busy || !code.trim()}>加入团队</button></form></section>;
}
