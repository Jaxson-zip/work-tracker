import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTeamSnapshot, takeDemoMessages, teamCommand } from "./client";
import type { Execute, GroupMessage, TeamSnapshot } from "./types";

const POLL_MS = 15000;

// 团队数据的读取和写入：写完立即重新读取，页面只认数据库返回的结果。
export function useTeamData() {
  const [data, setData] = useState<TeamSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([]);
  const requestEpoch = useRef(0);
  const mounted = useRef(true);
  const mutationLock = useRef(false);

  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    try {
      const snapshot = await fetchTeamSnapshot();
      if (!mounted.current || epoch !== requestEpoch.current) return;
      setData(snapshot);
    } catch (cause) {
      if (mounted.current && epoch === requestEpoch.current) setError(cause instanceof Error ? cause.message : "读取失败，请刷新");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, POLL_MS);
    return () => {
      mounted.current = false;
      requestEpoch.current++;
      window.clearInterval(interval);
    };
  }, [load]);

  const workspace = data?.workspaces[0];

  const execute: Execute = async (action, payload, success = "已保存") => {
    if (mutationLock.current) return null;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setGroupMessages([]);
    try {
      const result = (await teamCommand(action, { workspaceId: workspace?.id, ...payload })) ?? {};
      if (!mounted.current) return result;
      setNotice(success);
      setGroupMessages(await takeDemoMessages());
      await load();
      return result;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "操作失败，请重试");
      return null;
    } finally {
      mutationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const clearNotice = useCallback(() => setNotice(""), []);
  const dismissGroupMessages = useCallback(() => setGroupMessages([]), []);

  return { data, workspace, busy, error, notice, clearNotice, groupMessages, dismissGroupMessages, execute, reload: load };
}
