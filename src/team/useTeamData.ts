import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTeamSnapshot, teamCommand } from "./client";
import type { Execute, TeamSnapshot } from "./types";

const POLL_MS = 30000;
const NOTICE_MS = 2500;
const SWITCHING_ACTIONS = new Set(["create_workspace", "join_workspace"]);

// 团队数据的读取和写入：写完立即重新读取，页面只认数据库返回的结果。
export function useTeamData() {
  const [data, setData] = useState<TeamSnapshot | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestEpoch = useRef(0);
  const mounted = useRef(true);
  const mutationLock = useRef(false);
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;

  const load = useCallback(async (id?: string) => {
    const epoch = ++requestEpoch.current;
    try {
      const snapshot = await fetchTeamSnapshot(id);
      if (!mounted.current || epoch !== requestEpoch.current) return;
      setData(snapshot);
      setError("");
    } catch (cause) {
      if (mounted.current && epoch === requestEpoch.current) setError(cause instanceof Error ? cause.message : "读取失败，请刷新");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load(workspaceId);
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void load(workspaceId);
    }, POLL_MS);
    return () => {
      mounted.current = false;
      requestEpoch.current++;
      window.clearInterval(interval);
    };
  }, [workspaceId, load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const workspace = data?.workspaces.find((item) => item.id === workspaceId) ?? data?.workspaces[0];

  const execute: Execute = async (action, payload) => {
    if (mutationLock.current) return { ok: false };
    mutationLock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await teamCommand(action, { workspaceId: workspace?.id, ...payload });
      if (!mounted.current) return { ok: true, data: result };
      setNotice("已保存");
      if (SWITCHING_ACTIONS.has(action)) setWorkspaceId(String(result.id));
      await load(SWITCHING_ACTIONS.has(action) ? String(result.id) : workspaceRef.current);
      return { ok: true, data: result };
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "操作失败，请重试");
      return { ok: false };
    } finally {
      mutationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return { data, workspace, busy, error, notice, execute, setWorkspaceId, reload: () => load(workspaceRef.current) };
}
