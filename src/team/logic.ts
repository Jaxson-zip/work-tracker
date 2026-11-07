import type { Member, TaskActivity, TeamRole, TeamTask } from "./types";

export const isManager = (role: TeamRole) => role !== "member";
export const memberName = (members: Member[], id: string | null | undefined) =>
  members.find((member) => member.user_id === id)?.display_name ?? "已离开的成员";

const byDue = (a: TeamTask, b: TeamTask) =>
  (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.created_at.localeCompare(b.created_at);

export function historyOf(activities: TaskActivity[], taskId: string): TaskActivity[] {
  return activities.filter((activity) => activity.task_id === taskId);
}

function touched(task: TeamTask, activities: TaskActivity[], userId: string): boolean {
  // 管理者改过标题或日期不算经手。
  return task.created_by === userId || activities.some((a) => a.task_id === task.id && a.actor_id === userId && a.action !== "edited");
}

export interface MyLists {
  incoming: TeamTask[];
  mine: TeamTask[];
  passed: TeamTask[];
  done: TeamTask[];
}
// 我的页面：等我接手的、我手上的、我交出去还没结束的、结束的。每条只出现一次。
export function myLists(tasks: TeamTask[], activities: TaskActivity[], userId: string): MyLists {
  const lists: MyLists = { incoming: [], mine: [], passed: [], done: [] };
  for (const task of tasks) {
    if (task.pending_owner_id === userId) lists.incoming.push(task);
    else if (!touched(task, activities, userId) && task.owner_id !== userId) continue;
    else if (task.status === "done") lists.done.push(task);
    else if (task.owner_id === userId && !task.pending_owner_id) lists.mine.push(task);
    else lists.passed.push(task);
  }
  lists.incoming.sort(byDue);
  lists.mine.sort(byDue);
  lists.passed.sort(byDue);
  lists.done.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return lists;
}

export interface TeamGroups {
  moving: TeamTask[];
  holders: { member: Member; tasks: TeamTask[] }[];
  done: TeamTask[];
}
// 全队：先看卡在交接路上的，再按人看各自手上的。
export function teamGroups(tasks: TeamTask[], members: Member[]): TeamGroups {
  const open = tasks.filter((task) => task.status === "open").sort(byDue);
  return {
    moving: open.filter((task) => task.pending_owner_id),
    holders: members
      .map((member) => ({ member, tasks: open.filter((task) => task.owner_id === member.user_id && !task.pending_owner_id) }))
      .filter((holder) => holder.tasks.length > 0),
    done: tasks.filter((task) => task.status === "done").sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  };
}

// 进页面时右边默认显示的待办：最该处理的那条。
export function firstTask(tasks: TeamTask[], activities: TaskActivity[], userId: string, team: boolean): TeamTask | null {
  if (team) return tasks.filter((task) => task.status === "open").sort(byDue)[0] ?? null;
  const lists = myLists(tasks, activities, userId);
  return lists.incoming[0] ?? lists.mine[0] ?? lists.passed[0] ?? null;
}

// 事情现在在哪：列表和详情都用这一句话。
export function whereNow(task: TeamTask, members: Member[], userId: string): string {
  const name = (id: string) => (id === userId ? "你" : memberName(members, id));
  if (task.status === "done") return `${name(task.owner_id)}已完成`;
  if (task.pending_owner_id) return `等${name(task.pending_owner_id)}接手`;
  return `在${name(task.owner_id)}手上`;
}

// 来源：等我接手时是交给我的人；否则是谁交给现在的负责人的，或者是负责人自己写的。
export function sourceOf(task: TeamTask, history: TaskActivity[], members: Member[], userId: string): string {
  if (task.pending_owner_id === userId && task.handoff_by) return `${memberName(members, task.handoff_by)} 交来的`;
  const last = [...history].reverse().find((a) => a.action === "accepted" && a.actor_id === task.owner_id);
  if (last) return `${memberName(members, last.detail.from)} 交来的`;
  if (task.created_by === task.owner_id) return "自己写的";
  return `${memberName(members, task.created_by)} 写的`;
}

// 交接链：写的人，加上每一位接手的人。
export function handoffChain(task: TeamTask, history: TaskActivity[]): string[] {
  const chain = [task.created_by];
  for (const activity of history) {
    if (activity.action === "accepted" && chain[chain.length - 1] !== activity.actor_id) chain.push(activity.actor_id);
  }
  return chain;
}

export type ChainState = "past" | "now" | "wait" | "done";
// 交接链上每个人的状态：经手过、现在在这、等接手、已完成。
export function chainNodes(task: TeamTask, history: TaskActivity[]): { id: string; state: ChainState }[] {
  const nodes = handoffChain(task, history).map((id): { id: string; state: ChainState } => ({ id, state: "past" }));
  const last = nodes[nodes.length - 1];
  if (task.status === "done") last.state = "done";
  else if (task.pending_owner_id) nodes.push({ id: task.pending_owner_id, state: "wait" });
  else last.state = "now";
  return nodes;
}

// 刚被退回时，要在待办上提示原因；有了新动作就不再提示。
export function lastRejection(history: TaskActivity[]): TaskActivity | null {
  const last = history.filter((a) => a.action !== "edited").pop();
  return last?.action === "rejected" ? last : null;
}

export type TaskAction = "accept" | "reject" | "withdraw" | "complete" | "handoff" | "reopen" | "delete";
// 页面只负责展示能做什么，真正的权限判断在 wt_command 里，这里要和它保持一致。
export function taskActions(task: TeamTask, history: TaskActivity[], userId: string, role: TeamRole): TaskAction[] {
  const manager = isManager(role);
  const isOwner = task.owner_id === userId;
  if (task.status === "done") return isOwner || task.created_by === userId || manager ? ["reopen"] : [];
  if (task.pending_owner_id === userId) return ["accept", "reject"];
  if (task.pending_owner_id) return isOwner || manager || task.handoff_by === userId ? ["withdraw"] : [];
  const actions: TaskAction[] = [];
  if (isOwner) actions.push("complete");
  if (isOwner || manager) actions.push("handoff");
  if (isOwner && task.created_by === userId && !history.some((a) => a.action === "handoff")) actions.push("delete");
  return actions;
}

// 和 wt_command 的 update_task 保持一致：交接中和完成后不能改。
export function canEdit(task: TeamTask, userId: string, role: TeamRole): boolean {
  return task.status === "open" && !task.pending_owner_id && (task.owner_id === userId || isManager(role));
}

// 交出去等了多久。管理者靠它分清谁真的卡住了。
export function waitText(task: TeamTask, history: TaskActivity[], now = Date.now()): string | null {
  if (!task.pending_owner_id) return null;
  const sent = history.filter((a) => a.action === "handoff").pop();
  if (!sent) return null;
  const hours = Math.floor((now - Date.parse(sent.created_at)) / 3600000);
  if (hours < 1) return "等了不到 1 小时";
  return hours < 24 ? `等了 ${hours} 小时` : `等了 ${Math.floor(hours / 24)} 天`;
}

const DAY = 86400000;
export function dueLabel(date: string, today: string): { text: string; overdue: boolean } {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / DAY);
  if (days < 0) return { text: `逾期 ${-days} 天`, overdue: true };
  if (days === 0) return { text: "今天到期", overdue: false };
  if (days === 1) return { text: "明天到期", overdue: false };
  const [, month, day] = date.split("-").map(Number);
  return { text: `${month}月${day}日到期`, overdue: false };
}
