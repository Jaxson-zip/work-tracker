import type { SupabaseClient } from "@supabase/supabase-js";
import { createIlinkWechatUin } from "./ilink.js";

export type IlinkConnectionStatus = "connected" | "error" | "disabled";

export type IlinkConnectionRow = {
  id: string;
  provider: "ilink";
  user_id: string;
  bot_token: string;
  base_url: string;
  get_updates_buf: string;
  wechat_uin: string;
  reply_to_user_id: string | null;
  context_token: string | null;
  context_updated_at: string | null;
  status: IlinkConnectionStatus;
  last_error: string | null;
  connected_at: string;
  last_polled_at: string | null;
  updated_at: string;
};

export type PublicIlinkConnection = {
  connected: boolean;
  status: IlinkConnectionStatus | "not_connected";
  connectedAt: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  hasReplyContext: boolean;
};

export async function upsertIlinkConnection(
  supabase: SupabaseClient,
  userId: string,
  botToken: string,
  baseUrl: string
): Promise<IlinkConnectionRow> {
  const nowIso = new Date().toISOString();
  const existing = await getIlinkConnectionByUserId(supabase, userId);
  const { data, error } = await supabase
    .from("bot_ilink_connections")
    .upsert(
      {
        provider: "ilink",
        user_id: userId,
        bot_token: botToken,
        base_url: baseUrl,
        get_updates_buf: "",
        wechat_uin: existing?.wechat_uin ?? createIlinkWechatUin(),
        reply_to_user_id: null,
        context_token: null,
        context_updated_at: null,
        status: "connected",
        last_error: null,
        connected_at: nowIso,
        last_polled_at: null,
        updated_at: nowIso,
      },
      { onConflict: "provider,user_id" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as IlinkConnectionRow;
}

export async function getIlinkConnectionByUserId(
  supabase: SupabaseClient,
  userId: string
): Promise<IlinkConnectionRow | null> {
  const { data, error } = await supabase
    .from("bot_ilink_connections")
    .select("*")
    .eq("provider", "ilink")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as IlinkConnectionRow | null) ?? null;
}

export async function fetchActiveIlinkConnections(supabase: SupabaseClient, limit = 50): Promise<IlinkConnectionRow[]> {
  const { data, error } = await supabase
    .from("bot_ilink_connections")
    .select("*")
    .eq("provider", "ilink")
    .eq("status", "connected")
    .order("last_polled_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as IlinkConnectionRow[];
}

export async function updateIlinkPollState(
  supabase: SupabaseClient,
  connectionId: string,
  patch: {
    cursor?: string;
    replyToUserId?: string;
    contextToken?: string;
    status?: IlinkConnectionStatus;
    lastError?: string | null;
  }
): Promise<void> {
  const nowIso = new Date().toISOString();
  const payload: Record<string, unknown> = {
    last_polled_at: nowIso,
    updated_at: nowIso,
  };
  if (patch.cursor !== undefined) payload.get_updates_buf = patch.cursor;
  if (patch.replyToUserId !== undefined) payload.reply_to_user_id = patch.replyToUserId;
  if (patch.contextToken !== undefined) {
    payload.context_token = patch.contextToken;
    payload.context_updated_at = nowIso;
  }
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.lastError !== undefined) payload.last_error = patch.lastError;

  const { error } = await supabase.from("bot_ilink_connections").update(payload).eq("id", connectionId);
  if (error) throw error;
}

export async function deleteIlinkConnection(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase
    .from("bot_ilink_connections")
    .delete()
    .eq("provider", "ilink")
    .eq("user_id", userId);
  if (error) throw error;
}

export function toPublicIlinkConnection(row: IlinkConnectionRow | null): PublicIlinkConnection {
  if (!row) {
    return {
      connected: false,
      status: "not_connected",
      connectedAt: null,
      lastPolledAt: null,
      lastError: null,
      hasReplyContext: false,
    };
  }

  return {
    connected: row.status === "connected",
    status: row.status,
    connectedAt: row.connected_at,
    lastPolledAt: row.last_polled_at,
    lastError: row.last_error,
    hasReplyContext: Boolean(row.reply_to_user_id && row.context_token),
  };
}
