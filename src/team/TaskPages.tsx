import { CheckCheck, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { focusGroups, focusSummary, isOpen, membersByDepartment, recentlyDone } from "./logic";
import QuickAdd from "./QuickAdd";
import TaskRow from "./TaskRow";
import { statusLabels, type TeamTask, type WorkContext } from "./types";

export function FocusPage({ tasks, ctx }: { tasks: TeamTask[]; ctx: WorkContext }) {
  const groups = focusGroups(tasks, ctx.userId, ctx.today);
  const incoming = groups.find((group) => group.key === "incoming")?.tasks.length ?? 0;
  const done = recentlyDone(tasks, ctx.userId);
  return (
    <>
      <header className="page-header">
        <h1>我的事项</h1>
        <p className="muted" data-testid="focus-summary">
          {focusSummary(groups)}
        </p>
      </header>
      <QuickAdd ctx={ctx} />
      {groups.length === 0 && (
        <div className="empty">
          <CheckCheck size={22} />
          <p>没有待办。在上面记下第一件事吧。</p>
        </div>
      )}
      {groups.map((group) => (
        <section key={group.key} className={`group group-${group.key}`} aria-label={group.title}>
          <div className="group-head">
            <h2>{group.title}</h2>
            <span className="count">{group.tasks.length}</span>
            {group.key === "incoming" && incoming > 1 && (
              <button type="button" className="link" disabled={ctx.busy} onClick={() => void ctx.execute("accept_all", {})}>
                全部接收
              </button>
            )}
          </div>
          <div className="task-list">
            {group.tasks.map((task) => (
              <TaskRow key={task.id} task={task} ctx={ctx} />
            ))}
          </div>
        </section>
      ))}
      {done.length > 0 && (
        <details className="group">
          <summary>最近完成</summary>
          <div className="task-list">
            {done.map((task) => (
              <TaskRow key={task.id} task={task} ctx={ctx} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

type StatusFilter = "open" | "all" | keyof typeof statusLabels;

export function TeamPage({ tasks, ctx }: { tasks: TeamTask[]; ctx: WorkContext }) {
  const [department, setDepartment] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [query, setQuery] = useState("");
  const departments = membersByDepartment(ctx.members).map((group) => group.department);
  const visible = useMemo(() => {
    const inDepartment = new Set(
      ctx.members.filter((member) => department === null || member.department === department).map((member) => member.user_id),
    );
    const needle = query.trim().toLowerCase();
    return tasks
      .filter((task) => inDepartment.has(task.owner_id) || inDepartment.has(task.pending_owner_id ?? ""))
      .filter((task) => (status === "open" ? isOpen(task) : status === "all" || task.status === status))
      .filter((task) => !needle || `${task.title} ${task.body} ${task.next_action}`.toLowerCase().includes(needle))
      .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || b.updated_at.localeCompare(a.updated_at));
  }, [tasks, ctx.members, department, status, query]);
  return (
    <>
      <header className="page-header">
        <h1>全部事项</h1>
        <p className="muted">全团队在做的事，按部门看</p>
      </header>
      {departments.length > 1 && (
        <nav className="tabs" aria-label="按部门筛选">
          <button type="button" aria-current={department === null ? "true" : undefined} onClick={() => setDepartment(null)}>
            全部
          </button>
          {departments.map((name) => (
            <button type="button" key={name} aria-current={department === name ? "true" : undefined} onClick={() => setDepartment(name)}>
              {name || "未分组"}
            </button>
          ))}
        </nav>
      )}
      <div className="filters">
        <label className="search">
          <Search size={15} aria-hidden="true" />
          <input aria-label="搜索事项" placeholder="搜索" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select aria-label="按状态筛选" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="open">未结束</option>
          <option value="all">全部状态</option>
          {Object.entries(statusLabels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {visible.length === 0 ? (
        <div className="empty">
          <p>没有符合条件的事项。</p>
        </div>
      ) : (
        <div className="task-list">
          {visible.map((task) => (
            <TaskRow key={task.id} task={task} ctx={ctx} overview />
          ))}
        </div>
      )}
    </>
  );
}
