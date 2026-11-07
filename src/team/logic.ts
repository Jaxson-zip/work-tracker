import type { TeamRole, TeamTask, TaskStatus } from "./types";
export function keyMatters(tasks: TeamTask[], userId: string, today: string): TeamTask[] {
  return tasks.filter(t => t.status !== "done" && (
    (t.created_by === userId && t.status === "review") ||
    (t.owner_id === userId && (t.priority === "high" || t.status === "blocked" || t.status === "pending" ||
      Boolean(t.due_date && t.due_date <= today) || Boolean(t.follow_up_date && t.follow_up_date <= today)))
  ));
}
export function availableTransitions(task: TeamTask, userId: string, role: TeamRole): TaskStatus[] {
  const admin = role !== "member";
  if (task.status === "review") return admin || task.created_by === userId ? ["done", "in_progress"] : [];
  if (task.status === "done") return admin || task.created_by === userId ? ["in_progress"] : [];
  if (!admin && task.owner_id !== userId) return [];
  if (task.status === "pending" || task.status === "blocked") return ["in_progress"];
  return ["review", "blocked"];
}
