import { supabase } from "../supabase";
import type { TeamSnapshot } from "./types";
export const demoEnabled = import.meta.env.DEV && import.meta.env.VITE_WORK_TRACKER_DEMO === "1";
let demoUserId = "11111111-1111-4111-8111-111111111111";
export function setDemoUser(id: string) { demoUserId = id; }
export async function teamCommand<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (demoEnabled) {
    const response = await fetch("/__demo/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: demoUserId, action, payload }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "本地演示数据库请求失败");
    return data as T;
  }
  if (!supabase) throw new Error("请先配置独立 Supabase 项目并执行数据库迁移。");
  const { data, error } = await supabase.rpc("wt_command", { p_action: action, p_payload: payload });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") throw new Error("团队数据库尚未初始化，请执行 supabase/migrations 中的 SQL。");
    throw new Error(error.message);
  }
  return data as T;
}
export const fetchTeamSnapshot = (workspaceId?: string) => teamCommand<TeamSnapshot>("snapshot", { workspaceId });
