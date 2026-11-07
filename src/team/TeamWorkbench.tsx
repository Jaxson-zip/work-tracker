import type { Session } from "@supabase/supabase-js";
import { useCallback, useState } from "react";
import { getToday } from "../dateUtils";
import { signOut } from "../supabase";
import { demoEnabled, demoPeople } from "./client";
import { isManager } from "./logic";
import NewTask from "./NewTask";
import TaskDetail from "./TaskDetail";
import { MyTasks, TeamTasks } from "./TaskList";
import TeamDialog from "./TeamDialog";
import TeamEntry from "./TeamEntry";
import type { WorkContext } from "./types";
import { useTeamData } from "./useTeamData";

function Who({ name, userId, onSwitchDemoUser }: { name: string; userId: string; onSwitchDemoUser: (id: string) => void }) {
  if (demoEnabled) {
    return (
      <select className="demo-switch" aria-label="切换演示身份" value={userId} onChange={(e) => onSwitchDemoUser(e.target.value)}>
        {demoPeople.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
    );
  }
  return (
    <>
      <span className="muted">{name}</span>
      <button type="button" className="link" onClick={() => void signOut()}>
        退出
      </button>
    </>
  );
}

// 整个产品就这一页：上面写待办，下面收待办，点开看流转。
export default function TeamWorkbench({ session, onSwitchDemoUser }: { session: Session; onSwitchDemoUser: (id: string) => void }) {
  const userId = session.user.id;
  const { data, workspace, busy, error, notice, execute, reload } = useTeamData();
  const [view, setView] = useState<"mine" | "team">("mine");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTeam, setShowTeam] = useState(false);
  const closeTask = useCallback(() => setSelectedId(null), []);

  if (!data) {
    return (
      <div className="splash" role={error ? "alert" : "status"}>
        {error || "正在打开…"}
      </div>
    );
  }
  if (!workspace) {
    return (
      <>
        {error && (
          <div className="banner" role="alert">
            {error}
          </div>
        )}
        <TeamEntry execute={execute} busy={busy} />
      </>
    );
  }

  const role = data.members.find((member) => member.user_id === userId)?.role ?? "member";
  const manager = isManager(role);
  const ctx: WorkContext = {
    userId,
    role,
    members: data.members,
    activities: data.activities,
    today: getToday(),
    busy,
    execute,
    openTask: setSelectedId,
  };
  const selectedTask = data.tasks.find((task) => task.id === selectedId);
  return (
    <div className="page">
      <header className="top">
        <strong className="brand">推进</strong>
        <button type="button" className="link team-link" onClick={() => setShowTeam(true)}>
          {workspace.name} · {data.members.length} 人
        </button>
        <span className="top-right">
          <Who name={data.profile.display_name} userId={userId} onSwitchDemoUser={onSwitchDemoUser} />
        </span>
      </header>
      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void reload()}>
            刷新
          </button>
        </div>
      )}
      <NewTask key={userId} ctx={ctx} />
      {manager && (
        <nav className="tabs" aria-label="查看范围">
          <button type="button" aria-current={view === "mine" ? "true" : undefined} onClick={() => setView("mine")}>
            我的
          </button>
          <button type="button" aria-current={view === "team" ? "true" : undefined} onClick={() => setView("team")}>
            全队
          </button>
        </nav>
      )}
      {manager && view === "team" ? <TeamTasks tasks={data.tasks} ctx={ctx} /> : <MyTasks tasks={data.tasks} ctx={ctx} />}
      {selectedTask && <TaskDetail key={selectedTask.id} task={selectedTask} ctx={ctx} onClose={closeTask} />}
      {showTeam && <TeamDialog data={data} ctx={ctx} onClose={() => setShowTeam(false)} />}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
