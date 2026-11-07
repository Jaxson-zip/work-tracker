import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTeamSnapshot, teamCommand } from "./client";
import type { Execute, TeamSnapshot } from "./types";

const POLL_MS = 15000;
const NOTICE_MS = 2500;

// 团队数据的读取和写入：写完立即重新读取，页面只认数据库返回的结果。
export function useTeamData() {
  const [data, setData] = useState<TeamSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const workspace = data?.workspaces[0];

  const execute: Execute = async (action, payload) => {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    try {
      await teamCommand(action, { workspaceId: workspace?.id, ...payload });
      if (!mounted.current) return true;
      setNotice("已保存");
      await load();
      return true;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "操作失败，请重试");
      return false;
    } finally {
      mutationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return { data, workspace, busy, error, notice, execute, reload: load };
}
