export type TeamRole = "owner" | "admin" | "member";
export interface Member {
  user_id: string;
  role: TeamRole;
  display_name: string;
}
export interface TeamTask {
  id: string;
  title: string;
  owner_id: string;
  created_by: string;
  status: "open" | "done";
  due_date: string | null;
  version: number;
  pending_owner_id: string | null;
  handoff_by: string | null;
  handoff_note: string;
  created_at: string;
  updated_at: string;
}
export interface TaskActivity {
  id: string;
  task_id: string;
  actor_id: string;
  action: "created" | "handoff" | "accepted" | "rejected" | "withdrawn" | "done" | "reopened" | "edited";
  detail: { to?: string; from?: string; note?: string; title?: string; due?: string | null };
  created_at: string;
}
export interface TeamInvite {
  id: string;
  code: string;
  expires_at: string;
}
export interface TeamSnapshot {
  workspaces: { id: string; name: string }[];
  members: Member[];
  tasks: TeamTask[];
  activities: TaskActivity[];
  invites: TeamInvite[];
  failed_notifications: number;
  profile: { id: string; display_name: string };
  my_mobile: string;
}

// 成功返回命令结果，失败返回 null。notice 是成功后显示给用户的话。
export type Execute = (action: string, payload: Record<string, unknown>, notice?: string) => Promise<Record<string, unknown> | null>;
export type TaskForm = "handoff" | "reject" | "edit" | null;
export interface GroupMessage {
  message: string;
  mentions: string[];
}
export interface WorkContext {
  userId: string;
  role: TeamRole;
  members: Member[];
  activities: TaskActivity[];
  today: string;
  busy: boolean;
  execute: Execute;
  selectedId: string | null;
  openTask: (id: string, form?: TaskForm) => void;
  showTask: (id: string) => void;
}
