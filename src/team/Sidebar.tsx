import { Bell, ClipboardList, Inbox, LayoutList, LogOut, Users, type LucideIcon } from "lucide-react";
import { signOut } from "../supabase";
import { demoEnabled, demoPeople } from "./client";
import type { TeamSnapshot, Workspace } from "./types";

export type Tab = "mine" | "team" | "records" | "members" | "notify";
export const tabs: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "mine", label: "我的事项", icon: Inbox },
  { id: "team", label: "全部事项", icon: LayoutList },
  { id: "records", label: "事务记录", icon: ClipboardList },
  { id: "members", label: "成员", icon: Users },
  { id: "notify", label: "通知", icon: Bell },
];

interface SidebarProps {
  data: TeamSnapshot;
  workspace: Workspace;
  userId: string;
  tab: Tab;
  attention: number;
  onNavigate: (tab: Tab) => void;
  onSelectWorkspace: (id: string) => void;
  onToggleEntry: () => void;
  onSwitchDemoUser: (id: string) => void;
}

function Account({ name, userId, onSwitchDemoUser }: { name: string; userId: string; onSwitchDemoUser: (id: string) => void }) {
  return (
    <div className="account">
      <span className="avatar" aria-hidden="true">
        {name.slice(0, 1)}
      </span>
      {demoEnabled ? (
        <label className="demo-switch">
          <small>本地演示 · 切换身份</small>
          <select aria-label="切换演示身份" value={userId} onChange={(e) => onSwitchDemoUser(e.target.value)}>
            {demoPeople.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <span className="account-name">{name}</span>
          <button type="button" className="icon-button" aria-label="退出登录" title="退出登录" onClick={() => void signOut()}>
            <LogOut size={16} />
          </button>
        </>
      )}
    </div>
  );
}

export default function Sidebar({
  data,
  workspace,
  userId,
  tab,
  attention,
  onNavigate,
  onSelectWorkspace,
  onToggleEntry,
  onSwitchDemoUser,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          进
        </span>
        <span>推进</span>
      </div>
      <div className="workspace">
        {data.workspaces.length > 1 ? (
          <select aria-label="切换团队" value={workspace.id} onChange={(e) => onSelectWorkspace(e.target.value)}>
            {data.workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="workspace-name">{workspace.name}</span>
        )}
        <button type="button" className="link" onClick={onToggleEntry}>
          加入或新建团队
        </button>
      </div>
      <nav className="nav" aria-label="主导航">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button type="button" key={id} aria-current={tab === id ? "page" : undefined} onClick={() => onNavigate(id)}>
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
            {id === "mine" && attention > 0 && <b className="nav-badge">{attention}</b>}
          </button>
        ))}
      </nav>
      <Account name={data.profile.display_name} userId={userId} onSwitchDemoUser={onSwitchDemoUser} />
    </aside>
  );
}
