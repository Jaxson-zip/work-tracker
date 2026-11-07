export type TeamRole = "owner" | "admin" | "member";
export type TaskStatus = "pending" | "in_progress" | "blocked" | "review" | "done";
export interface Workspace { id: string; name: string; created_by: string }
export interface Member { workspace_id: string; user_id: string; role: TeamRole; display_name: string }
export interface TeamTask {
  id: string; workspace_id: string; title: string; body: string; owner_id: string;
  created_by: string; status: TaskStatus; priority: "low" | "normal" | "high";
  due_date: string | null; follow_up_date: string | null; next_action: string;
  version: number; source_record_id: string | null; created_at: string; updated_at: string;
}
export interface AffairRecord {
  id: string; workspace_id: string; title: string; body: string; occurred_on: string;
  important: boolean; created_by: string; source: "manual" | "feishu"; task_id: string | null; created_at: string;
}
export interface TaskActivity {
  id: string; workspace_id: string; task_id: string; actor_id: string; action: string;
  detail: Record<string, unknown>; created_at: string;
}
export interface TeamInvite { id: string; code: string; role: "admin" | "member"; expires_at: string; used_at: string | null }
export interface OutboxEvent { id: string; status: string; last_error: string | null; created_at: string }
export interface TeamSnapshot {
  workspaces: Workspace[]; members: Member[]; tasks: TeamTask[]; records: AffairRecord[];
  activities: TaskActivity[]; invites: TeamInvite[]; outbox: OutboxEvent[];
  profile: { id: string; display_name: string };
}
export const statusLabels: Record<TaskStatus, string> = {
  pending: "待接单", in_progress: "进行中", blocked: "受阻", review: "待验收", done: "已完成",
};
export const roleLabels: Record<TeamRole, string> = { owner: "所有者", admin: "管理员", member: "成员" };
