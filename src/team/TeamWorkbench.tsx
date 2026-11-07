import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getToday } from "../dateUtils";
import { focusGroups } from "./logic";
import MembersPage from "./MembersPage";
import NotifyPage from "./NotifyPage";
import RecordsPage from "./RecordsPage";
import Sidebar, { tabs, type Tab } from "./Sidebar";
import TaskDetail from "./TaskDetail";
import { FocusPage, TeamPage } from "./TaskPages";
import TeamEntry from "./TeamEntry";
import type { WorkContext } from "./types";
import { useTeamData } from "./useTeamData";

const tabFromHash = (): Tab => tabs.find((tab) => `#${tab.id}` === window.location.hash)?.id ?? "mine";
const URGENT_GROUPS = new Set(["incoming", "returned", "review", "overdue", "today"]);

export default function TeamWorkbench({ session, onSwitchDemoUser }: { session: Session; onSwitchDemoUser: (id: string) => void }) {
  const userId = session.user.id;
  const { data, workspace, busy, error, notice, execute, setWorkspaceId, reload } = useTeamData();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingTeam, setAddingTeam] = useState(false);
  const today = getToday();

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const attention = useMemo(() => {
    if (!data) return 0;
    return focusGroups(data.tasks, userId, today)
      .filter((group) => URGENT_GROUPS.has(group.key))
      .reduce((sum, group) => sum + group.tasks.length, 0);
  }, [data, userId, today]);
  const closeTask = useCallback(() => setSelectedId(null), []);

  if (!data)
    return (
      <div className="splash" role={error ? "alert" : "status"}>
        {error || "正在打开…"}
      </div>
    );
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

  const me = data.members.find((member) => member.user_id === userId);
  const ctx: WorkContext = { userId, role: me?.role ?? "member", members: data.members, today, busy, execute, openTask: setSelectedId };
  const selectedTask = data.tasks.find((task) => task.id === selectedId);
  return (
    <div className="shell">
      <Sidebar
        data={data}
        workspace={workspace}
        userId={userId}
        tab={tab}
        attention={attention}
        onNavigate={(next) => {
          window.location.hash = next;
          setTab(next);
          setSelectedId(null);
        }}
        onSelectWorkspace={(id) => {
          setSelectedId(null);
          setWorkspaceId(id);
        }}
        onToggleEntry={() => setAddingTeam(!addingTeam)}
        onSwitchDemoUser={onSwitchDemoUser}
      />
      <main className="content">
        <div className="page" key={tab}>
          {error && (
            <div className="banner" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void reload()}>
                刷新
              </button>
            </div>
          )}
          {addingTeam && <TeamEntry execute={execute} busy={busy} embedded onDone={() => setAddingTeam(false)} />}
          {tab === "mine" && <FocusPage tasks={data.tasks} ctx={ctx} />}
          {tab === "team" && <TeamPage tasks={data.tasks} ctx={ctx} />}
          {tab === "records" && <RecordsPage records={data.records} tasks={data.tasks} ctx={ctx} />}
          {tab === "members" && <MembersPage key={workspace.id} data={data} ctx={ctx} />}
          {tab === "notify" && <NotifyPage data={data} ctx={ctx} />}
        </div>
      </main>
      {selectedTask && <TaskDetail key={selectedTask.id} task={selectedTask} activities={data.activities} ctx={ctx} onClose={closeTask} />}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
