import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { DEMO_ITEM_TITLES, isDemoItemTitle } from "./demoItems";
import { createId } from "./storage";
import type { MemoItem, MemoList } from "./types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

const legacyDefaultListIds = new Set([
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
]);

type RemoteMemoItem = {
  id: string;
  user_id: string;
  list_id: string | null;
  title: string;
  body: string;
  kind: "task" | "note";
  status: "open" | "done" | "purged";
  priority: "low" | "normal" | "high";
  repeat_rule: "none" | "daily" | "weekly" | "monthly" | null;
  due_date: string | null;
  reminder_at: string | null;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type RemoteMemoList = {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  archived: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CloudStats = {
  items: number;
  lists: number;
  fetchedAt: string;
};

export type BotBindingCode = {
  code: string;
  expiresAt: string;
  instruction: string;
};

export type IlinkConnection = {
  connected: boolean;
  status: "not_connected" | "connected" | "error" | "disabled";
  connectedAt: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  hasReplyContext: boolean;
};

export type IlinkQrCode = {
  qrcodeId: string;
  qrcodeImage: string;
  expiresInSeconds: number;
};

export type IlinkQrStatus = {
  status: "pending" | "scanned" | "expired" | "confirmed";
  connection?: IlinkConnection;
};

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(callback: (session: Session | null) => void): () => void {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email: string, password: string): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data.session;
}

export async function signUpWithPassword(email: string, password: string): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error) throw error;
  return data.session;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function createBotBindingCode(accessToken: string): Promise<BotBindingCode> {
  const response = await fetch("/api/bot/binding-code", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<BotBindingCode> & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "生成绑定码失败");
  if (!payload.code || !payload.expiresAt || !payload.instruction) throw new Error("绑定码响应不完整");
  return {
    code: payload.code,
    expiresAt: payload.expiresAt,
    instruction: payload.instruction,
  };
}

export async function createIlinkQrCode(accessToken: string): Promise<IlinkQrCode> {
  const response = await fetch("/api/bot/ilink-qr", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<IlinkQrCode> & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "生成微信二维码失败");
  if (!payload.qrcodeId || !payload.qrcodeImage) throw new Error("微信二维码响应不完整");
  return {
    qrcodeId: payload.qrcodeId,
    qrcodeImage: payload.qrcodeImage,
    expiresInSeconds: payload.expiresInSeconds ?? 300,
  };
}

export async function checkIlinkQrCode(accessToken: string, qrcodeId: string): Promise<IlinkQrStatus> {
  const response = await fetch("/api/bot/ilink-status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ qrcodeId }),
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<IlinkQrStatus> & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "读取微信扫码状态失败");
  if (payload.status !== "pending" && payload.status !== "scanned" && payload.status !== "expired" && payload.status !== "confirmed") {
    throw new Error("微信扫码状态响应不完整");
  }
  return payload as IlinkQrStatus;
}

export async function fetchIlinkConnection(accessToken: string): Promise<IlinkConnection> {
  const response = await fetch("/api/bot/ilink-connection", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "status" }),
  });
  const payload = (await response.json().catch(() => ({}))) as { connection?: IlinkConnection; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "读取微信连接失败");
  if (!payload.connection) throw new Error("微信连接响应不完整");
  return payload.connection;
}

export async function disconnectIlinkConnection(accessToken: string): Promise<IlinkConnection> {
  const response = await fetch("/api/bot/ilink-connection", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "disconnect" }),
  });
  const payload = (await response.json().catch(() => ({}))) as { connection?: IlinkConnection; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "断开微信连接失败");
  if (!payload.connection) throw new Error("微信连接响应不完整");
  return payload.connection;
}

export async function syncWithCloud(
  localItems: MemoItem[],
  localLists: MemoList[],
  user: User,
  options?: { shouldAbort?: () => boolean }
): Promise<{ items: MemoItem[]; lists: MemoList[]; aborted?: boolean }> {
  if (!supabase) return { items: localItems, lists: localLists };

  const [{ data: itemData, error: itemError }, { data: listData, error: listError }] = await Promise.all([
    supabase.from("memo_items").select("*").eq("user_id", user.id),
    supabase.from("memo_lists").select("*").eq("user_id", user.id),
  ]);

  if (itemError) throw itemError;
  if (listError) throw listError;

  const remoteItems = ((itemData ?? []) as RemoteMemoItem[]).map(itemFromRemote);
  const remoteLists = ((listData ?? []) as RemoteMemoList[]).map(listFromRemote);
  const sanitizedLocal = sanitizeLegacyDefaultListIds(localItems, localLists, remoteItems, remoteLists);
  const mergedLists = mergeListsByNewest(sanitizedLocal.lists, remoteLists);
  const mergedItems = mergeItemsByNewest(sanitizedLocal.items, remoteItems);

  if (options?.shouldAbort?.()) {
    return { items: localItems, lists: localLists, aborted: true };
  }

  const listPayload = mergedLists.map((list) => listToRemote(list, user.id));
  const itemPayload = mergedItems.map((item) => itemToRemote(item, user.id));

  if (listPayload.length > 0) {
    if (options?.shouldAbort?.()) {
      return { items: localItems, lists: localLists, aborted: true };
    }
    const { error: upsertListError } = await supabase.from("memo_lists").upsert(listPayload, { onConflict: "id" });
    if (upsertListError) throw upsertListError;
  }

  if (itemPayload.length > 0) {
    if (options?.shouldAbort?.()) {
      return { items: localItems, lists: localLists, aborted: true };
    }
    const { error: upsertItemError } = await supabase.from("memo_items").upsert(itemPayload, { onConflict: "id" });
    if (upsertItemError) throw upsertItemError;
  }

  return { items: mergedItems, lists: mergedLists };
}

export async function fetchCloudStats(user: User): Promise<CloudStats> {
  if (!supabase) return { items: 0, lists: 0, fetchedAt: new Date().toISOString() };

  const [{ count: itemCount, error: itemError }, { count: listCount, error: listError }] = await Promise.all([
    supabase.from("memo_items").select("id", { count: "exact", head: true }).eq("user_id", user.id).neq("status", "purged"),
    supabase.from("memo_lists").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("deleted_at", null),
  ]);

  if (itemError) throw itemError;
  if (listError) throw listError;

  return {
    items: itemCount ?? 0,
    lists: listCount ?? 0,
    fetchedAt: new Date().toISOString(),
  };
}

export async function deleteItemFromCloud(itemId: string, userId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("memo_items").delete().eq("user_id", userId).eq("id", itemId);
  if (error) throw error;
}

export async function deleteItemsFromCloud(itemIds: string[], userId: string): Promise<void> {
  if (!supabase || itemIds.length === 0) return;
  const { error } = await supabase.from("memo_items").delete().eq("user_id", userId).in("id", itemIds);
  if (error) throw error;
}

export async function purgeItemsInCloud(itemIds: string[], userId: string, updatedAt: string): Promise<void> {
  if (!supabase || itemIds.length === 0) return;
  const { error } = await supabase
    .from("memo_items")
    .update({
      status: "purged",
      archived: false,
      deleted_at: updatedAt,
      updated_at: updatedAt,
    })
    .eq("user_id", userId)
    .in("id", itemIds);
  if (error) throw error;
}

export async function purgeDemoItemsInCloud(userId: string, updatedAt: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("memo_items")
    .update({
      status: "purged",
      archived: false,
      deleted_at: updatedAt,
      updated_at: updatedAt,
    })
    .eq("user_id", userId)
    .in("title", DEMO_ITEM_TITLES);
  if (error) throw error;
}

export function mergeItemsByNewest(localItems: MemoItem[], remoteItems: MemoItem[]): MemoItem[] {
  const map = new Map<string, MemoItem>();
  const purgedDemoTitles = new Set(
    [...localItems, ...remoteItems]
      .filter((item) => item.status === "purged" && isDemoItemTitle(item.title))
      .map((item) => item.title)
  );

  for (const item of [...remoteItems, ...localItems]) {
    if (purgedDemoTitles.has(item.title) && item.status !== "purged" && isDemoItemTitle(item.title)) continue;

    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      continue;
    }

    if (existing.status === "purged" && item.status !== "purged") continue;
    if (item.status === "purged" && existing.status !== "purged") {
      map.set(item.id, item);
      continue;
    }

    if (new Date(item.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      map.set(item.id, item);
    }
  }

  return [...map.values()].sort(sortItems);
}

export function mergeListsByNewest(localLists: MemoList[], remoteLists: MemoList[]): MemoList[] {
  const map = new Map<string, MemoList>();

  for (const list of [...remoteLists, ...localLists]) {
    const existing = map.get(list.id);
    if (!existing) {
      map.set(list.id, list);
      continue;
    }

    if (existing.deletedAt && !list.deletedAt) continue;
    if (list.deletedAt && !existing.deletedAt) {
      map.set(list.id, list);
      continue;
    }

    if (new Date(list.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      map.set(list.id, list);
    }
  }

  return [...map.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function sanitizeLegacyDefaultListIds(
  localItems: MemoItem[],
  localLists: MemoList[],
  remoteItems: MemoItem[],
  remoteLists: MemoList[]
): { items: MemoItem[]; lists: MemoList[] } {
  const remoteIds = new Set(remoteLists.map((list) => list.id));
  const remoteBySeedKey = new Map(
    remoteLists
      .filter((list) => !list.deletedAt)
      .map((list) => [`${list.name}::${list.emoji}`, list.id] as const)
  );
  const replacements = new Map<string, string>();
  const dropLocalListIds = new Set<string>();

  for (const list of localLists) {
    if (!legacyDefaultListIds.has(list.id)) continue;
    const remoteMatchId = remoteBySeedKey.get(`${list.name}::${list.emoji}`);
    if (remoteMatchId) {
      replacements.set(list.id, remoteMatchId);
      dropLocalListIds.add(list.id);
      continue;
    }
    if (remoteIds.has(list.id)) continue;
    replacements.set(list.id, createId());
  }

  const hasRemoteData = remoteLists.some((list) => !list.deletedAt) || remoteItems.some((item) => item.status !== "purged");

  return {
    lists: localLists
      .filter((list) => !dropLocalListIds.has(list.id))
      .map((list) => {
        const nextId = replacements.get(list.id);
        return nextId ? { ...list, id: nextId } : list;
      }),
    items: localItems
      .filter((item) => !(hasRemoteData && isDemoItemTitle(item.title) && item.status !== "purged"))
      .map((item) => {
        const nextListId = item.listId ? replacements.get(item.listId) : null;
        return nextListId ? { ...item, listId: nextListId } : item;
      }),
  };
}

export function sortItems(a: MemoItem, b: MemoItem): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.status !== b.status) return a.status === "open" ? -1 : 1;
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function itemToRemote(item: MemoItem, userId: string): RemoteMemoItem {
  return {
    id: item.id,
    user_id: userId,
    list_id: item.listId,
    title: item.title,
    body: item.body,
    kind: item.kind,
    status: item.status,
    priority: item.priority,
    repeat_rule: item.repeatRule,
    due_date: item.dueDate,
    reminder_at: item.reminderAt,
    tags: item.tags,
    pinned: item.pinned,
    archived: item.archived,
    deleted_at: item.deletedAt,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

function itemFromRemote(item: RemoteMemoItem): MemoItem {
  return {
    id: item.id,
    listId: item.list_id,
    title: item.title,
    body: item.body,
    kind: item.kind,
    status: item.status === "open" || item.status === "done" || item.status === "purged" ? item.status : "open",
    priority: item.priority,
    repeatRule:
      item.repeat_rule === "daily" || item.repeat_rule === "weekly" || item.repeat_rule === "monthly"
        ? item.repeat_rule
        : "none",
    dueDate: item.due_date,
    reminderAt: item.reminder_at,
    tags: item.tags ?? [],
    pinned: item.pinned,
    archived: item.archived,
    deletedAt: item.deleted_at,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function listToRemote(list: MemoList, userId: string): RemoteMemoList {
  return {
    id: list.id,
    user_id: userId,
    name: list.name,
    emoji: list.emoji,
    archived: list.archived,
    deleted_at: list.deletedAt,
    created_at: list.createdAt,
    updated_at: list.updatedAt,
  };
}

function listFromRemote(list: RemoteMemoList): MemoList {
  return {
    id: list.id,
    name: list.name,
    emoji: list.emoji,
    archived: list.archived,
    deletedAt: list.deleted_at,
    createdAt: list.created_at,
    updatedAt: list.updated_at,
  };
}
