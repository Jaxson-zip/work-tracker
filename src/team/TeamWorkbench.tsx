import type { Session } from "@supabase/supabase-js";
import { useState, type ReactNode } from "react";
import { getToday } from "../dateUtils";
import { signOut } from "../supabase";
import { demoEnabled, demoPeople } from "./client";
import { firstTask, isManager } from "./logic";
import NewTask from "./NewTask";
import TaskFlow from "./TaskFlow";
import { MyTasks, TeamTasks } from "./TaskList";
import TeamDialog from "./TeamDialog";
import TeamEntry from "./TeamEntry";
import type { TaskForm, TeamSnapshot, WorkContext } from "./types";
import { useTeamData } from "./useTeamData";

// 和 styles.css 里的单栏断点一致：窄屏上打开流转时回到页面顶部。
const NARROW = "(max-width: 899px)";

function Who({ name, userId, onSwitchDemoUser }: { name: string; userId: string; onSwitchDemoUser: (id: string) => void }) {
  if (demoEnabled) {
    return (
      <div className="who">
        <span className="muted">演示身份</span>
        <div className="segmented" role="group" aria-label="切换演示身份">
          {demoPeople.map((person) => (
            <button key={person.id} type="button" aria-pressed={person.id === userId} onClick={() => onSwitchDemoUser(person.id)}>
              {person.name}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="who">
      <span className="muted">{name}</span>
      <button type="button" className="link" onClick={() => void signOut()}>
        退出
      </button>
    </div>
  );
}

function ViewTabs({ team, onChange }: { team: boolean; onChange: (team: boolean) => void }) {
  return (
    <nav className="segmented segmented-wide" aria-label="查看范围">
      <button type="button" aria-pressed={!team} onClick={() => onChange(false)}>
        我的
      </button>
      <button type="button" aria-pressed={team} onClick={() => onChange(true)}>
        全队
      </button>
    </nav>
  );
}

// 选中哪条、窄屏上显示哪一栏、右边开着哪个表单。
function useSelection(data: TeamSnapshot, userId: string, teamView: boolean, clearNotice: () => void) {
  const [selection, setSelection] = useState<{ id: string; form: TaskForm } | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const task = data.tasks.find((item) => item.id === selection?.id) ?? firstTask(data.tasks, data.activities, userId, teamView);
  return {
    task,
    form: selection?.id === task?.id ? (selection?.form ?? null) : null,
    flowOpen,
    open(id: string, form: TaskForm = null) {
      clearNotice();
      setSelection({ id, form });
      setFlowOpen(true);
      if (window.matchMedia(NARROW).matches) window.scrollTo(0, 0);
    },
    select(id: string) {
      setSelection({ id, form: null });
    },
    setForm(form: TaskForm) {
      clearNotice();
      if (task) setSelection({ id: task.id, form });
    },
    reset() {
      clearNotice();
      setSelection(null);
      setFlowOpen(false);
    },
    closeFlow() {
      clearNotice();
      setFlowOpen(false);
    },
  };
}

// 整个产品就这一页：左边写待办、收待办，右边看流转。
function Workspace({
  data,
  teamName,
  userId,
  team,
  who,
  banner,
}: {
  data: TeamSnapshot;
  teamName: string;
  userId: string;
  team: ReturnType<typeof useTeamData>;
  who: ReactNode;
  banner: ReactNode;
}) {
  const [view, setView] = useState<"mine" | "team">("mine");
  const [showTeam, setShowTeam] = useState(false);
  const role = data.members.find((member) => member.user_id === userId)?.role ?? "member";
  const manager = isManager(role);
  const teamView = manager && view === "team";
  const selection = useSelection(data, userId, teamView, team.clearNotice);
  const ctx: WorkContext = {
    userId,
    role,
    members: data.members,
    activities: data.activities,
    today: getToday(),
    busy: team.busy,
    execute: team.execute,
    selectedId: selection.task?.id ?? null,
    openTask: selection.open,
    onCreated(id) {
      setView("mine");
      selection.select(id);
    },
  };
  function changeView(toTeam: boolean) {
    setView(toTeam ? "team" : "mine");
    selection.reset();
  }
  function openTeam() {
    team.clearNotice();
    setShowTeam(true);
  }
  function closeTeam() {
    setShowTeam(false);
    team.clearNotice();
  }
  return (
    <div className="page">
      <header className="top">
        <div className="top-left">
          <strong className="brand">推进</strong>
          <button type="button" className="link team-link" onClick={openTeam}>
            {teamName} · {data.members.length} 人
          </button>
        </div>
        {who}
      </header>
      {demoEnabled && (
        <p className="demo-hint">这是演示版：数据只在你的浏览器里，刷新后恢复，不发真实群消息。右上角切换身份，体验交接的两端。</p>
      )}
      {banner}
      {team.notice && (
        <p className="notice" role="status">
          {team.notice}
        </p>
      )}
      <div className={selection.flowOpen ? "shell flow-open" : "shell"}>
        <div className="pane-list">
          <NewTask ctx={ctx} />
          {manager && <ViewTabs team={teamView} onChange={changeView} />}
          {teamView ? <TeamTasks tasks={data.tasks} ctx={ctx} /> : <MyTasks tasks={data.tasks} ctx={ctx} />}
        </div>
        <TaskFlow task={selection.task} ctx={ctx} form={selection.form} onForm={selection.setForm} onBack={selection.closeFlow} />
      </div>
      {showTeam && <TeamDialog data={data} ctx={ctx} notice={team.notice} error={team.error} onClose={closeTeam} />}
    </div>
  );
}

export default function TeamWorkbench({ session, onSwitchDemoUser }: { session: Session; onSwitchDemoUser: (id: string) => void }) {
  const userId = session.user.id;
  const team = useTeamData();
  const { data, workspace, busy, error, execute, reload } = team;

  if (!data) {
    return (
      <div className="splash" role={error ? "alert" : "status"}>
        {error || (demoEnabled ? "正在准备演示数据，第一次打开要等几秒…" : "正在打开…")}
      </div>
    );
  }
  const banner = error && (
    <div className="banner" role="alert">
      <span>{error}</span>
      <button type="button" onClick={() => void reload()}>
        刷新
      </button>
    </div>
  );
  if (!workspace) {
    return (
      <>
        {banner}
        <TeamEntry execute={execute} busy={busy} />
      </>
    );
  }
  return (
    <Workspace
      data={data}
      teamName={workspace.name}
      userId={userId}
      team={team}
      banner={banner}
      who={<Who name={data.profile.display_name} userId={userId} onSwitchDemoUser={onSwitchDemoUser} />}
    />
  );
}
