import { supabase } from "../supabase";
import type { TeamSnapshot } from "./types";

// 只有 --mode demo 的构建才有演示模式，正式构建里这段连同 PGlite 都不会打包。
export const demoEnabled = import.meta.env.MODE === "demo";
export const demoPeople = [
  { id: "11111111-1111-4111-8111-111111111111", name: "林晓（管理者）" },
  { id: "22222222-2222-4222-8222-222222222222", name: "陈晨" },
  { id: "33333333-3333-4333-8333-333333333333", name: "周宁" },
];
let demoUserId = demoPeople[0].id;
export function setDemoUser(id: string) {
  demoUserId = id;
}

// 数据库错误是给开发者看的英文，这里转成用户能看懂的话。
const friendlyErrors: [RegExp, string][] = [
  [/Version conflict/, "别人刚改过这条待办，请刷新后再试"],
  [/Handoff pending/, "这条待办正在等对方接手，请先撤回"],
  [/Only the receiver/, "只有接手人可以接手或退回，可能已被撤回，请刷新"],
  [/No pending handoff/, "这条待办已经被处理了，请刷新"],
  [/Already the owner/, "对方已经是负责人了"],
  [/Owner must be/, "只能交给团队里的成员"],
  [/Task done/, "这条待办已经完成了"],
  [/Task not done/, "这条待办还没完成"],
  [/Reassign open tasks/, "请先把这位成员手上的待办交给别人"],
  [/Workspace owner is protected/, "不能修改团队创建者"],
  [/Invalid or expired invite/, "邀请码无效或已过期"],
  [/Already a member/, "你已经是这个团队的成员了"],
  [/Invalid mobile/, "手机号格式不正确"],
  [/Invalid note/, "请填写说明"],
  [/Invalid dueDate/, "日期格式不正确"],
  [/Invalid title|Invalid name|Invalid displayName/, "内容不能为空，也不能太长"],
  [/Forbidden/, "你没有权限做这个操作"],
  [/Task not found|Member not found/, "内容不存在，可能已被移除"],
];
export function errorText(message: string): string {
  return friendlyErrors.find(([pattern]) => pattern.test(message))?.[1] ?? "操作失败，请稍后再试";
}

// 通知已在数据库事务里入队。这里只是催一下立即发送，失败了定时任务会补发，不影响用户操作。
async function flushNotifications() {
  const { data } = await supabase!.auth.getSession();
  if (!data.session) return;
  await fetch("/api/notify/flush", { method: "POST", headers: { authorization: `Bearer ${data.session.access_token}` } });
}

export async function teamCommand<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (demoEnabled) {
    const { demoCommand } = await import("../demo/browser");
    try {
      return (await demoCommand(demoUserId, action, payload)) as T;
    } catch (cause) {
      throw new Error(errorText(cause instanceof Error ? cause.message : ""));
    }
  }
  if (!supabase) throw new Error("服务尚未配置");
  const { data, error } = await supabase.rpc("wt_command", { p_action: action, p_payload: payload });
  if (error) throw new Error(errorText(error.message));
  if (action !== "snapshot") void flushNotifications().catch(() => undefined);
  return data as T;
}

export const fetchTeamSnapshot = () => teamCommand<TeamSnapshot>("snapshot");
