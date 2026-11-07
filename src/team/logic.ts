import type { Member, TaskStatus, TeamRole, TeamTask } from "./types";

export const isOpen = (task: TeamTask) => task.status !== "done" && task.status !== "cancelled";

export type GroupKey = "incoming" | "returned" | "review" | "overdue" | "today" | "blocked" | "later" | "waiting";
export interface TaskGroup {
  key: GroupKey;
  title: string;
  tasks: TeamTask[];
}
const groupTitles: Record<GroupKey, string> = {
  incoming: "等我接收",
  returned: "转交被退回",
  review: "等我验收",
  overdue: "已逾期",
  today: "今天",
  blocked: "受阻",
  later: "之后",
  waiting: "等别人处理",
};
const groupOrder = Object.keys(groupTitles) as GroupKey[];

function classify(task: TeamTask, userId: string, today: string): GroupKey | null {
  if (task.pending_owner_id === userId) return "incoming";
  if (!isOpen(task)) return null;
  if (task.returned_to && (task.returned_to === userId || task.owner_id === userId)) return "returned";
  if (task.status === "review" && task.created_by === userId && task.owner_id !== userId) return "review";
  if (task.owner_id !== userId) return null;
  // 已经交出去或提交验收的事，球不在我这里，但还要看得到，防止被遗忘。
  if (task.pending_owner_id || task.status === "review") return "waiting";
  if (task.due_date && task.due_date < today) return "overdue";
  if (task.due_date === today || (task.follow_up_date && task.follow_up_date <= today)) return "today";
  if (task.status === "blocked") return "blocked";
  return "later";
}

function byUrgency(a: TeamTask, b: TeamTask) {
  if ((a.priority === "high") !== (b.priority === "high")) return a.priority === "high" ? -1 : 1;
  return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.created_at.localeCompare(b.created_at);
}

// 把“我的事项”按“现在该先做什么”分组，每件事只出现一次。
export function focusGroups(tasks: TeamTask[], userId: string, today: string): TaskGroup[] {
  const buckets = new Map<GroupKey, TeamTask[]>();
  for (const task of tasks) {
    const key = classify(task, userId, today);
    if (key) buckets.set(key, [...(buckets.get(key) ?? []), task]);
  }
  return groupOrder
    .filter((key) => buckets.has(key))
    .map((key) => ({ key, title: groupTitles[key], tasks: buckets.get(key)!.sort(byUrgency) }));
}

export function focusSummary(groups: TaskGroup[]): string {
  const count = (key: GroupKey) => groups.find((group) => group.key === key)?.tasks.length ?? 0;
  const parts = [
    count("incoming") && `${count("incoming")} 件等你接收`,
    count("returned") && `${count("returned")} 件被退回`,
    count("review") && `${count("review")} 件等你验收`,
    count("overdue") && `${count("overdue")} 件已逾期`,
    count("today") && `今天 ${count("today")} 件`,
  ].filter(Boolean);
  return parts.length ? parts.join("，") : "眼下没有紧急的事";
}

export type TaskAction =
  | { kind: "accept" | "withdraw" | "ack" | "reject" | "transfer"; label: string; primary?: boolean; inline: boolean }
  | { kind: "status"; label: string; status: TaskStatus; reason?: string; primary?: boolean; inline: boolean };

function statusActions(task: TeamTask, isOwner: boolean, isCreator: boolean, manager: boolean): TaskAction[] {
  if (task.status === "review") {
    if (!isCreator && !manager) return [];
    return [
      { kind: "status", label: "验收通过", status: "done", primary: true, inline: true },
      { kind: "status", label: "退回修改", status: "in_progress", reason: "哪里需要修改？", inline: true },
    ];
  }
  if (!isOwner && !manager) return [];
  const selfOwned = isOwner && isCreator;
  const actions: TaskAction[] = [];
  if (task.status === "pending")
    actions.push({ kind: "status", label: "开始", status: "in_progress", primary: !selfOwned, inline: !selfOwned });
  // 受阻时下一步是解决阻碍，所以突出“恢复进行”，完成放进详情。
  const blocked = task.status === "blocked";
  if (blocked) actions.push({ kind: "status", label: "恢复进行", status: "in_progress", primary: true, inline: true });
  if (selfOwned) actions.push({ kind: "status", label: "完成", status: "done", primary: !blocked, inline: !blocked });
  else if (task.status === "in_progress")
    actions.push({ kind: "status", label: "提交验收", status: "review", primary: true, inline: true });
  if (task.status === "in_progress")
    actions.push({ kind: "status", label: "标记受阻", status: "blocked", reason: "卡在哪里？需要谁帮忙？", inline: false });
  return actions;
}

// 页面只负责展示能做什么，真正的权限判断在数据库函数里，这里要和它保持一致。
export function taskActions(task: TeamTask, userId: string, role: TeamRole): TaskAction[] {
  const manager = role !== "member";
  const isOwner = task.owner_id === userId;
  const isCreator = task.created_by === userId;
  const canManage = isOwner || isCreator || manager;
  if (task.pending_owner_id === userId) {
    return [
      { kind: "accept", label: "接收", primary: true, inline: true },
      { kind: "reject", label: "退回", inline: true },
    ];
  }
  if (task.pending_owner_id) {
    return isOwner || manager || task.handoff_by === userId ? [{ kind: "withdraw", label: "撤回转交", inline: true }] : [];
  }
  const actions: TaskAction[] = [];
  if (task.returned_to && (task.returned_to === userId || isOwner || manager)) {
    actions.push({ kind: "ack", label: "知道了", inline: true });
    if (canManage) actions.push({ kind: "transfer", label: "转给别人", inline: true });
  }
  const reopen = (reason: string): TaskAction => ({ kind: "status", label: "重新打开", status: "in_progress", reason, inline: true });
  if (task.status === "done") return isCreator || manager ? [reopen("为什么要重新打开？")] : [];
  if (task.status === "cancelled") return canManage ? [reopen("为什么要恢复？")] : [];
  actions.push(...statusActions(task, isOwner, isCreator, manager));
  if (canManage && !task.returned_to) actions.push({ kind: "transfer", label: "转交", inline: task.status !== "review" });
  if (canManage) actions.push({ kind: "status", label: "取消这件事", status: "cancelled", reason: "为什么取消？", inline: false });
  return actions;
}

export interface DueLabel {
  text: string;
  overdue: boolean;
}
const DAY = 86400000;
export function dueLabel(date: string, today: string): DueLabel {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / DAY);
  if (days < 0) return { text: `逾期 ${-days} 天`, overdue: true };
  if (days === 0) return { text: "今天到期", overdue: false };
  if (days === 1) return { text: "明天到期", overdue: false };
  const [, month, day] = date.split("-").map(Number);
  return { text: `${month}月${day}日到期`, overdue: false };
}

export function membersByDepartment(members: Member[]): { department: string; members: Member[] }[] {
  const departments = [...new Set(members.map((member) => member.department))].sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "zh-CN"),
  );
  return departments.map((department) => ({ department, members: members.filter((member) => member.department === department) }));
}

// 最近完成的事收在页面底部，确认没丢，也能重新打开。
export function recentlyDone(tasks: TeamTask[], userId: string, limit = 5): TeamTask[] {
  return tasks
    .filter((task) => task.status === "done" && (task.owner_id === userId || task.created_by === userId))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
}
