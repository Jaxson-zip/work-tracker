import { type DragEvent, type FormEvent, type MouseEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  createId,
  loadAppSettings,
  loadFocusSettings,
  loadItems,
  loadLastSync,
  loadLists,
  saveAppSettings,
  nowIso,
  saveFocusSettings,
  saveItems,
  saveLastSync,
  saveLists,
} from "./storage";
import {
  checkIlinkQrCode,
  createIlinkQrCode,
  disconnectIlinkConnection,
  fetchIlinkConnection,
  fetchCloudStats,
  getSession,
  isSupabaseConfigured,
  onAuthChange,
  purgeDemoItemsInCloud,
  purgeItemsInCloud,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  sortItems,
  syncWithCloud,
  type CloudStats,
  type IlinkConnection,
  type IlinkQrCode,
  type IlinkQrStatus,
} from "./supabase";
import { isDemoItemTitle } from "./demoItems";
import type { DraftItem, MemoItem, MemoList, Priority, RepeatRule, ViewFilter } from "./types";

type SyncSnapshot = {
  items: MemoItem[];
  lists: MemoList[];
  mutationVersion: number;
  signature: string;
};
import { parseTaskInput } from "./taskInputParser";
import { addDays, getToday, monthKey, parseMonthKey, shiftMonth, shiftYear, toDateKey } from "./dateUtils";

const emptyDraft: DraftItem = {
  title: "",
  body: "",
  kind: "task",
  priority: "normal",
  repeatRule: "none",
  dueDate: null,
  reminderAt: null,
  tags: "",
  listId: null,
};

const primaryViews: Array<{ id: ViewFilter; label: string; icon: IconName }> = [
  { id: "today", label: "今天", icon: "calendar" },
  { id: "upcoming", label: "最近7天", icon: "week" },
  { id: "inbox", label: "收集箱", icon: "tray" },
];

type RailPanel = "tasks" | "calendar" | "matrix" | "focus" | "search" | "sync" | "reminders" | "help";
type SortMode = "smart" | "time" | "priority";
type CalendarViewMode = "day" | "month" | "year";
type MatrixQuadrant = "urgentImportant" | "important" | "urgent" | "later";
type ReminderPermissionState = NotificationPermission | "unsupported";
type LocalSyncStats = {
  items: number;
  openItems: number;
  deletedItems: number;
  lists: number;
  activeLists: number;
};

const defaultListsSeed: Array<Pick<MemoList, "id" | "name" | "emoji">> = [
  { id: "11111111-1111-4111-8111-111111111111", name: "欢迎", emoji: "👋" },
  { id: "22222222-2222-4222-8222-222222222222", name: "工作任务", emoji: "💼" },
  { id: "33333333-3333-4333-8333-333333333333", name: "个人备忘", emoji: "🏠" },
  { id: "44444444-4444-4444-8444-444444444444", name: "学习安排", emoji: "📖" },
];

const matrixQuadrants: Array<{ id: MatrixQuadrant; title: string; hint: string; rule: string }> = [
  { id: "urgentImportant", title: "重要且紧急", hint: "马上处理", rule: "高优先级 + 今天" },
  { id: "important", title: "重要不紧急", hint: "安排时间", rule: "高优先级" },
  { id: "urgent", title: "紧急不重要", hint: "快速处理", rule: "今天" },
  { id: "later", title: "不紧急不重要", hint: "延后或删除", rule: "低优先级" },
];

export default function App() {
  const initialFocusSettings = useMemo(() => loadFocusSettings(), []);
  const initialAppSettings = useMemo(() => loadAppSettings(), []);
  const [lists, setLists] = useState<MemoList[]>(() => initialLists());
  const [items, setItems] = useState<MemoItem[]>(() => initialItems());
  const [draft, setDraft] = useState<DraftItem>(emptyDraft);
  const [view, setView] = useState<ViewFilter>(() => (initialPanel() === "calendar" ? "today" : "inbox"));
  const [query, setQuery] = useState("");
  const [activePanel, setActivePanel] = useState<RailPanel>(() => initialPanel());
  const [calendarMonth, setCalendarMonth] = useState(() => monthKey(new Date()));
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>("month");
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => getToday());
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [listNameDraft, setListNameDraft] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [calendarDraftDate, setCalendarDraftDate] = useState<string | null>(null);
  const [calendarDraftTitle, setCalendarDraftTitle] = useState("");
  const [matrixDraftQuadrant, setMatrixDraftQuadrant] = useState<MatrixQuadrant | null>(null);
  const [matrixDraftTitle, setMatrixDraftTitle] = useState("");
  const [deleteListId, setDeleteListId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [pendingSync, setPendingSync] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => loadLastSync());
  const [cloudStats, setCloudStats] = useState<CloudStats | null>(null);
  const [cloudStatsLoading, setCloudStatsLoading] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("smart");
  const [moreOpen, setMoreOpen] = useState(false);
  const [addExpanded, setAddExpanded] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [tagNameDraft, setTagNameDraft] = useState("");
  const [clearExamplesOpen, setClearExamplesOpen] = useState(false);
  const [clearTrashOpen, setClearTrashOpen] = useState(false);
  const [listManagerOpen, setListManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultListId, setDefaultListId] = useState<string | null>(initialAppSettings.defaultListId);
  const [hardDeleteListId, setHardDeleteListId] = useState<string | null>(null);
  const [undoItem, setUndoItem] = useState<MemoItem | null>(null);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [focusMinutes, setFocusMinutes] = useState(initialFocusSettings.focusMinutes);
  const [breakMinutes, setBreakMinutes] = useState(initialFocusSettings.breakMinutes);
  const [focusSeconds, setFocusSeconds] = useState(initialFocusSettings.focusMinutes * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<ReminderPermissionState>(() =>
    "Notification" in window ? Notification.permission : "unsupported"
  );
  const latestItemsRef = useRef(items);
  const latestListsRef = useRef(lists);
  const sessionRef = useRef(session);
  const syncingRef = useRef(false);
  const queuedSyncRef = useRef(false);
  const queuedSyncSnapshotRef = useRef<SyncSnapshot | null>(null);
  const localMutationVersionRef = useRef(0);
  const inFlightSyncSignatureRef = useRef("");
  const lastSyncedSignatureRef = useRef("");
  const notifiedReminderRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    latestItemsRef.current = items;
    saveItems(items);
  }, [items]);

  useEffect(() => {
    latestListsRef.current = lists;
    saveLists(lists);
  }, [lists]);

  useEffect(() => {
    saveFocusSettings({ focusMinutes, breakMinutes });
  }, [breakMinutes, focusMinutes]);

  useEffect(() => {
    saveAppSettings({ defaultListId });
  }, [defaultListId]);

  useEffect(() => {
    if (defaultListId && !lists.some((list) => list.id === defaultListId && !list.archived && !list.deletedAt)) {
      setDefaultListId(null);
    }
  }, [defaultListId, lists]);

  useEffect(() => {
    sessionRef.current = session;
    if (!session) {
      setCloudStats(null);
      setPendingSync(false);
      lastSyncedSignatureRef.current = "";
      queuedSyncSnapshotRef.current = null;
    } else {
      setPassword("");
      setAuthMessage("");
    }
  }, [session]);

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch((error) => setSyncError(error.message));
    return onAuthChange(setSession);
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user || !isSupabaseConfigured) return;

    const currentSignature = syncSignature(items, lists);
    const scheduledSnapshot: SyncSnapshot = {
      items,
      lists,
      mutationVersion: localMutationVersionRef.current,
      signature: currentSignature,
    };
    if (syncingRef.current) {
      if (currentSignature !== inFlightSyncSignatureRef.current) {
        queuedSyncRef.current = true;
        queuedSyncSnapshotRef.current = scheduledSnapshot;
        setPendingSync(true);
      }
      return;
    }

    if (!lastSyncedSignatureRef.current) return;
    if (currentSignature === lastSyncedSignatureRef.current) return;

    setPendingSync(true);
    const timer = window.setTimeout(() => {
      void runSync(scheduledSnapshot);
    }, 1200);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, lists, session?.user.id]);

  useEffect(() => {
    if (!session?.user || !isSupabaseConfigured) return;

    const syncIfVisible = () => {
      if (document.visibilityState === "hidden") return;
      void runSync();
    };

    const intervalId = window.setInterval(syncIfVisible, 30000);
    window.addEventListener("focus", syncIfVisible);
    document.addEventListener("visibilitychange", syncIfVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", syncIfVisible);
      document.removeEventListener("visibilitychange", syncIfVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    if (!focusRunning) return;

    const timer = window.setInterval(() => {
      setFocusSeconds((seconds) => {
        if (seconds <= 1) {
          showNotice("计时结束，可以休息一下。");
          setFocusRunning(false);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [focusRunning]);

  useEffect(() => {
    const checkDueReminders = () => {
      const now = Date.now();
      const staleAfter = now - 60_000;

      for (const item of items) {
        if (!item.reminderAt || item.status !== "open" || item.deletedAt || item.archived) continue;
        const reminderTime = new Date(item.reminderAt).getTime();
        if (!Number.isFinite(reminderTime) || reminderTime > now || reminderTime < staleAfter) continue;

        const reminderKey = `${item.id}:${item.reminderAt}`;
        if (notifiedReminderRef.current.has(reminderKey)) continue;
        notifiedReminderRef.current.add(reminderKey);

        showNotice(`提醒：${item.title}`);
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("待办提醒", {
            body: item.title,
            tag: reminderKey,
          });
        }
      }
    };

    checkDueReminders();
    const intervalId = window.setInterval(checkDueReminders, 30_000);
    return () => window.clearInterval(intervalId);
  }, [items]);

  const activeLists = useMemo(() => lists.filter((list) => !list.archived && !list.deletedAt), [lists]);
  const selectedList = useMemo(
    () => activeLists.find((list) => list.id === selectedListId) ?? null,
    [activeLists, selectedListId]
  );
  const counts = useMemo(() => getCounts(items), [items]);
  const tagStats = useMemo(() => getTagStats(items), [items]);
  const demoItemCount = useMemo(() => countDemoItems(items), [items]);
  const localSyncStats = useMemo(() => getLocalSyncStats(items, lists), [items, lists]);
  const matrixGroups = useMemo(() => groupMatrixItems(items), [items]);
  const focusItems = useMemo(() => getFocusCandidates(items), [items]);
  const visibleItems = useMemo(
    () => filterItems(items, view, query, selectedListId, selectedTag, sortMode),
    [items, query, selectedListId, selectedTag, sortMode, view]
  );
  const groupedItems = useMemo(() => groupItems(visibleItems, view, activeLists, selectedListId, selectedTag), [
    activeLists,
    selectedListId,
    selectedTag,
    visibleItems,
    view,
  ]);
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );
  const deleteListTarget = useMemo(
    () => lists.find((list) => list.id === deleteListId) ?? null,
    [deleteListId, lists]
  );
  const hardDeleteListTarget = useMemo(
    () => lists.find((list) => list.id === hardDeleteListId) ?? null,
    [hardDeleteListId, lists]
  );

  useEffect(() => {
    if (!selectedListId) return;
    if (activeLists.some((list) => list.id === selectedListId)) return;
    setSelectedListId(null);
    setEditingListId((current) => (current === selectedListId ? null : current));
    setDraft((current) => (current.listId === selectedListId ? { ...current, listId: null } : current));
  }, [activeLists, selectedListId]);

  function markLocalMutation() {
    localMutationVersionRef.current += 1;
  }

  function updateItems(updater: (current: MemoItem[]) => MemoItem[]) {
    markLocalMutation();
    setItems((current) => updater(current).sort(sortItems));
  }

  function updateLists(updater: (current: MemoList[]) => MemoList[]) {
    markLocalMutation();
    setLists((current) => updater(current));
  }

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedInput = parseTaskInput(draft.title);
    const taggedTitle = splitInlineTags(parsedInput.title);
    const title = taggedTitle.title;
    if (!title) return;

    const createdAt = nowIso();
    const item: MemoItem = {
      id: createId(),
      listId: draft.listId ?? selectedListId ?? defaultListId,
      title,
      body: draft.body.trim(),
      kind: draft.kind,
      status: "open",
      priority: draft.priority,
      repeatRule: draft.kind === "task" ? draft.repeatRule : "none",
      dueDate: draft.kind === "task" ? draft.dueDate ?? parsedInput.dueDate : null,
      reminderAt: draft.kind === "task" ? draft.reminderAt ?? parsedInput.reminderAt : null,
      tags: mergeTags(taggedTitle.tags, parseTags(draft.tags)),
      pinned: false,
      archived: false,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    };

    updateItems((current) => [item, ...current]);
    setDraft({ ...emptyDraft, kind: draft.kind, listId: selectedListId });
    setAddExpanded(false);
  }

  function openCalendarAdd(dateKey: string) {
    setCalendarDraftDate(dateKey);
    setCalendarDraftTitle("");
    window.setTimeout(() => document.getElementById("calendar-task-title")?.focus(), 0);
  }

  function addCalendarItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!calendarDraftDate) return;

    const parsedInput = parseTaskInput(calendarDraftTitle, new Date(`${calendarDraftDate}T09:00:00`), {
      rollPastTime: false,
    });
    const taggedTitle = splitInlineTags(parsedInput.title);
    if (!taggedTitle.title) return;

    const createdAt = nowIso();
    const item: MemoItem = {
      id: createId(),
      listId: selectedListId,
      title: taggedTitle.title,
      body: "",
      kind: "task",
      status: "open",
      priority: "normal",
      repeatRule: "none",
      dueDate: parsedInput.dueDate ?? calendarDraftDate,
      reminderAt: parsedInput.reminderAt,
      tags: taggedTitle.tags,
      pinned: false,
      archived: false,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    };

    updateItems((current) => [item, ...current]);
    setActivePanel("calendar");
    setCalendarDraftDate(null);
    setCalendarDraftTitle("");
    setSelectedCalendarDate(item.dueDate ?? calendarDraftDate);
  }

  function openMatrixAdd(quadrant: MatrixQuadrant) {
    setMatrixDraftQuadrant(quadrant);
    setMatrixDraftTitle("");
    window.setTimeout(() => document.getElementById("matrix-task-title")?.focus(), 0);
  }

  function closeMatrixAdd() {
    setMatrixDraftQuadrant(null);
    setMatrixDraftTitle("");
  }

  function addMatrixItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matrixDraftQuadrant) return;

    const defaults = matrixDraftDefaults(matrixDraftQuadrant);
    const baseDate = new Date(`${defaults.dueDate ?? getToday()}T09:00:00`);
    const parsedInput = parseTaskInput(matrixDraftTitle, baseDate);
    const taggedTitle = splitInlineTags(parsedInput.title);
    if (!taggedTitle.title) return;

    const createdAt = nowIso();
    const item: MemoItem = {
      id: createId(),
      listId: selectedListId ?? defaultListId,
      title: taggedTitle.title,
      body: "",
      kind: "task",
      status: "open",
      priority: defaults.priority,
      repeatRule: "none",
      dueDate: parsedInput.dueDate ?? defaults.dueDate,
      reminderAt: parsedInput.reminderAt,
      tags: taggedTitle.tags,
      pinned: false,
      archived: false,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    };

    updateItems((current) => [item, ...current]);
    showNotice(`已添加到${matrixQuadrantTitle(matrixDraftQuadrant)}`);
    closeMatrixAdd();
  }

  function moveMatrixItem(id: string, quadrant: MatrixQuadrant) {
    patchItem(id, matrixPatchForQuadrant(quadrant));
    showNotice(`已移动到${matrixQuadrantTitle(quadrant)}`);
  }

  function patchItem(id: string, patch: Partial<MemoItem>) {
    const updatedAt = nowIso();
    updateItems((current) => {
      let nextRecurringItem: MemoItem | null = null;
      const updatedItems = current.map((item) => {
        if (item.id !== id) return item;
        const nextItem = { ...item, ...patch, updatedAt };
        if (item.status === "open" && patch.status === "done") {
          nextRecurringItem = createNextRecurringItem(item, updatedAt);
        }
        return nextItem;
      });

      return nextRecurringItem ? [nextRecurringItem, ...updatedItems] : updatedItems;
    });
  }

  function softDelete(id: string) {
    const item = items.find((value) => value.id === id);
    if (item) setUndoItem(item);
    patchItem(id, { deletedAt: nowIso(), archived: false });
    if (selectedId === id) setSelectedId(null);
  }

  function restoreItem(id: string) {
    patchItem(id, { deletedAt: null, archived: false });
  }

  function permanentlyDelete(id: string) {
    const updatedAt = nowIso();
    patchItem(id, { status: "purged", archived: false, deletedAt: updatedAt, updatedAt });
    if (selectedId === id) setSelectedId(null);
    setUndoItem((current) => (current?.id === id ? null : current));
    setCloudStats((current) =>
      current ? { ...current, items: Math.max(0, current.items - 1), fetchedAt: nowIso() } : current
    );
    showNotice("\u5DF2\u5F7B\u5E95\u5220\u9664");
    enforcePurgedItems([id], updatedAt);
  }

  function restoreDeletedItem() {
    if (!undoItem) return;
    updateItems((current) => current.map((item) => (item.id === undoItem.id ? undoItem : item)));
    setUndoItem(null);
  }

  function selectView(nextView: ViewFilter) {
    setMoreOpen(false);
    setCreatingList(false);
    if (nextView === "today") {
      const today = getToday();
      setSelectedCalendarDate(today);
      setCalendarMonth(today.slice(0, 7));
      setCalendarViewMode("day");
    }
    setActivePanel(panelForView(nextView));
    setView(nextView);
    setSelectedListId(null);
    setSelectedTag(null);
    setQuery("");
    setSelectedId(null);
    setEditingListId(null);
  }

  function selectList(listId: string) {
    setMoreOpen(false);
    setCreatingList(false);
    setActivePanel("tasks");
    setView("inbox");
    setSelectedListId(listId);
    setSelectedTag(null);
    setQuery("");
    setSelectedId(null);
    setEditingListId(null);
    setDraft((current) => ({ ...current, listId }));
  }

  function createList() {
    setMoreOpen(false);
    setActivePanel("tasks");
    setCreatingList(true);
    setEditingListId(null);
    setNewListName("");
    window.setTimeout(() => {
      const input =
        document.getElementById("new-list-name") ?? document.getElementById("mobile-new-list-name");
      input?.focus();
    }, 0);
  }

  function commitCreateList() {
    const name = newListName.trim();
    if (!name) {
      setCreatingList(false);
      return;
    }

    const createdAt = nowIso();
    const list: MemoList = {
      id: createId(),
      name,
      emoji: nextListEmoji(lists.length),
      archived: false,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    };

    updateLists((current) => [...current, list]);
    setCreatingList(false);
    setNewListName("");
    selectList(list.id);
  }

  function openSearch() {
    setMoreOpen(false);
    setCreatingList(false);
    setActivePanel("search");
    setSelectedTag(null);
    setSelectedId(null);
    window.setTimeout(() => document.getElementById("task-search")?.focus(), 0);
  }

  function openSyncPanel() {
    setMoreOpen(false);
    setCreatingList(false);
    setSettingsOpen(false);
    setActivePanel("sync");
    setSelectedTag(null);
    setSelectedId(null);
  }

  function openMatrixPanel() {
    setMoreOpen(false);
    setCreatingList(false);
    setActivePanel("matrix");
    setSelectedTag(null);
    setSelectedId(null);
  }

  function openFocusPanel() {
    setMoreOpen(false);
    setCreatingList(false);
    setActivePanel("focus");
    setSelectedTag(null);
    setSelectedId(null);
  }

  function openListManager() {
    setMoreOpen(false);
    setMobileMenuOpen(false);
    setSettingsOpen(false);
    setTagManagerOpen(false);
    setListManagerOpen(true);
  }

  function openSettings() {
    setMoreOpen(false);
    setMobileMenuOpen(false);
    setListManagerOpen(false);
    setTagManagerOpen(false);
    setSettingsOpen(true);
  }

  function openTagManager() {
    setMoreOpen(false);
    setMobileMenuOpen(false);
    setTagManagerOpen(true);
    setEditingTag(null);
    setTagNameDraft("");
  }

  function beginRenameTag(tag: string) {
    setEditingTag(tag);
    setTagNameDraft(tag);
    window.setTimeout(() => document.getElementById(`tag-input-${cssSafeId(tag)}`)?.focus(), 0);
  }

  function commitRenameTag(tag: string) {
    const nextTag = parseTags(tagNameDraft)[0] ?? "";
    setEditingTag(null);
    setTagNameDraft("");

    if (!nextTag || nextTag === tag) return;

    const updatedAt = nowIso();
    updateItems((current) =>
      current.map((item) => {
        if (!item.tags.includes(tag)) return item;
        const tags = Array.from(new Set(item.tags.map((value) => (value === tag ? nextTag : value))));
        return { ...item, tags, updatedAt };
      })
    );

    if (selectedTag === tag) setSelectedTag(nextTag);
    showNotice(`已更新标签 #${nextTag}`);
  }

  function deleteTag(tag: string) {
    const updatedAt = nowIso();
    updateItems((current) =>
      current.map((item) =>
        item.tags.includes(tag) ? { ...item, tags: item.tags.filter((value) => value !== tag), updatedAt } : item
      )
    );
    if (selectedTag === tag) setSelectedTag(null);
    if (editingTag === tag) setEditingTag(null);
    showNotice(`已移除标签 #${tag}`);
  }

  function openClearExamples() {
    setMoreOpen(false);
    setMobileMenuOpen(false);
    if (demoItemCount === 0) {
      showNotice("没有可清理的示例内容");
      return;
    }
    setClearExamplesOpen(true);
  }

  function openClearTrash() {
    setMoreOpen(false);
    setMobileMenuOpen(false);
    if (counts.archived === 0) {
      showNotice("垃圾桶已经是空的");
      return;
    }
    setClearTrashOpen(true);
  }

  function clearExampleContent() {
    const updatedAt = nowIso();
    const removedIds = new Set(items.filter(isDemoItem).map((item) => item.id));

    updateItems((current) =>
      current.map((item) =>
        removedIds.has(item.id)
          ? { ...item, status: "purged", archived: false, deletedAt: updatedAt, updatedAt }
          : item
      )
    );

    if (selectedId && removedIds.has(selectedId)) setSelectedId(null);
    setUndoItem((current) => (current && removedIds.has(current.id) ? null : current));
    setCloudStats((current) =>
      current ? { ...current, items: Math.max(0, current.items - removedIds.size), fetchedAt: nowIso() } : current
    );
    setClearExamplesOpen(false);
    showNotice(`已彻底清除 ${removedIds.size} 条示例内容`);
    enforcePurgedItems(Array.from(removedIds), updatedAt, { purgeDemoTitles: true });
  }

  function enforcePurgedItems(itemIds: string[], updatedAt: string, options?: { purgeDemoTitles?: boolean }) {
    const syncSnapshot: SyncSnapshot = {
      items: latestItemsRef.current.map((item) =>
        itemIds.includes(item.id) ? { ...item, status: "purged", archived: false, deletedAt: updatedAt, updatedAt } : item
      ),
      lists: latestListsRef.current,
      mutationVersion: localMutationVersionRef.current,
      signature: "",
    };
    syncSnapshot.signature = syncSignature(syncSnapshot.items, syncSnapshot.lists);

    const persist = async () => {
      const currentSession = sessionRef.current;
      if (!currentSession?.user || !isSupabaseConfigured) return;

      try {
        await purgeItemsInCloud(itemIds, currentSession.user.id, updatedAt);
        if (options?.purgeDemoTitles) {
          await purgeDemoItemsInCloud(currentSession.user.id, updatedAt);
        }
      } catch (error) {
        setSyncError(errorMessage(error, "彻底删除同步失败"));
      }
    };

    void persist();
    queuedSyncSnapshotRef.current = syncSnapshot;
    queuedSyncRef.current = true;
    window.setTimeout(() => {
      void persist();
      queuedSyncSnapshotRef.current = syncSnapshot;
      queuedSyncRef.current = true;
      if (!syncingRef.current) {
        void runSync(syncSnapshot);
      }
    }, 3500);
  }

  async function clearTrash() {
    const trashIds = latestItemsRef.current
      .filter((item) => (item.archived || item.deletedAt) && item.status !== "purged")
      .map((item) => item.id);
    if (trashIds.length === 0) {
      setClearTrashOpen(false);
      showNotice("\u5783\u573E\u6876\u5DF2\u7ECF\u662F\u7A7A\u7684");
      return;
    }

    const updatedAt = nowIso();
    updateItems((current) =>
      current.map((item) =>
        trashIds.includes(item.id)
          ? { ...item, status: "purged", archived: false, deletedAt: updatedAt, updatedAt }
          : item
      )
    );
    setSelectedId((current) => (current && trashIds.includes(current) ? null : current));
    setUndoItem((current) => (current && trashIds.includes(current.id) ? null : current));
    setCloudStats((current) =>
      current ? { ...current, items: Math.max(0, current.items - trashIds.length), fetchedAt: nowIso() } : current
    );
    setClearTrashOpen(false);
    showNotice("\u5DF2\u6E05\u7A7A\u5783\u573E\u6876\uFF0C\u5171\u5220\u9664 " + trashIds.length + " \u9879");
    enforcePurgedItems(trashIds, updatedAt);
  }

  async function refreshApp() {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    window.location.reload();
  }

  function setFocusDuration(minutes: number) {
    const nextMinutes = clampTimerMinutes(minutes);
    setFocusMinutes(nextMinutes);
    setFocusRunning(false);
    setFocusSeconds(nextMinutes * 60);
  }

  function setBreakDuration(minutes: number) {
    setBreakMinutes(clampTimerMinutes(minutes));
  }

  function resetFocus(minutes = focusMinutes) {
    setFocusDuration(minutes);
  }

  function startBreak() {
    setFocusRunning(false);
    setFocusSeconds(breakMinutes * 60);
  }

  function completeFocusTask(id: string) {
    patchItem(id, { status: "done" });
    setFocusRunning(false);
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => {
      setNotice((current) => (current === message ? null : current));
    }, 2800);
  }

  async function requestReminderPermission() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      showNotice("当前浏览器不支持系统通知");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    showNotice(permission === "granted" ? "提醒通知已开启" : "提醒通知未开启");
  }

  function selectTag(tag: string) {
    setMoreOpen(false);
    setCreatingList(false);
    setActivePanel("tasks");
    setView("inbox");
    setSelectedListId(null);
    setSelectedTag(tag);
    setQuery("");
    setSelectedId(null);
    setEditingListId(null);
  }

  function beginRenameList(list: MemoList) {
    setCreatingList(false);
    setEditingListId(list.id);
    setListNameDraft(list.name);
  }

  function commitRenameList(listId: string) {
    const name = listNameDraft.trim();
    setEditingListId(null);
    if (!name) return;

    updateLists((current) =>
      current.map((list) => (list.id === listId ? { ...list, name, updatedAt: nowIso() } : list))
    );
  }

  function archiveList(listId: string) {
    const list = lists.find((item) => item.id === listId);
    if (!list) return;
    if (activeLists.length <= 1) {
      showNotice("至少保留一个清单。");
      return;
    }

    setDeleteListId(listId);
  }

  function confirmArchiveList() {
    const listId = deleteListId;
    if (!listId) return;

    const updatedAt = nowIso();
    updateLists((current) =>
      current.map((item) => (item.id === listId ? { ...item, archived: true, updatedAt } : item))
    );
    updateItems((current) =>
      current.map((item) => (item.listId === listId ? { ...item, listId: null, updatedAt } : item))
    );
    setDeleteListId(null);
    selectView("inbox");
  }

  function updateList(listId: string, patch: Partial<Pick<MemoList, "name" | "emoji">>) {
    const updatedAt = nowIso();
    updateLists((current) =>
      current.map((list) => {
        if (list.id !== listId) return list;
        const nextName = patch.name !== undefined ? patch.name.trimStart() : list.name;
        const nextEmoji = patch.emoji !== undefined ? patch.emoji.trim().slice(0, 2) : list.emoji;
        return {
          ...list,
          name: nextName,
          emoji: nextEmoji || list.emoji,
          updatedAt,
        };
      })
    );
  }

  function createManagedList() {
    const createdAt = nowIso();
    const list: MemoList = {
      id: createId(),
      name: "\u65B0\u6E05\u5355",
      emoji: nextListEmoji(lists.length),
      archived: false,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    };

    updateLists((current) => [...current, list]);
    setSelectedListId(list.id);
    setView("inbox");
    setActivePanel("tasks");
    showNotice("\u5DF2\u65B0\u589E\u6E05\u5355\uFF0C\u53EF\u76F4\u63A5\u4FEE\u6539\u540D\u79F0");
  }

  function moveList(listId: string, direction: -1 | 1) {
    updateLists((current) => {
      const index = current.findIndex((list) => list.id === listId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      const updatedAt = nowIso();
      return next.map((list, nextIndex) =>
        nextIndex === index || nextIndex === target ? { ...list, updatedAt } : list
      );
    });
  }

  function restoreList(listId: string) {
    updateLists((current) =>
      current.map((list) => (list.id === listId ? { ...list, archived: false, deletedAt: null, updatedAt: nowIso() } : list))
    );
    showNotice("\u6E05\u5355\u5DF2\u6062\u590D");
  }

  function confirmHardDeleteList() {
    const listId = hardDeleteListId;
    if (!listId) return;
    const updatedAt = nowIso();

    updateLists((current) =>
      current.map((list) => (list.id === listId ? { ...list, archived: false, deletedAt: updatedAt, updatedAt } : list))
    );
    updateItems((current) =>
      current.map((item) => (item.listId === listId ? { ...item, listId: null, updatedAt } : item))
    );
    selectView("inbox");
    if (defaultListId === listId) setDefaultListId(null);
    setCloudStats((current) =>
      current ? { ...current, lists: Math.max(0, current.lists - 1), fetchedAt: nowIso() } : current
    );
    setHardDeleteListId(null);
    showNotice("\u6E05\u5355\u5DF2\u5F7B\u5E95\u5220\u9664\uFF0C\u4EFB\u52A1\u5DF2\u79FB\u5230\u6536\u96C6\u7BB1");
  }

  async function submitPasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || password.length < 6) return;

    setAuthMessage("正在登录...");
    setSyncError(null);

    try {
      const nextSession = await signInWithPassword(cleanEmail, password);
      setSession(nextSession ?? (await getSession()));
      setAuthMessage("登录成功，正在同步。");
    } catch (error) {
      setAuthMessage("");
      setSyncError(errorMessage(error, "登录失败"));
    }
  }

  async function submitPasswordSignup(event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || password.length < 6) return;

    setAuthMessage("正在注册...");
    setSyncError(null);

    try {
      const nextSession = await signUpWithPassword(cleanEmail, password);
      let currentSession = nextSession ?? (await getSession());
      if (!currentSession) {
        try {
          currentSession = await signInWithPassword(cleanEmail, password);
        } catch {
          currentSession = null;
        }
      }
      setSession(currentSession);
      setAuthMessage(
        currentSession
          ? "注册成功，正在同步。"
          : "注册成功，但 Supabase 要求邮箱确认，所以还没有登录。按下面步骤关闭 Confirm email 后再点登录。"
      );
    } catch (error) {
      setAuthMessage("");
      setSyncError(errorMessage(error, "注册失败"));
    }
  }

  async function refreshCloudStats() {
    const currentSession = sessionRef.current;
    if (!currentSession?.user || !isSupabaseConfigured) return;

    setCloudStatsLoading(true);
    setSyncError(null);

    try {
      const stats = await fetchCloudStats(currentSession.user);
      setCloudStats(stats);
    } catch (error) {
      setSyncError(errorMessage(error, "读取云端统计失败"));
    } finally {
      setCloudStatsLoading(false);
    }
  }

  async function runSync(snapshot?: {
    items: MemoItem[];
    lists: MemoList[];
    mutationVersion: number;
    signature: string;
  }) {
    const currentSession = sessionRef.current;
    if (!currentSession?.user || !isSupabaseConfigured) return;
    if (syncingRef.current) {
      queuedSyncRef.current = true;
      return;
    }

    syncingRef.current = true;
    const itemsToSync = snapshot?.items ?? latestItemsRef.current;
    const listsToSync = snapshot?.lists ?? latestListsRef.current;
    const startedWithSignature = snapshot?.signature ?? syncSignature(itemsToSync, listsToSync);
    const startedWithMutationVersion = snapshot?.mutationVersion ?? localMutationVersionRef.current;
    const isStaleSync = () =>
      localMutationVersionRef.current !== startedWithMutationVersion ||
      syncSignature(latestItemsRef.current, latestListsRef.current) !== startedWithSignature;
    inFlightSyncSignatureRef.current = startedWithSignature;
    setSyncing(true);
    setSyncError(null);

    try {
      const merged = await syncWithCloud(itemsToSync, listsToSync, currentSession.user, {
        shouldAbort: isStaleSync,
      });
      if (merged.aborted || isStaleSync()) {
        queuedSyncRef.current = true;
        queuedSyncSnapshotRef.current = {
          items: latestItemsRef.current,
          lists: latestListsRef.current,
          mutationVersion: localMutationVersionRef.current,
          signature: syncSignature(latestItemsRef.current, latestListsRef.current),
        };
        setPendingSync(true);
        return;
      }

      const syncedAt = nowIso();
      latestItemsRef.current = merged.items;
      latestListsRef.current = merged.lists;
      lastSyncedSignatureRef.current = syncSignature(merged.items, merged.lists);
      setItems(merged.items);
      setLists(merged.lists);
      setPendingSync(false);
      setLastSyncedAt(syncedAt);
      setCloudStats({
        items: merged.items.filter((item) => item.status !== "purged").length,
        lists: merged.lists.filter((list) => !list.deletedAt).length,
        fetchedAt: syncedAt,
      });
      saveLastSync(syncedAt);
    } catch (error) {
      setSyncError(errorMessage(error, "同步失败"));
    } finally {
      syncingRef.current = false;
      inFlightSyncSignatureRef.current = "";
      setSyncing(false);
      if (queuedSyncRef.current) {
        const queuedSnapshot = queuedSyncSnapshotRef.current;
        queuedSyncRef.current = false;
        queuedSyncSnapshotRef.current = null;
        window.setTimeout(() => {
          void runSync(queuedSnapshot ?? undefined);
        }, 0);
      }
    }
  }

  const isWidePanel = activePanel === "calendar" || activePanel === "matrix" || activePanel === "focus";
  const panelItemCount =
    activePanel === "matrix"
      ? Object.values(matrixGroups).reduce((total, group) => total + group.length, 0)
      : activePanel === "focus"
        ? focusItems.length
        : visibleItems.length;
  const showTaskSort = activePanel !== "calendar" && activePanel !== "matrix" && activePanel !== "focus";

  return (
    <main className={isWidePanel ? "app-frame wide-mode" : "app-frame"}>
      <aside className="icon-rail" aria-label="主导航">
        <button className="avatar-button" type="button" title="账号" aria-label="账号">
          <span>自</span>
        </button>
        <RailButton icon="check" label="任务" active={activePanel === "tasks"} onClick={() => selectView("inbox")} />
        <RailButton icon="calendar" label="日历" active={activePanel === "calendar"} onClick={() => selectView("today")} />
        <RailButton icon="matrix" label="四象限" active={activePanel === "matrix"} onClick={openMatrixPanel} />
        <RailButton icon="timer" label="番茄专注" active={activePanel === "focus"} onClick={openFocusPanel} />
        <RailButton icon="search" label="搜索" active={activePanel === "search"} onClick={openSearch} />
        <div className="rail-spacer" />
        <RailButton icon="sync" label="同步" active={activePanel === "sync"} onClick={openSyncPanel} />
        <RailButton icon="bell" label="提醒" active={activePanel === "reminders"} onClick={() => selectView("upcoming")} />
        <RailButton
          icon="help"
          label="帮助"
          active={activePanel === "help"}
          onClick={() => {
            setActivePanel("help");
            setSelectedId(null);
          }}
        />
      </aside>

      <aside className="list-sidebar">
        <nav className="quick-nav" aria-label="快捷视图">
          {primaryViews.map((item) => (
            <button
              key={item.id}
              className={view === item.id && !selectedListId && !query ? "nav-line active" : "nav-line"}
              type="button"
              onClick={() => selectView(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              <strong>{countForView(item.id, counts)}</strong>
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <div className="section-title">
            <span>清单</span>
            <span className="section-actions">
              <button className="section-text-button" type="button" onClick={openListManager}>
                管理
              </button>
              <button type="button" aria-label="新增清单" onClick={createList}>
                +
              </button>
            </span>
          </div>
          {creatingList && (
            <form
              className="new-list-row"
              onSubmit={(event) => {
                event.preventDefault();
                commitCreateList();
              }}
            >
              <span>{nextListEmoji(lists.length)}</span>
              <input
                id="new-list-name"
                value={newListName}
                onChange={(event) => setNewListName(event.target.value)}
                onBlur={() => {
                  if (!newListName.trim()) setCreatingList(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setCreatingList(false);
                    setNewListName("");
                  }
                }}
                placeholder="新清单名称"
              />
              <button type="submit" aria-label="创建清单">
                <Icon name="check" />
              </button>
            </form>
          )}
          {activeLists.map((item) => (
            <div className={selectedListId === item.id ? "list-line active" : "list-line"} key={item.id}>
              <button className="list-select" type="button" onClick={() => selectList(item.id)}>
                <span>{item.emoji}</span>
                {editingListId === item.id ? (
                  <input
                    value={listNameDraft}
                    onChange={(event) => setListNameDraft(event.target.value)}
                    onBlur={() => commitRenameList(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRenameList(item.id);
                      if (event.key === "Escape") setEditingListId(null);
                    }}
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                  />
                ) : (
                  <span>{item.name}</span>
                )}
                <strong>{countByList(items, item.id)}</strong>
              </button>
              <button
                className="list-tool"
                type="button"
                aria-label={`重命名${item.name}`}
                title="重命名"
                onClick={() => beginRenameList(item)}
              >
                <Icon name="edit" />
              </button>
              <button
                className="list-tool"
                type="button"
                aria-label={`归档${item.name}`}
                title="归档"
                onClick={() => archiveList(item.id)}
              >
                <Icon name="x" />
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-section">
          <div className="section-title">
            <span>标签筛选</span>
            <button className="section-text-button" type="button" onClick={openTagManager}>
              管理
            </button>
          </div>
          {tagStats.length === 0 ? (
            <div className="tag-empty-state">
              <span>#</span>
              <strong>暂无标签</strong>
              <em>输入 #标签 后显示</em>
            </div>
          ) : (
            tagStats.slice(0, 8).map((tag) => (
              <button
                className={selectedTag === tag.name ? "tag-line active" : "tag-line"}
                type="button"
                key={tag.name}
                onClick={() => selectTag(tag.name)}
              >
                <span>#{tag.name}</span>
                <strong>{tag.count}</strong>
              </button>
            ))
          )}
        </div>

        <div className="sidebar-section">
          <div className="section-title">
            <span>过滤器</span>
          </div>
          <button className={view === "pinned" ? "filter-line active" : "filter-line"} type="button" onClick={() => selectView("pinned")}>
            <Icon name="pin" />
            <span>置顶</span>
            <strong>{counts.pinned}</strong>
          </button>
          <button className={view === "notes" ? "filter-line active" : "filter-line"} type="button" onClick={() => selectView("notes")}>
            <Icon name="note" />
            <span>便签</span>
            <strong>{counts.notes}</strong>
          </button>
        </div>

        <div className="sidebar-bottom">
          <button className={view === "done" ? "nav-line active" : "nav-line"} type="button" onClick={() => selectView("done")}>
            <Icon name="circleCheck" />
            <span>已完成</span>
            <strong>{counts.done}</strong>
          </button>
          <button
            className={view === "archive" ? "nav-line active" : "nav-line"}
            type="button"
            onClick={() => selectView("archive")}
          >
            <Icon name="trash" />
            <span>垃圾桶</span>
            <strong>{counts.archived}</strong>
          </button>
        </div>

        <SyncBox
          session={session}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          authMessage={authMessage}
          syncError={syncError}
          lastSyncedAt={lastSyncedAt}
          syncing={syncing}
          pendingSync={pendingSync}
          localStats={localSyncStats}
          cloudStats={cloudStats}
          cloudStatsLoading={cloudStatsLoading}
          submitLogin={submitPasswordLogin}
          submitSignup={submitPasswordSignup}
          runSync={runSync}
          refreshCloudStats={refreshCloudStats}
          refreshApp={refreshApp}
        />
      </aside>

      <section className="task-pane">
        <header className="task-header">
          <div className="title-group">
            <button
              className="header-icon"
              type="button"
              aria-label="打开菜单"
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <h1>
              {activePanel === "calendar"
                ? formatCalendarTitle(calendarViewMode, calendarMonth, selectedCalendarDate)
                : activePanel === "matrix"
                  ? "四象限"
                  : activePanel === "focus"
                    ? "番茄专注"
                : selectedList
                  ? `${selectedList.emoji} ${selectedList.name}`
                  : selectedTag
                    ? `#${selectedTag}`
                  : query
                    ? `🔎 ${query}`
                    : viewTitle(view)}
            </h1>
          </div>
          <div className="header-actions">
            <span>{panelItemCount}</span>
            <button
              className={activePanel === "sync" ? "header-action mobile-sync-shortcut active" : "header-action mobile-sync-shortcut"}
              type="button"
              onClick={openSyncPanel}
            >
              <Icon name="sync" />
              <span>同步</span>
            </button>
            {showTaskSort && (
              <button
                className={sortMode !== "smart" ? "header-action active" : "header-action"}
                type="button"
                aria-label={`排序：${sortModeLabel(sortMode)}`}
                title={`排序：${sortModeLabel(sortMode)}`}
                onClick={() => setSortMode(nextSortMode(sortMode))}
              >
                <Icon name="sort" />
                <span>{sortModeLabel(sortMode)}</span>
              </button>
            )}
            {view === "archive" && counts.archived > 0 && (
              <button className="header-action" type="button" onClick={openClearTrash}>
                <Icon name="trash" />
                <span>清空</span>
              </button>
            )}
            <div className="more-anchor">
              <button
                className={moreOpen ? "header-action active" : "header-action"}
                type="button"
                aria-label="更多操作"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <Icon name="more" />
              </button>
              {moreOpen && (
                <div className="header-menu" role="menu">
                  <button type="button" role="menuitem" onClick={createList}>
                    新增清单
                  </button>
                  <button type="button" role="menuitem" onClick={openListManager}>
                    管理清单
                  </button>
                  <button type="button" role="menuitem" onClick={openSearch}>
                    搜索
                  </button>
                  <button type="button" role="menuitem" onClick={openMatrixPanel}>
                    四象限
                  </button>
                  <button type="button" role="menuitem" onClick={openFocusPanel}>
                    番茄专注
                  </button>
                  <button type="button" role="menuitem" onClick={openTagManager}>
                    管理标签
                  </button>
                  {view === "archive" && counts.archived > 0 && (
                    <button type="button" role="menuitem" onClick={openClearTrash}>
                      清空垃圾桶
                    </button>
                  )}
                  <button type="button" role="menuitem" onClick={openClearExamples}>
                    清除示例内容
                  </button>
                  <button type="button" role="menuitem" onClick={openSettings}>
                    设置
                  </button>
                  <button type="button" role="menuitem" onClick={openSyncPanel}>
                    同步
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {activePanel === "sync" || activePanel === "help" || activePanel === "reminders" ? (
          <div className="task-pane-utility">
            <UtilityPanel
              panel={activePanel}
              items={items}
              counts={counts}
              query={query}
              setQuery={setQuery}
              session={session}
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              authMessage={authMessage}
              syncError={syncError}
              lastSyncedAt={lastSyncedAt}
              syncing={syncing}
              pendingSync={pendingSync}
              localStats={localSyncStats}
              cloudStats={cloudStats}
              cloudStatsLoading={cloudStatsLoading}
              submitLogin={submitPasswordLogin}
              submitSignup={submitPasswordSignup}
              runSync={runSync}
              refreshCloudStats={refreshCloudStats}
              refreshApp={refreshApp}
              notificationPermission={notificationPermission}
              requestReminderPermission={requestReminderPermission}
            />
          </div>
        ) : activePanel === "calendar" ? (
          <MonthCalendar
            items={items}
            month={calendarMonth}
            viewMode={calendarViewMode}
            setViewMode={setCalendarViewMode}
            setMonth={setCalendarMonth}
            selectedDate={selectedCalendarDate}
            onSelectDate={(dateKey) => {
              setSelectedCalendarDate(dateKey);
              setCalendarMonth(dateKey.slice(0, 7));
            }}
            onCreateItem={openCalendarAdd}
            onSelectItem={(id) => {
              setActivePanel("tasks");
              setSelectedId(id);
            }}
          />
        ) : activePanel === "matrix" ? (
          <MatrixView
            groups={matrixGroups}
            onCreateItem={openMatrixAdd}
            onMoveItem={moveMatrixItem}
            patchItem={patchItem}
            setSelectedId={(id) => {
              setActivePanel("tasks");
              setSelectedId(id);
            }}
          />
        ) : activePanel === "focus" ? (
          <FocusPanel
            items={focusItems}
            selectedId={focusTaskId}
            setSelectedId={setFocusTaskId}
            seconds={focusSeconds}
            running={focusRunning}
            focusMinutes={focusMinutes}
            breakMinutes={breakMinutes}
            setRunning={setFocusRunning}
            resetFocus={resetFocus}
            startBreak={startBreak}
            setFocusDuration={setFocusDuration}
            setBreakDuration={setBreakDuration}
            completeTask={completeFocusTask}
            openTask={(id) => {
              setActivePanel("tasks");
              setSelectedId(id);
            }}
          />
        ) : (
          <>
            <form className={addExpanded ? "compact-add expanded" : "compact-add"} onSubmit={addItem}>
              <button
                className="mode-toggle"
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    kind: current.kind === "task" ? "note" : "task",
                    dueDate: current.kind === "task" ? null : current.dueDate,
                  }))
                }
                aria-label="切换待办或备忘"
                title={draft.kind === "task" ? "待办" : "备忘"}
              >
                <Icon name={draft.kind === "task" ? "plus" : "note"} />
              </button>
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder={draft.kind === "task" ? "添加任务，例如：晚上8.聚餐" : "添加备忘"}
              />
              <button
                className={addExpanded ? "add-options-toggle active" : "add-options-toggle"}
                type="button"
                aria-label="展开添加选项"
                aria-expanded={addExpanded}
                onClick={() => setAddExpanded((expanded) => !expanded)}
              >
                <Icon name="more" />
              </button>
              {addExpanded && (
                <div className="add-options">
                  <label>
                    <span>清单</span>
                    <select
                      value={draft.listId ?? selectedListId ?? ""}
                      onChange={(event) => setDraft((current) => ({ ...current, listId: event.target.value || null }))}
                    >
                      <option value="">收集箱</option>
                      {activeLists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.emoji} {list.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>优先级</span>
                    <select
                      value={draft.priority}
                      onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as Priority }))}
                    >
                      <option value="normal">普通</option>
                      <option value="high">重要</option>
                      <option value="low">低</option>
                    </select>
                  </label>
                  <label>
                    <span>日期</span>
                    <input
                      type="date"
                      value={draft.dueDate ?? ""}
                      onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value || null }))}
                      disabled={draft.kind === "note"}
                    />
                  </label>
                  <label>
                    <span>提醒</span>
                    <input
                      type="datetime-local"
                      value={toLocalDateTimeInput(draft.reminderAt)}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, reminderAt: fromLocalDateTimeInput(event.target.value) }))
                      }
                      disabled={draft.kind === "note"}
                    />
                  </label>
                  <label>
                    <span>重复</span>
                    <select
                      value={draft.repeatRule}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, repeatRule: event.target.value as RepeatRule }))
                      }
                      disabled={draft.kind === "note"}
                    >
                      <option value="none">不重复</option>
                      <option value="daily">每天</option>
                      <option value="weekly">每周</option>
                      <option value="monthly">每月</option>
                    </select>
                  </label>
                  <label className="add-tags">
                    <span>标签</span>
                    <input
                      value={draft.tags}
                      onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                      placeholder="用空格分隔"
                    />
                  </label>
                </div>
              )}
            </form>

            <label className="inline-search">
              <Icon name="search" />
              <input
                id="task-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索任务、备忘、标签"
              />
            </label>

            <TaskListView
              groupedItems={groupedItems}
              selectedId={selectedId}
              view={view}
              patchItem={patchItem}
              restoreItem={restoreItem}
              permanentlyDelete={permanentlyDelete}
              setSelectedId={(id) => {
                setActivePanel("tasks");
                setSelectedId(id);
              }}
            />
          </>
        )}
      </section>

      {selectedItem && <button className="detail-backdrop" type="button" aria-label="关闭详情" onClick={() => setSelectedId(null)} />}

      <aside className={selectedItem ? "detail-pane editing" : "detail-pane"}>
        {selectedItem ? (
          <ItemEditor
            item={selectedItem}
            lists={activeLists}
            onChange={(patch) => patchItem(selectedItem.id, patch)}
            onDelete={softDelete}
            onRestore={restoreItem}
            onPermanentlyDelete={permanentlyDelete}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <UtilityPanel
            panel={activePanel}
            items={items}
            counts={counts}
            query={query}
            setQuery={setQuery}
            session={session}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            authMessage={authMessage}
            syncError={syncError}
            lastSyncedAt={lastSyncedAt}
            syncing={syncing}
            pendingSync={pendingSync}
            localStats={localSyncStats}
            cloudStats={cloudStats}
            cloudStatsLoading={cloudStatsLoading}
            submitLogin={submitPasswordLogin}
            submitSignup={submitPasswordSignup}
            runSync={runSync}
            refreshCloudStats={refreshCloudStats}
            refreshApp={refreshApp}
            notificationPermission={notificationPermission}
            requestReminderPermission={requestReminderPermission}
          />
        )}
      </aside>

      {mobileMenuOpen && (
        <div className="mobile-drawer-layer" role="presentation" onClick={() => setMobileMenuOpen(false)}>
          <aside className="mobile-drawer" aria-label="移动菜单" onClick={(event) => event.stopPropagation()}>
            <header>
              <strong>菜单</strong>
              <button type="button" aria-label="关闭菜单" onClick={() => setMobileMenuOpen(false)}>
                <Icon name="x" />
              </button>
            </header>

            <nav className="mobile-drawer-section" aria-label="快捷视图">
              {primaryViews.map((item) => (
                <button
                  key={item.id}
                  className={view === item.id && !selectedListId && !query ? "active" : ""}
                  type="button"
                  onClick={() => {
                    selectView(item.id);
                    setMobileMenuOpen(false);
                  }}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  <strong>{countForView(item.id, counts)}</strong>
                </button>
              ))}
            </nav>

            <section className="mobile-drawer-section">
              <div className="mobile-drawer-title">
                <span>清单</span>
                <button type="button" onClick={openListManager}>
                  管理
                </button>
                <button
                  type="button"
                  onClick={() => {
                    createList();
                  }}
                >
                  +
                </button>
              </div>
              {creatingList && (
                <form
                  className="new-list-row mobile-new-list-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    commitCreateList();
                    setMobileMenuOpen(false);
                  }}
                >
                  <span>{nextListEmoji(lists.length)}</span>
                  <input
                    id="mobile-new-list-name"
                    value={newListName}
                    onChange={(event) => setNewListName(event.target.value)}
                    onBlur={() => {
                      if (!newListName.trim()) setCreatingList(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setCreatingList(false);
                        setNewListName("");
                      }
                    }}
                    placeholder="新清单名称"
                  />
                  <button type="submit" aria-label="创建清单">
                    <Icon name="check" />
                  </button>
                </form>
              )}
              {activeLists.map((list) => (
                <button
                  key={list.id}
                  className={selectedListId === list.id ? "active" : ""}
                  type="button"
                  onClick={() => {
                    selectList(list.id);
                    setMobileMenuOpen(false);
                  }}
                >
                  <span>{list.emoji}</span>
                  <span>{list.name}</span>
                  <strong>{countByList(items, list.id)}</strong>
                </button>
              ))}
            </section>

            {tagStats.length > 0 && (
              <section className="mobile-drawer-section">
                <div className="mobile-drawer-title">
                  <span>标签筛选</span>
                  <button type="button" onClick={openTagManager}>
                    管理
                  </button>
                </div>
                {tagStats.slice(0, 8).map((tag) => (
                  <button
                    key={tag.name}
                    className={selectedTag === tag.name ? "mobile-tag-button active" : "mobile-tag-button"}
                    type="button"
                    onClick={() => {
                      selectTag(tag.name);
                      setMobileMenuOpen(false);
                    }}
                  >
                    <span>#{tag.name}</span>
                    <strong>{tag.count}</strong>
                  </button>
                ))}
              </section>
            )}

            <section className="mobile-drawer-section">
              <div className="mobile-drawer-title">
                <span>过滤器</span>
              </div>
              {(["pinned", "notes", "done", "archive"] as ViewFilter[]).map((filter) => (
                <button
                  key={filter}
                  className={view === filter ? "active" : ""}
                  type="button"
                  onClick={() => {
                    selectView(filter);
                    setMobileMenuOpen(false);
                  }}
                >
                  <Icon name={filter === "pinned" ? "pin" : filter === "notes" ? "note" : filter === "done" ? "circleCheck" : "trash"} />
                  <span>{viewTitle(filter)}</span>
                  <strong>
                    {filter === "archive"
                      ? counts.archived
                      : filter === "done"
                        ? counts.done
                        : countForView(filter, counts)}
                  </strong>
                </button>
              ))}
            </section>

            <section className="mobile-drawer-section">
              <div className="mobile-drawer-title">
                <span>维护</span>
              </div>
              <button type="button" onClick={openListManager}>
                <Icon name="edit" />
                <span>管理清单</span>
                <strong>{lists.length}</strong>
              </button>
              <button type="button" onClick={openTagManager}>
                <Icon name="tag" />
                <span>管理标签</span>
                <strong>{tagStats.length}</strong>
              </button>
              <button type="button" onClick={openSettings}>
                <Icon name="settings" />
                <span>设置</span>
                <strong />
              </button>
              <button type="button" onClick={openClearExamples}>
                <Icon name="trash" />
                <span>清除示例内容</span>
                <strong>{demoItemCount}</strong>
              </button>
            </section>
          </aside>
        </div>
      )}

      <button
        className={activePanel === "sync" ? "mobile-floating-sync active" : "mobile-floating-sync"}
        type="button"
        onClick={openSyncPanel}
      >
        <Icon name="sync" />
        <span>同步</span>
      </button>

      <nav className="mobile-tabbar" aria-label="移动端导航">
        <button className={activePanel === "tasks" ? "active" : ""} type="button" onClick={() => selectView("inbox")}>
          <Icon name="check" />
          <span>任务</span>
        </button>
        <button className={activePanel === "calendar" ? "active" : ""} type="button" onClick={() => selectView("today")}>
          <Icon name="calendar" />
          <span>今天</span>
        </button>
        <button className={activePanel === "search" ? "active" : ""} type="button" onClick={openSearch}>
          <Icon name="search" />
          <span>搜索</span>
        </button>
        <button className={activePanel === "reminders" ? "active" : ""} type="button" onClick={() => selectView("upcoming")}>
          <Icon name="bell" />
          <span>提醒</span>
        </button>
        <button className={activePanel === "sync" ? "active" : ""} type="button" onClick={openSyncPanel}>
          <Icon name="sync" />
          <span>同步</span>
        </button>
      </nav>

      {calendarDraftDate && (
        <div className="app-modal-backdrop" role="presentation" onMouseDown={() => setCalendarDraftDate(null)}>
          <form
            className="app-modal"
            aria-label="添加日历任务"
            onSubmit={addCalendarItem}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <strong>添加任务</strong>
              <button type="button" aria-label="关闭" onClick={() => setCalendarDraftDate(null)}>
                <Icon name="x" />
              </button>
            </header>
            <p>{formatDate(calendarDraftDate)}</p>
            <input
              id="calendar-task-title"
              value={calendarDraftTitle}
              onChange={(event) => setCalendarDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCalendarDraftDate(null);
              }}
              placeholder="例如：晚上8点聚餐"
            />
            <footer>
              <button type="button" onClick={() => setCalendarDraftDate(null)}>
                取消
              </button>
              <button type="submit" disabled={!calendarDraftTitle.trim()}>
                添加
              </button>
            </footer>
          </form>
        </div>
      )}

      {matrixDraftQuadrant && (
        <div className="app-modal-backdrop" role="presentation" onMouseDown={closeMatrixAdd}>
          <form
            className="app-modal matrix-add-modal"
            aria-label="添加四象限任务"
            onSubmit={addMatrixItem}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <strong>添加到{matrixQuadrantTitle(matrixDraftQuadrant)}</strong>
              <button type="button" aria-label="关闭" onClick={closeMatrixAdd}>
                <Icon name="x" />
              </button>
            </header>
            <p>{matrixQuadrantModalHint(matrixDraftQuadrant)}</p>
            <input
              id="matrix-task-title"
              value={matrixDraftTitle}
              onChange={(event) => setMatrixDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeMatrixAdd();
              }}
              placeholder="例如：晚上5.30体育馆打球"
            />
            <footer>
              <button type="button" onClick={closeMatrixAdd}>
                取消
              </button>
              <button type="submit" disabled={!matrixDraftTitle.trim()}>
                添加
              </button>
            </footer>
          </form>
        </div>
      )}

      {listManagerOpen && (
        <div className="app-modal-backdrop" role="presentation" onMouseDown={() => setListManagerOpen(false)}>
          <section className="app-modal list-manager-modal" aria-label="清单管理" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <strong>清单管理</strong>
              <button type="button" aria-label="关闭" onClick={() => setListManagerOpen(false)}>
                <Icon name="x" />
              </button>
            </header>
            <p>可以调整清单顺序、改图标和名称。归档后的清单会隐藏，仍可恢复；彻底删除会从所有设备移除该清单。</p>
            <div className="list-manager-list">
              {lists.filter((list) => !list.deletedAt).map((list, index) => (
                <div className={list.archived ? "list-manager-row archived" : "list-manager-row"} key={list.id}>
                  <input
                    className="list-emoji-input"
                    value={list.emoji}
                    onChange={(event) => updateList(list.id, { emoji: event.target.value })}
                    aria-label={`${list.name} 图标`}
                  />
                  <input
                    value={list.name}
                    onChange={(event) => updateList(list.id, { name: event.target.value })}
                    onBlur={() => {
                      if (!list.name.trim()) updateList(list.id, { name: "未命名清单" });
                    }}
                    aria-label={`${list.name} 名称`}
                  />
                  <strong>{countByList(items, list.id)}</strong>
                  <span>{list.archived ? "已归档" : defaultListId === list.id ? "默认" : "启用"}</span>
                  <div className="list-manager-actions">
                    <button type="button" onClick={() => moveList(list.id, -1)} disabled={index === 0}>
                      上移
                    </button>
                    <button type="button" onClick={() => moveList(list.id, 1)} disabled={index === lists.length - 1}>
                      下移
                    </button>
                    {list.archived ? (
                      <>
                        <button type="button" onClick={() => restoreList(list.id)}>
                          恢复
                        </button>
                        <button type="button" className="danger-text" onClick={() => setHardDeleteListId(list.id)}>
                          彻底删除
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => archiveList(list.id)}>
                        归档
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <footer>
              <button type="button" onClick={createManagedList}>
                新增清单
              </button>
              <button type="button" onClick={() => setListManagerOpen(false)}>
                完成
              </button>
            </footer>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="app-modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="app-modal settings-modal" aria-label="设置" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <strong>设置</strong>
              <button type="button" aria-label="关闭" onClick={() => setSettingsOpen(false)}>
                <Icon name="x" />
              </button>
            </header>
            <div className="settings-grid">
              <label>
                <span>默认清单</span>
                <select value={defaultListId ?? ""} onChange={(event) => setDefaultListId(event.target.value || null)}>
                  <option value="">跟随当前视图</option>
                  {activeLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.emoji} {list.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>专注时长</span>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={focusMinutes}
                  onChange={(event) => setFocusDuration(Number(event.target.value))}
                />
              </label>
              <label>
                <span>休息时长</span>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={breakMinutes}
                  onChange={(event) => setBreakDuration(Number(event.target.value))}
                />
              </label>
              <div className="settings-account">
                <span>同步账号</span>
                <strong>{session?.user.email ?? "未登录"}</strong>
                <button type="button" onClick={openSyncPanel}>
                  打开同步
                </button>
              </div>
            </div>
            <footer>
              <button type="button" onClick={() => void refreshApp()}>
                更新应用
              </button>
              <button type="button" onClick={() => setSettingsOpen(false)}>
                完成
              </button>
            </footer>
          </section>
        </div>
      )}

      {deleteListTarget && (
        <div className="app-modal-backdrop" role="presentation" onMouseDown={() => setDeleteListId(null)}>
          <section className="app-modal danger" aria-label="归档清单" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <strong>归档清单</strong>
              <button type="button" aria-label="关闭" onClick={() => setDeleteListId(null)}>
                <Icon name="x" />
              </button>
            </header>
            <p>
              「{deleteListTarget.name}」会从侧边栏隐藏，里面的 {countByList(items, deleteListTarget.id)} 个未完成任务会移到收集箱。
            </p>
            <footer>
              <button type="button" onClick={() => setDeleteListId(null)}>
                取消
              </button>
              <button type="button" onClick={confirmArchiveList}>
                归档
              </button>
            </footer>
          </section>
        </div>
      )}

      {hardDeleteListTarget && (
        <div className="app-modal-backdrop" role="presentation" onMouseDown={() => setHardDeleteListId(null)}>
          <section className="app-modal danger" aria-label="彻底删除清单" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <strong>彻底删除清单</strong>
              <button type="button" aria-label="关闭" onClick={() => setHardDeleteListId(null)}>
                <Icon name="x" />
              </button>
            </header>
            <p>彻底删除「{hardDeleteListTarget.name}」，其中任务会移到收集箱。这个清单本身无法恢复。</p>
            <footer>
              <button type="button" onClick={() => setHardDeleteListId(null)}>
                取消
              </button>
              <button type="button" onClick={confirmHardDeleteList}>
                彻底删除
              </button>
            </footer>
          </section>
        </div>
      )}

      {tagManagerOpen && (
        <div className="app-modal-backdrop" role="presentation" onMouseDown={() => setTagManagerOpen(false)}>
          <section className="app-modal tag-manager-modal" aria-label="标签管理" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <strong>标签管理</strong>
              <button type="button" aria-label="关闭" onClick={() => setTagManagerOpen(false)}>
                <Icon name="x" />
              </button>
            </header>
            <p>重命名为已有标签会自动合并；删除标签不会删除任务。</p>
            <div className="tag-manager-list">
              {tagStats.length === 0 ? (
                <p className="sidebar-placeholder">暂无标签</p>
              ) : (
                tagStats.map((tag) => (
                  <div className="tag-manager-row" key={tag.name}>
                    {editingTag === tag.name ? (
                      <input
                        id={`tag-input-${cssSafeId(tag.name)}`}
                        value={tagNameDraft}
                        onChange={(event) => setTagNameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRenameTag(tag.name);
                          if (event.key === "Escape") {
                            setEditingTag(null);
                            setTagNameDraft("");
                          }
                        }}
                      />
                    ) : (
                      <button className="tag-name-button" type="button" onClick={() => selectTag(tag.name)}>
                        #{tag.name}
                      </button>
                    )}
                    <strong>{tag.count}</strong>
                    {editingTag === tag.name ? (
                      <button className="tag-action-button primary-tag-action" type="button" onClick={() => commitRenameTag(tag.name)}>
                        保存
                      </button>
                    ) : (
                      <button className="tag-action-button primary-tag-action" type="button" onClick={() => beginRenameTag(tag.name)}>
                        重命名
                      </button>
                    )}
                    <button type="button" className="tag-action-button danger-tag-action danger-text" onClick={() => deleteTag(tag.name)}>
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
            <footer>
              <button type="button" onClick={openClearExamples}>
                清除示例内容
              </button>
              <button type="button" onClick={() => setTagManagerOpen(false)}>
                完成
              </button>
            </footer>
          </section>
        </div>
      )}

      {clearExamplesOpen && (
        <div className="app-modal-backdrop" role="presentation" onMouseDown={() => setClearExamplesOpen(false)}>
          <section className="app-modal danger" aria-label="清除示例内容" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <strong>清除示例内容</strong>
              <button type="button" aria-label="关闭" onClick={() => setClearExamplesOpen(false)}>
                <Icon name="x" />
              </button>
            </header>
            <p>将 {demoItemCount} 条内置演示任务彻底清除，并同步删除云端旧示例；保留你的清单、账号和其他任务。</p>
            <footer>
              <button type="button" onClick={() => setClearExamplesOpen(false)}>
                取消
              </button>
              <button type="button" onClick={clearExampleContent}>
                彻底清除
              </button>
            </footer>
          </section>
        </div>
      )}

      {clearTrashOpen && (
        <div className="app-modal-backdrop" role="presentation" onMouseDown={() => setClearTrashOpen(false)}>
          <section className="app-modal danger" aria-label="清空垃圾桶" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <strong>清空垃圾桶</strong>
              <button type="button" aria-label="关闭" onClick={() => setClearTrashOpen(false)}>
                <Icon name="x" />
              </button>
            </header>
            <p>将彻底删除垃圾桶里的 {counts.archived} 项内容，删除后无法恢复。</p>
            <footer>
              <button type="button" onClick={() => setClearTrashOpen(false)}>
                取消
              </button>
              <button type="button" onClick={() => void clearTrash()}>
                清空
              </button>
            </footer>
          </section>
        </div>
      )}

      {notice && (
        <div className="notice-toast" role="status">
          {notice}
        </div>
      )}

      {undoItem && (
        <div className="undo-toast" role="status">
          <span>已删除「{undoItem.title}」</span>
          <button type="button" onClick={restoreDeletedItem}>
            撤销
          </button>
          <button type="button" aria-label="关闭撤销提示" onClick={() => setUndoItem(null)}>
            <Icon name="x" />
          </button>
        </div>
      )}
    </main>
  );
}

function SyncBox({
  session,
  email,
  setEmail,
  password,
  setPassword,
  authMessage,
  syncError,
  lastSyncedAt,
  syncing,
  pendingSync,
  localStats,
  cloudStats,
  cloudStatsLoading,
  submitLogin,
  submitSignup,
  runSync,
  refreshCloudStats,
  refreshApp,
}: {
  session: Session | null;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  authMessage: string;
  syncError: string | null;
  lastSyncedAt: string | null;
  syncing: boolean;
  pendingSync: boolean;
  localStats: LocalSyncStats;
  cloudStats: CloudStats | null;
  cloudStatsLoading: boolean;
  submitLogin: (event: FormEvent<HTMLFormElement>) => void;
  submitSignup: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>) => void;
  runSync: () => Promise<void>;
  refreshCloudStats: () => Promise<void>;
  refreshApp: () => Promise<void>;
}) {
  const status = getSyncStatus(session, syncing, pendingSync, syncError, lastSyncedAt);
  const showEmailConfirmHelp = isEmailConfirmIssue(authMessage) || isEmailConfirmIssue(syncError);
  const [ilinkConnection, setIlinkConnection] = useState<IlinkConnection | null>(null);
  const [ilinkQr, setIlinkQr] = useState<IlinkQrCode | null>(null);
  const [ilinkQrStatus, setIlinkQrStatus] = useState<IlinkQrStatus["status"] | null>(null);
  const [ilinkLoading, setIlinkLoading] = useState(false);
  const [ilinkError, setIlinkError] = useState<string | null>(null);
  const ilinkPollRef = useRef<number | null>(null);

  useEffect(() => {
    clearIlinkPolling();
    setIlinkQr(null);
    setIlinkQrStatus(null);
    setIlinkError(null);
    if (session?.access_token) void refreshIlinkConnection();
    else setIlinkConnection(null);
    return clearIlinkPolling;
  }, [session?.access_token]);

  function clearIlinkPolling(): void {
    if (!ilinkPollRef.current) return;
    window.clearInterval(ilinkPollRef.current);
    ilinkPollRef.current = null;
  }

  async function refreshIlinkConnection(): Promise<void> {
    if (!session?.access_token) return;
    try {
      setIlinkConnection(await fetchIlinkConnection(session.access_token));
    } catch (error) {
      setIlinkError(error instanceof Error ? error.message : "读取微信连接失败");
    }
  }

  async function startIlinkScan(): Promise<void> {
    if (!session?.access_token) return;
    clearIlinkPolling();
    setIlinkLoading(true);
    setIlinkError(null);
    setIlinkQrStatus(null);
    try {
      const qr = await createIlinkQrCode(session.access_token);
      setIlinkQr(qr);
      setIlinkQrStatus("pending");
      const token = session.access_token;
      const poll = async () => {
        try {
          const status = await checkIlinkQrCode(token, qr.qrcodeId);
          setIlinkQrStatus(status.status);
          if (status.status === "confirmed") {
            clearIlinkPolling();
            setIlinkQr(null);
            setIlinkConnection(status.connection ?? (await fetchIlinkConnection(token)));
          }
          if (status.status === "expired") clearIlinkPolling();
        } catch (error) {
          clearIlinkPolling();
          setIlinkError(error instanceof Error ? error.message : "读取微信扫码状态失败");
        }
      };
      ilinkPollRef.current = window.setInterval(() => void poll(), 2000);
      void poll();
    } catch (error) {
      setIlinkError(error instanceof Error ? error.message : "生成微信二维码失败");
    } finally {
      setIlinkLoading(false);
    }
  }

  async function disconnectIlink(): Promise<void> {
    if (!session?.access_token) return;
    clearIlinkPolling();
    setIlinkLoading(true);
    setIlinkError(null);
    try {
      setIlinkConnection(await disconnectIlinkConnection(session.access_token));
      setIlinkQr(null);
      setIlinkQrStatus(null);
    } catch (error) {
      setIlinkError(error instanceof Error ? error.message : "断开微信连接失败");
    } finally {
      setIlinkLoading(false);
    }
  }

  const ilinkStatusText = getIlinkStatusText(ilinkConnection, ilinkQrStatus);

  return (
    <section className="sync-box" aria-label="同步">
      <div className="sync-line">
        <span>{isSupabaseConfigured ? "账号同步" : "本地模式"}</span>
        <span className={`sync-dot ${status.tone}`} />
      </div>
      <p className="sync-status" aria-live="polite">
        {status.text}
      </p>

      {isSupabaseConfigured && !session && (
        <form className="mini-auth password-auth" onSubmit={submitLogin}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="邮箱"
            aria-label="邮箱"
            autoComplete="email"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="密码，至少 6 位"
            aria-label="密码"
            autoComplete="current-password"
          />
          <button type="submit" disabled={!email.trim() || password.length < 6}>
            登录
          </button>
          <button type="button" disabled={!email.trim() || password.length < 6} onClick={(event) => submitSignup(event)}>
            注册
          </button>
        </form>
      )}

      {isSupabaseConfigured && session && (
        <div className="signed-row">
          <span>{session.user.email}</span>
          <button type="button" onClick={() => void runSync()} disabled={syncing}>
            {syncing ? "同步中" : "同步"}
          </button>
          <button type="button" onClick={() => void signOut()}>
            退出
          </button>
        </div>
      )}

      {isSupabaseConfigured && session && (
        <div className="sync-diagnostics">
          <div>
            <span>本地任务</span>
            <strong>{localStats.items}</strong>
          </div>
          <div>
            <span>云端任务</span>
            <strong>{cloudStatsLoading ? "..." : cloudStats ? cloudStats.items : "-"}</strong>
          </div>
          <div>
            <span>本地清单</span>
            <strong>{localStats.lists}</strong>
          </div>
          <div>
            <span>云端清单</span>
            <strong>{cloudStatsLoading ? "..." : cloudStats ? cloudStats.lists : "-"}</strong>
          </div>
          <div className="sync-diagnostics-wide">
            <span>打开任务 / 已删除</span>
            <strong>
              {localStats.openItems} / {localStats.deletedItems}
            </strong>
          </div>
          <button type="button" onClick={() => void refreshCloudStats()} disabled={cloudStatsLoading}>
            {cloudStatsLoading ? "读取中" : "刷新云端统计"}
          </button>
          <button type="button" onClick={() => void refreshApp()}>
            更新应用
          </button>
          {cloudStats?.fetchedAt && <p>统计读取于 {formatDateTime(cloudStats.fetchedAt)}</p>}
        </div>
      )}

      {isSupabaseConfigured && session && (
        <div className="wechat-binding">
          <div className="wechat-binding-main">
            <div className="wechat-binding-summary">
              <span>微信扫码</span>
              <strong>{ilinkStatusText}</strong>
            </div>
            <button type="button" onClick={() => void startIlinkScan()} disabled={ilinkLoading}>
              {ilinkLoading ? "处理中" : "扫码连接"}
            </button>
            {ilinkConnection?.connected && (
              <button type="button" onClick={() => void disconnectIlink()} disabled={ilinkLoading}>
                断开
              </button>
            )}
          </div>
          {ilinkQr && (
            <div className="wechat-qr-panel">
              <img src={ilinkQr.qrcodeImage} alt="微信扫码连接" />
              <p>{ilinkQrStatus === "expired" ? "二维码已过期" : "请用微信扫描二维码"}</p>
            </div>
          )}
          {ilinkConnection?.lastPolledAt && <p>最近扫描 {formatDateTime(ilinkConnection.lastPolledAt)}</p>}
          {ilinkConnection?.lastError && <p className="error-text">{ilinkConnection.lastError}</p>}
          {ilinkError && <p className="error-text">{ilinkError}</p>}
        </div>
      )}

      {authMessage && <p>{authMessage}</p>}
      {syncError && <p className="error-text">{syncError}</p>}
      {showEmailConfirmHelp && (
        <div className="auth-help">
          <strong>需要改 Supabase 设置</strong>
          <p>打开 Supabase 控制台：Authentication → Providers → Email。</p>
          <p>关闭 Confirm email，点 Save。回到这里点“登录”；如果仍失败，再用同一邮箱点“注册”。</p>
        </div>
      )}
      {!session && (
        <button className="refresh-app-link" type="button" onClick={() => void refreshApp()}>
          看不到登录框？更新应用
        </button>
      )}
      {lastSyncedAt && status.tone !== "online" && <p>上次 {formatDateTime(lastSyncedAt)}</p>}
    </section>
  );
}

function getIlinkStatusText(
  connection: IlinkConnection | null,
  qrStatus: IlinkQrStatus["status"] | null
): string {
  if (connection?.status === "connected") return connection.hasReplyContext ? "已连接，可提醒" : "已连接，待激活";
  if (connection?.status === "error") return "连接异常";
  if (connection?.status === "disabled") return "已断开";
  if (qrStatus === "pending") return "等待扫码";
  if (qrStatus === "scanned") return "已扫码，等待确认";
  if (qrStatus === "expired") return "二维码过期";
  if (qrStatus === "confirmed") return "已连接";
  if (!connection || connection.status === "not_connected") return "未连接";
  return "未连接";
}

function TaskListView({
  groupedItems,
  selectedId,
  view,
  patchItem,
  restoreItem,
  permanentlyDelete,
  setSelectedId,
}: {
  groupedItems: Array<{ title: string; items: MemoItem[] }>;
  selectedId: string | null;
  view: ViewFilter;
  patchItem: (id: string, patch: Partial<MemoItem>) => void;
  restoreItem: (id: string) => void;
  permanentlyDelete: (id: string) => void;
  setSelectedId: (id: string) => void;
}) {
  const isTrashView = view === "archive";

  return (
    <div className="task-list" aria-label="任务列表">
      {groupedItems.length === 0 ? (
        <div className="empty-list">没有匹配的任务</div>
      ) : (
        groupedItems.map((group) => (
          <section className="task-group" key={group.title}>
            <div className="group-heading">
              <Icon name="chevron" />
              <strong>{group.title}</strong>
              <span>{group.items.length}</span>
            </div>
            {group.items.map((item) => (
              <article
                className={`task-row ${selectedId === item.id ? "selected" : ""} ${item.status === "done" ? "done" : ""} ${
                  item.deletedAt ? "deleted" : ""
                }`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <button
                  className={item.status === "done" ? "checkbox done" : "checkbox"}
                  type="button"
                  aria-label={item.status === "done" ? "标记未完成" : "标记完成"}
                  onClick={(event) => {
                    event.stopPropagation();
                    patchItem(item.id, { status: item.status === "done" ? "open" : "done" });
                  }}
                  disabled={item.kind === "note" || Boolean(item.deletedAt)}
                >
                  {item.status === "done" && <Icon name="check" />}
                </button>

                <span className={itemMarkerClass(item)} aria-hidden="true">
                  {emojiForItem(item)}
                </span>
                <div className="task-copy">
                  <h2>{item.title}</h2>
                  {(item.body || item.tags.length > 0 || item.dueDate || item.reminderAt) && (
                    <p>
                      {[
                        item.body,
                        item.reminderAt ? formatDateTime(item.reminderAt) : item.dueDate ? formatDate(item.dueDate) : "",
                        ...item.tags.map((tag) => `#${tag}`),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>

                {isTrashView ? (
                  <>
                    <button
                      className="tiny-action active"
                      type="button"
                      aria-label="恢复"
                      title="恢复"
                      onClick={(event) => {
                        event.stopPropagation();
                        restoreItem(item.id);
                      }}
                    >
                      <Icon name="archive" />
                    </button>
                    <button
                      className="tiny-action danger"
                      type="button"
                      aria-label="彻底删除"
                      title="彻底删除"
                      onClick={(event) => {
                        event.stopPropagation();
                        permanentlyDelete(item.id);
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={item.pinned ? "tiny-action active" : "tiny-action"}
                      type="button"
                      aria-label={item.pinned ? "取消置顶" : "置顶"}
                      onClick={(event) => {
                        event.stopPropagation();
                        patchItem(item.id, { pinned: !item.pinned });
                      }}
                    >
                      <Icon name="pin" />
                    </button>
                    <button
                      className="tiny-action"
                      type="button"
                      aria-label={item.archived ? "移出归档" : "归档"}
                      onClick={(event) => {
                        event.stopPropagation();
                        patchItem(item.id, { archived: !item.archived });
                      }}
                    >
                      <Icon name="archive" />
                    </button>
                  </>
                )}
              </article>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function MatrixView({
  groups,
  onCreateItem,
  onMoveItem,
  patchItem,
  setSelectedId,
}: {
  groups: Record<MatrixQuadrant, MemoItem[]>;
  onCreateItem: (quadrant: MatrixQuadrant) => void;
  onMoveItem: (id: string, quadrant: MatrixQuadrant) => void;
  patchItem: (id: string, patch: Partial<MemoItem>) => void;
  setSelectedId: (id: string) => void;
}) {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<MatrixQuadrant | null>(null);

  function handleDrop(event: DragEvent<HTMLElement>, quadrant: MatrixQuadrant) {
    event.preventDefault();
    const itemId = event.dataTransfer.getData("text/plain") || draggedItemId;
    setDraggedItemId(null);
    setDropTarget(null);
    if (!itemId) return;
    onMoveItem(itemId, quadrant);
  }

  return (
    <section className="matrix-view" aria-label="四象限">
      {matrixQuadrants.map((quadrant) => (
        <div
          className={`matrix-column ${quadrant.id}${dropTarget === quadrant.id ? " drag-over" : ""}`}
          key={quadrant.id}
          onDragOver={(event) => {
            if (!draggedItemId) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTarget(quadrant.id);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
          }}
          onDrop={(event) => handleDrop(event, quadrant.id)}
        >
          <header>
            <div className="matrix-heading">
              <strong>{quadrant.title}</strong>
              <span>{quadrant.hint} · {quadrant.rule}</span>
            </div>
            <div className="matrix-header-actions">
              <em>{groups[quadrant.id].length}</em>
              <button
                className="matrix-add-button"
                type="button"
                aria-label={`添加到${quadrant.title}`}
                title={`添加到${quadrant.title}`}
                onClick={() => onCreateItem(quadrant.id)}
              >
                <Icon name="plus" />
              </button>
            </div>
          </header>
          <div className="matrix-list">
            {groups[quadrant.id].length === 0 ? (
              <p>暂无任务</p>
            ) : (
              groups[quadrant.id].map((item) => (
                <article
                  className={draggedItemId === item.id ? "matrix-card dragging" : "matrix-card"}
                  key={item.id}
                  draggable
                  onDragStart={(event) => {
                    setDraggedItemId(item.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                  }}
                  onDragEnd={() => {
                    setDraggedItemId(null);
                    setDropTarget(null);
                  }}
                >
                  <button
                    className="checkbox"
                    type="button"
                    aria-label="标记完成"
                    onClick={() => patchItem(item.id, { status: "done" })}
                  />
                  <button type="button" className="matrix-card-main" onClick={() => setSelectedId(item.id)}>
                    <strong>{item.title}</strong>
                    <span>{matrixMeta(item)}</span>
                  </button>
                </article>
              ))
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function FocusPanel({
  items,
  selectedId,
  setSelectedId,
  seconds,
  running,
  focusMinutes,
  breakMinutes,
  setRunning,
  resetFocus,
  startBreak,
  setFocusDuration,
  setBreakDuration,
  completeTask,
  openTask,
}: {
  items: MemoItem[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  seconds: number;
  running: boolean;
  focusMinutes: number;
  breakMinutes: number;
  setRunning: (running: boolean) => void;
  resetFocus: (minutes?: number) => void;
  startBreak: () => void;
  setFocusDuration: (minutes: number) => void;
  setBreakDuration: (minutes: number) => void;
  completeTask: (id: string) => void;
  openTask: (id: string) => void;
}) {
  const selectedItem = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  return (
    <section className="focus-view" aria-label="番茄专注">
      <div className="focus-timer">
        <span>当前专注</span>
        <strong>{formatTimer(seconds)}</strong>
        <p>{selectedItem ? selectedItem.title : "自由专注，不绑定任务"}</p>
        <div className="focus-settings" aria-label="番茄钟设置">
          <label>
            <span>专注</span>
            <input
              type="number"
              min="1"
              max="180"
              value={focusMinutes}
              onChange={(event) => setFocusDuration(Number(event.target.value))}
              disabled={running}
            />
            <em>分钟</em>
          </label>
          <label>
            <span>休息</span>
            <input
              type="number"
              min="1"
              max="60"
              value={breakMinutes}
              onChange={(event) => setBreakDuration(Number(event.target.value))}
              disabled={running}
            />
            <em>分钟</em>
          </label>
        </div>
        <div className="focus-presets" aria-label="常用专注时长">
          {[15, 25, 45].map((minutes) => (
            <button
              className={focusMinutes === minutes ? "active" : ""}
              type="button"
              key={minutes}
              onClick={() => setFocusDuration(minutes)}
              disabled={running}
            >
              {minutes}
            </button>
          ))}
        </div>
        <div className="focus-actions">
          <button type="button" onClick={() => setRunning(!running)} disabled={seconds === 0}>
            {running ? "暂停" : "开始"}
          </button>
          <button type="button" onClick={() => resetFocus()}>
            重置 {focusMinutes} 分钟
          </button>
          <button type="button" onClick={startBreak}>
            休息 {breakMinutes} 分钟
          </button>
          {selectedItem && (
            <button type="button" onClick={() => completeTask(selectedItem.id)}>
              完成任务
            </button>
          )}
        </div>
      </div>

      <div className="focus-list">
        <header>
          <strong>待专注任务</strong>
          <span>{items.length}</span>
        </header>
        <div className="focus-list-body">
          {items.length === 0 ? (
            <p>没有未完成任务，也可以直接开始自由专注。</p>
          ) : (
            items.slice(0, 10).map((item) => (
              <button
                type="button"
                className={selectedItem?.id === item.id ? "active" : ""}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                onDoubleClick={() => openTask(item.id)}
              >
                <span>{emojiForItem(item)}</span>
                <strong>{item.title}</strong>
                <em>{item.reminderAt ? formatDateTime(item.reminderAt) : item.dueDate ? formatDate(item.dueDate) : "无日期"}</em>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function MonthCalendar({
  items,
  month,
  viewMode,
  setViewMode,
  setMonth,
  selectedDate,
  onSelectDate,
  onCreateItem,
  onSelectItem,
}: {
  items: MemoItem[];
  month: string;
  viewMode: CalendarViewMode;
  setViewMode: (value: CalendarViewMode) => void;
  setMonth: (value: string) => void;
  selectedDate: string;
  onSelectDate: (dateKey: string) => void;
  onCreateItem: (dateKey: string) => void;
  onSelectItem: (id: string) => void;
}) {
  const days = buildCalendarDays(month);
  const monthStart = parseMonthKey(month);
  const activeItems = items.filter((item) => !item.deletedAt && !item.archived);
  const selectedItems = activeItems.filter((item) => itemDateKey(item) === selectedDate).sort(sortItems);
  const dayScheduleSections = buildDayScheduleSections(selectedItems);
  const timedDayItemCount = selectedItems.filter((item) => Boolean(item.reminderAt)).length;
  const year = monthStart.getFullYear();

  if (viewMode === "day") {
    return (
      <section className="calendar-view day-calendar-view" aria-label="日历日视图">
        <div className="calendar-toolbar">
          <CalendarViewSwitch viewMode={viewMode} setViewMode={setViewMode} />
          <div className="calendar-nav-buttons">
            <button
              type="button"
              onClick={() => {
                const nextDate = addDays(selectedDate, -1);
                onSelectDate(nextDate);
                setMonth(nextDate.slice(0, 7));
              }}
              aria-label="前一天"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => {
                const today = getToday();
                onSelectDate(today);
                setMonth(today.slice(0, 7));
              }}
            >
              今天
            </button>
            <button
              type="button"
              onClick={() => {
                const nextDate = addDays(selectedDate, 1);
                onSelectDate(nextDate);
                setMonth(nextDate.slice(0, 7));
              }}
              aria-label="后一天"
            >
              ›
            </button>
          </div>
        </div>

        <div className="day-view-panel">
          <aside className="day-summary-card">
            <div className="day-summary-date">
              <span>{formatWeekday(selectedDate)}</span>
              <strong>{formatDayNumber(selectedDate)}</strong>
              <p>{formatFullDate(selectedDate)}</p>
            </div>
            <div className="day-summary-metrics">
              <div>
                <strong>{selectedItems.length}</strong>
                <span>安排</span>
              </div>
              <div>
                <strong>{timedDayItemCount}</strong>
                <span>定时</span>
              </div>
            </div>
            <button type="button" onClick={() => onCreateItem(selectedDate)}>
              添加任务
            </button>
          </aside>
          <div className="day-schedule" aria-label={`${formatFullDate(selectedDate)} 日程`}>
            {dayScheduleSections.map((section) => (
              <section className="day-schedule-section" key={section.id}>
                <div className="day-schedule-time">
                  <strong>{section.label}</strong>
                  <span>{section.range}</span>
                </div>
                <div className="day-schedule-items">
                  {section.items.length === 0 ? (
                    <p>无安排</p>
                  ) : (
                    section.items.map((item) => (
                      <button
                        type="button"
                        className={`day-schedule-event ${item.priority} ${item.status === "done" ? "done" : ""}`}
                        key={item.id}
                        onClick={() => onSelectItem(item.id)}
                      >
                        <span>{itemTimeLabel(item) || "全天"}</span>
                        <strong>{item.title}</strong>
                        <em>{item.priority === "high" ? "重要" : item.priority === "low" ? "低优先级" : "普通"}</em>
                      </button>
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (viewMode === "year") {
    const yearMonths = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);

    return (
      <section className="calendar-view year-calendar-view" aria-label="日历年视图">
        <div className="calendar-toolbar">
          <CalendarViewSwitch viewMode={viewMode} setViewMode={setViewMode} />
          <div className="calendar-nav-buttons">
            <button
              type="button"
              onClick={() => {
                const nextMonth = shiftYear(month, -1);
                setMonth(nextMonth);
                onSelectDate(toDateKey(parseMonthKey(nextMonth)));
              }}
              aria-label="上一年"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => {
                const today = getToday();
                setMonth(today.slice(0, 7));
                onSelectDate(today);
              }}
            >
              今年
            </button>
            <button
              type="button"
              onClick={() => {
                const nextMonth = shiftYear(month, 1);
                setMonth(nextMonth);
                onSelectDate(toDateKey(parseMonthKey(nextMonth)));
              }}
              aria-label="下一年"
            >
              ›
            </button>
          </div>
        </div>

        <div className="year-grid">
          {yearMonths.map((monthKeyValue) => {
            const monthItems = activeItems.filter((item) => itemDateKey(item)?.startsWith(monthKeyValue));
            return (
              <button
                type="button"
                className={monthKeyValue === month ? "year-month-card active" : "year-month-card"}
                key={monthKeyValue}
                onClick={() => {
                  setMonth(monthKeyValue);
                  onSelectDate(toDateKey(parseMonthKey(monthKeyValue)));
                  setViewMode("month");
                }}
              >
                <strong>{Number(monthKeyValue.slice(5, 7))}月</strong>
                <span>{monthItems.length} 项安排</span>
                <div>
                  {monthItems.length === 0 ? (
                    <em>暂无安排</em>
                  ) : (
                    monthItems.slice(0, 3).map((item) => <em key={item.id}>{item.title}</em>)
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="calendar-view" aria-label="月历">
      <div className="calendar-toolbar">
        <CalendarViewSwitch viewMode={viewMode} setViewMode={setViewMode} />
        <div className="calendar-nav-buttons">
          <button
            type="button"
            onClick={() => {
              const nextMonth = shiftMonth(month, -1);
              setMonth(nextMonth);
              onSelectDate(toDateKey(parseMonthKey(nextMonth)));
            }}
            aria-label="上个月"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => {
              const today = getToday();
              setMonth(monthKey(new Date()));
              onSelectDate(today);
            }}
          >
            今天
          </button>
          <button
            type="button"
            onClick={() => {
              const nextMonth = shiftMonth(month, 1);
              setMonth(nextMonth);
              onSelectDate(toDateKey(parseMonthKey(nextMonth)));
            }}
            aria-label="下个月"
          >
            ›
          </button>
        </div>
      </div>

      <div className="calendar-weekdays">
        {["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map((day) => {
          const key = toDateKey(day);
          const dayItems = activeItems.filter((item) => itemDateKey(item) === key);
          const isOtherMonth = day.getMonth() !== monthStart.getMonth();
          const isToday = key === getToday();
          const isSelected = key === selectedDate;

          return (
            <div
              className={`calendar-cell ${isOtherMonth ? "muted" : ""} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
              key={key}
              onClick={() => onSelectDate(key)}
              onDoubleClick={() => onCreateItem(key)}
            >
              <div className="calendar-day-head">
                <div className="calendar-day-number">{day.getDate()}</div>
              </div>
              <button
                className="calendar-create-button"
                type="button"
                aria-label={`在${formatDate(key)}添加任务`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateItem(key);
                }}
              >
                <span>+</span>
              </button>
              <div className="calendar-events">
                {dayItems.slice(0, 4).map((item) => (
                  <button
                    className={`calendar-event ${item.priority} ${item.status === "done" ? "done" : ""}`}
                    type="button"
                    key={item.id}
                    onClick={() => onSelectItem(item.id)}
                    title={item.title}
                  >
                    <span>{itemTimeLabel(item)}</span>
                    <strong>{item.title}</strong>
                  </button>
                ))}
                {dayItems.length > 4 && <span className="more-events">+{dayItems.length - 4}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="day-agenda">
        <div className="day-agenda-header">
          <strong>{formatDate(selectedDate)}</strong>
          <button type="button" onClick={() => onCreateItem(selectedDate)}>
            添加任务
          </button>
        </div>
        {selectedItems.length === 0 ? (
          <p>这一天还没有安排。</p>
        ) : (
          <div className="day-agenda-list">
            {selectedItems.slice(0, 5).map((item) => (
              <button type="button" key={item.id} onClick={() => onSelectItem(item.id)}>
                <span>{itemTimeLabel(item) || "全天"}</span>
                <strong>{item.title}</strong>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CalendarViewSwitch({
  viewMode,
  setViewMode,
}: {
  viewMode: CalendarViewMode;
  setViewMode: (value: CalendarViewMode) => void;
}) {
  const modes: Array<{ id: CalendarViewMode; label: string }> = [
    { id: "day", label: "日" },
    { id: "month", label: "月" },
    { id: "year", label: "年" },
  ];

  return (
    <div className="calendar-view-switch" aria-label="日历视图">
      {modes.map((mode) => (
        <button
          type="button"
          className={viewMode === mode.id ? "active" : ""}
          key={mode.id}
          onClick={() => setViewMode(mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

function ItemEditor({
  item,
  lists,
  onChange,
  onDelete,
  onRestore,
  onPermanentlyDelete,
  onClose,
}: {
  item: MemoItem;
  lists: MemoList[];
  onChange: (patch: Partial<MemoItem>) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onPermanentlyDelete: (id: string) => void;
  onClose: () => void;
}) {
  const selectedList = lists.find((list) => list.id === item.listId);
  const inTrash = Boolean(item.deletedAt || item.archived);
  const statusLabel = item.deletedAt
    ? "已删除"
    : item.archived
      ? "已归档"
      : item.kind === "note"
        ? "备忘"
        : item.status === "done"
          ? "已完成"
          : "进行中";

  return (
    <div className="task-detail">
      <div className="detail-toolbar">
        <button
          className={item.status === "done" ? "detail-check done" : "detail-check"}
          type="button"
          disabled={item.kind === "note" || inTrash}
          onClick={() => onChange({ status: item.status === "done" ? "open" : "done" })}
          aria-label={item.status === "done" ? "标记未完成" : "标记完成"}
        >
          {item.status === "done" && <Icon name="check" />}
        </button>
        <span>{statusLabel}</span>
        <div className="detail-toolbar-actions">
          <button type="button" onClick={onClose}>
            关闭
          </button>
          {inTrash ? (
            <>
              <button type="button" onClick={() => onRestore(item.id)}>
                恢复
              </button>
              <button type="button" className="danger-text" onClick={() => onPermanentlyDelete(item.id)}>
                彻底删除
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => onChange({ pinned: !item.pinned })}>
                {item.pinned ? "取消置顶" : "置顶"}
              </button>
              <button type="button" onClick={() => onChange({ archived: !item.archived })}>
                归档
              </button>
              <button type="button" className="danger-text" onClick={() => onDelete(item.id)}>
                删除
              </button>
            </>
          )}
        </div>
      </div>

      <input className="detail-title" value={item.title} onChange={(event) => onChange({ title: event.target.value })} />

      <div className="detail-meta">
        <label>
          <span>清单</span>
          <select value={item.listId ?? ""} onChange={(event) => onChange({ listId: event.target.value || null })}>
            <option value="">收集箱</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.emoji} {list.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>类型</span>
          <select value={item.kind} onChange={(event) => onChange({ kind: event.target.value as MemoItem["kind"] })}>
            <option value="task">待办</option>
            <option value="note">备忘</option>
          </select>
        </label>

        <label>
          <span>优先级</span>
          <select value={item.priority} onChange={(event) => onChange({ priority: event.target.value as Priority })}>
            <option value="normal">普通</option>
            <option value="high">重要</option>
            <option value="low">低</option>
          </select>
        </label>

        <label>
          <span>日期</span>
          <input
            type="date"
            value={item.dueDate ?? ""}
            onChange={(event) => onChange({ dueDate: event.target.value || null })}
            disabled={item.kind === "note"}
          />
        </label>

        <label>
          <span>提醒</span>
          <input
            type="datetime-local"
            value={toLocalDateTimeInput(item.reminderAt)}
            onChange={(event) => onChange({ reminderAt: fromLocalDateTimeInput(event.target.value) })}
            disabled={item.kind === "note"}
          />
        </label>

        <label>
          <span>重复</span>
          <select
            value={item.repeatRule}
            onChange={(event) => onChange({ repeatRule: event.target.value as RepeatRule })}
            disabled={item.kind === "note"}
          >
            <option value="none">不重复</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
          </select>
        </label>
      </div>

      <div className="detail-chips">
        <span>{selectedList ? `${selectedList.emoji} ${selectedList.name}` : "收集箱"}</span>
        <span>{item.priority === "high" ? "重要" : item.priority === "low" ? "低优先级" : "普通"}</span>
        {item.repeatRule !== "none" && <span>{repeatRuleLabel(item.repeatRule)}</span>}
        {item.dueDate && <span>{formatDate(item.dueDate)}</span>}
        {item.reminderAt && <span>提醒 {formatDateTime(item.reminderAt)}</span>}
        {item.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </div>

      <label className="detail-note">
        <span>备注</span>
        <textarea
          value={item.body}
          onChange={(event) => onChange({ body: event.target.value })}
          placeholder="添加备注、链接、想法..."
          rows={10}
        />
      </label>

      <div className="detail-meta single">
        <label>
          <span>标签</span>
          <input value={item.tags.join(" ")} onChange={(event) => onChange({ tags: parseTags(event.target.value) })} />
        </label>
      </div>

      <p className="detail-updated">更新于 {formatDateTime(item.updatedAt)}</p>
    </div>
  );
}

function UtilityPanel({
  panel,
  items,
  counts,
  query,
  setQuery,
  session,
  email,
  setEmail,
  password,
  setPassword,
  authMessage,
  syncError,
  lastSyncedAt,
  syncing,
  pendingSync,
  localStats,
  cloudStats,
  cloudStatsLoading,
  submitLogin,
  submitSignup,
  runSync,
  refreshCloudStats,
  refreshApp,
  notificationPermission,
  requestReminderPermission,
}: {
  panel: RailPanel;
  items: MemoItem[];
  counts: ReturnType<typeof getCounts>;
  query: string;
  setQuery: (value: string) => void;
  session: Session | null;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  authMessage: string;
  syncError: string | null;
  lastSyncedAt: string | null;
  syncing: boolean;
  pendingSync: boolean;
  localStats: LocalSyncStats;
  cloudStats: CloudStats | null;
  cloudStatsLoading: boolean;
  submitLogin: (event: FormEvent<HTMLFormElement>) => void;
  submitSignup: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>) => void;
  runSync: () => Promise<void>;
  refreshCloudStats: () => Promise<void>;
  refreshApp: () => Promise<void>;
  notificationPermission: ReminderPermissionState;
  requestReminderPermission: () => Promise<void>;
}) {
  if (panel === "sync") {
    return (
      <section className="utility-panel">
        <h2>同步</h2>
        <p>开启 Supabase 后，电脑和手机会使用同一个账号同步清单和任务。</p>
        <SyncBox
          session={session}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          authMessage={authMessage}
          syncError={syncError}
          lastSyncedAt={lastSyncedAt}
          syncing={syncing}
          pendingSync={pendingSync}
          localStats={localStats}
          cloudStats={cloudStats}
          cloudStatsLoading={cloudStatsLoading}
          submitLogin={submitLogin}
          submitSignup={submitSignup}
          runSync={runSync}
          refreshCloudStats={refreshCloudStats}
          refreshApp={refreshApp}
        />
      </section>
    );
  }

  if (panel === "search") {
    return (
      <section className="utility-panel">
        <h2>搜索</h2>
        <p>搜索会匹配标题、备注和标签。</p>
        <label className="utility-search">
          <Icon name="search" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词" autoFocus />
        </label>
      </section>
    );
  }

  if (panel === "calendar" || panel === "reminders") {
    const today = getToday();
    const dated = items
      .filter((item) => !item.deletedAt && !item.archived && item.status === "open" && (item.dueDate || item.reminderAt))
      .sort((a, b) => String(a.reminderAt ?? a.dueDate).localeCompare(String(b.reminderAt ?? b.dueDate)));

    return (
      <section className="utility-panel">
        <h2>{panel === "calendar" ? "日历" : "提醒"}</h2>
        <div className="metric-grid">
          <div>
            <strong>{counts.today}</strong>
            <span>今天</span>
          </div>
          <div>
            <strong>{counts.upcoming}</strong>
            <span>最近7天</span>
          </div>
        </div>
        {panel === "reminders" && (
          <div className="reminder-permission">
            <div>
              <strong>本机提醒</strong>
              <span>{notificationPermissionLabel(notificationPermission)}</span>
            </div>
            <button
              type="button"
              onClick={() => void requestReminderPermission()}
              disabled={notificationPermission === "granted" || notificationPermission === "unsupported"}
            >
              {notificationPermission === "granted" ? "已开启" : "开启提醒"}
            </button>
          </div>
        )}
        <div className="utility-list">
          {dated.length === 0 ? (
            <p>暂无带日期的任务。</p>
          ) : (
            dated.slice(0, 8).map((item) => (
              <div key={item.id}>
                <span>
                  {item.reminderAt
                    ? formatDateTime(item.reminderAt)
                    : item.dueDate === today
                      ? "今天"
                      : item.dueDate
                        ? formatDate(item.dueDate)
                        : ""}
                </span>
                <strong>{item.title}</strong>
              </div>
            ))
          )}
        </div>
      </section>
    );
  }

  if (panel === "help") {
    return (
      <section className="utility-panel">
        <h2>帮助</h2>
        <div className="help-list">
          <p>点击左侧清单切换分类。</p>
          <p>清单右侧的铅笔可以重命名，叉号会先归档；需要时可在清单管理里彻底删除。</p>
          <p>点击任务后，右侧会打开完整详情。</p>
          <p>在详情里可以移动清单、设置日期、优先级和标签。</p>
        </div>
      </section>
    );
  }

  return (
    <div className="blank-illustration" aria-hidden="true">
      <span className="star star-one">✦</span>
      <span className="star star-two">✦</span>
      <span className="star star-three">✦</span>
      <div className="paper-ghost" />
      <div className="book-ghost" />
      <div className="cup-ghost" />
    </div>
  );
}

function RailButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      className={active ? "rail-button active" : "rail-button"}
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
    >
      <Icon name={icon} />
    </button>
  );
}

type IconName =
  | "archive"
  | "bell"
  | "calendar"
  | "check"
  | "chevron"
  | "circleCheck"
  | "edit"
  | "help"
  | "matrix"
  | "menu"
  | "more"
  | "note"
  | "pin"
  | "plus"
  | "search"
  | "settings"
  | "sort"
  | "sync"
  | "tag"
  | "timer"
  | "tray"
  | "trash"
  | "week"
  | "x";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactElement> = {
    archive: <path d="M4 7h16M6 7v11h12V7M9 11h6M5 4h14v3H5z" />,
    bell: <path d="M18 16H6l1.3-2V9a4.7 4.7 0 0 1 9.4 0v5zM10 19h4" />,
    calendar: <path d="M7 3v4M17 3v4M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    circleCheck: <path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-3 8 2 2 4-5" />,
    edit: <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17zM13.5 7.5l3 3" />,
    help: <path d="M9.5 9a2.7 2.7 0 1 1 4.5 2c-.9.7-1.7 1.2-1.7 2.5M12 17h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />,
    matrix: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
    menu: <path d="M5 7h14M5 12h14M5 17h14" />,
    more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
    note: <path d="M6 4h9l3 3v13H6zM14 4v4h4M9 12h6M9 16h6" />,
    pin: <path d="m14 4 6 6-4 1-4 6-2-2 6-4-1-4zM9 15l-5 5" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <path d="M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm4.5 10.5L20 20" />,
    settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" />,
    sort: <path d="M8 6v12M5 9l3-3 3 3M16 18V6M13 15l3 3 3-3" />,
    sync: <path d="M20 7v5h-5M4 17v-5h5M18 9a7 7 0 0 0-11.7-2M6 15a7 7 0 0 0 11.7 2" />,
    tag: <path d="M4 11V5h6l9 9-6 6zM8 8h.01" />,
    timer: <path d="M9 2h6M12 8v5l3 2M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" />,
    tray: <path d="M4 13h5l2 3h2l2-3h5M5 5h14l2 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />,
    trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
    week: <path d="M7 3v4M17 3v4M4 9h16M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />,
    x: <path d="m7 7 10 10M17 7 7 17" />,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}

function initialItems(): MemoItem[] {
  const stored = loadItems();
  if (stored.length > 0) {
    const legacyWithoutLists = stored.every((item) => item.listId === null);
    return stored
      .map((item) => (legacyWithoutLists ? { ...item, listId: defaultListsSeed[0].id } : item))
      .sort(sortItems);
  }

  const createdAt = nowIso();
  const [welcome, work, personal, study] = defaultListsSeed;
  const titles: Array<Pick<MemoItem, "title" | "body" | "kind" | "priority" | "tags" | "pinned" | "listId">> = [
    { title: "点击输入框，创建任务", body: "最常用的动作要在第一屏完成。", kind: "task", priority: "normal", tags: ["新手入门"], pinned: true, listId: welcome.id },
    { title: "用清单来管理任务", body: "例如工作、个人、学习。", kind: "task", priority: "normal", tags: ["新手入门"], pinned: false, listId: welcome.id },
    { title: "日历：日程安排一目了然", body: "", kind: "task", priority: "normal", tags: ["功能模块"], pinned: false, listId: work.id },
    { title: "四象限：提升效率利器", body: "", kind: "task", priority: "high", tags: ["功能模块"], pinned: false, listId: work.id },
    { title: "番茄专注：拯救拖延症", body: "", kind: "task", priority: "normal", tags: ["功能模块"], pinned: false, listId: personal.id },
    { title: "习惯打卡：见证坚持与成长", body: "", kind: "task", priority: "normal", tags: ["功能模块"], pinned: false, listId: personal.id },
    { title: "看板、时间线视图：可视化管理", body: "", kind: "task", priority: "normal", tags: ["探索更多"], pinned: false, listId: study.id },
    { title: "桌面便签：随时记录想法", body: "", kind: "note", priority: "normal", tags: ["探索更多"], pinned: false, listId: personal.id },
    { title: "订阅日历：不再错过重要日程", body: "", kind: "task", priority: "low", tags: ["探索更多"], pinned: false, listId: work.id },
    { title: "更多特色功能", body: "", kind: "note", priority: "normal", tags: ["探索更多"], pinned: false, listId: welcome.id },
  ];

  return titles.map((item, index) => ({
    id: createId(),
    listId: item.listId,
    title: item.title,
    body: item.body,
    kind: item.kind,
    status: "open",
    priority: item.priority,
    repeatRule: "none",
    dueDate: null,
    reminderAt: index === 0 ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null,
    tags: item.tags,
    pinned: item.pinned,
    archived: false,
    deletedAt: null,
    createdAt,
    updatedAt: new Date(Date.now() - index * 1000).toISOString(),
  }));
}

function initialLists(): MemoList[] {
  const stored = loadLists();
  if (stored.length > 0) return stored;
  const createdAt = nowIso();

  return defaultListsSeed.map((list, index) => ({
    ...list,
    archived: false,
    deletedAt: null,
    createdAt,
    updatedAt: new Date(Date.now() - index * 1000).toISOString(),
  }));
}

function getCounts(items: MemoItem[]) {
  const active = items.filter((item) => item.status !== "purged" && !item.deletedAt && !item.archived);
  const open = active.filter((item) => item.status === "open");
  const today = getToday();
  const weekEnd = addDays(today, 7);

  return {
    open: open.length,
    today: open.filter((item) => item.dueDate === today || item.reminderAt?.startsWith(today)).length,
    upcoming: open.filter((item) => {
      const date = item.dueDate ?? item.reminderAt?.slice(0, 10);
      return Boolean(date && date <= weekEnd);
    }).length,
    pinned: active.filter((item) => item.pinned).length,
    notes: active.filter((item) => item.kind === "note").length,
    done: active.filter((item) => item.status === "done").length,
    archived: items.filter((item) => item.status !== "purged" && (item.archived || item.deletedAt)).length,
  };
}

function getLocalSyncStats(items: MemoItem[], lists: MemoList[]): LocalSyncStats {
  return {
    items: items.filter((item) => item.status !== "purged").length,
    openItems: items.filter((item) => item.status !== "purged" && !item.deletedAt && !item.archived && item.status === "open").length,
    deletedItems: items.filter((item) => item.status !== "purged" && item.deletedAt).length,
    lists: lists.filter((list) => !list.deletedAt).length,
    activeLists: lists.filter((list) => !list.archived && !list.deletedAt).length,
  };
}

function getFocusCandidates(items: MemoItem[]): MemoItem[] {
  return items
    .filter((item) => item.kind === "task" && item.status === "open" && !item.deletedAt && !item.archived)
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || itemSortTime(a).localeCompare(itemSortTime(b)));
}

function createNextRecurringItem(item: MemoItem, createdAt: string): MemoItem | null {
  if (item.kind !== "task" || item.repeatRule === "none") return null;

  const nextDate = nextRecurringDate(itemDateKey(item) ?? getToday(), item.repeatRule);
  const nextReminderAt = item.reminderAt ? shiftIsoDate(item.reminderAt, item.repeatRule) : null;

  return {
    ...item,
    id: createId(),
    status: "open",
    dueDate: nextReminderAt ? toDateKey(new Date(nextReminderAt)) : nextDate,
    reminderAt: nextReminderAt,
    pinned: false,
    archived: false,
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function nextRecurringDate(dateKey: string, repeatRule: RepeatRule): string {
  if (repeatRule === "daily") return addDays(dateKey, 1);
  if (repeatRule === "weekly") return addDays(dateKey, 7);
  if (repeatRule === "monthly") {
    const date = new Date(`${dateKey}T00:00:00`);
    date.setMonth(date.getMonth() + 1);
    return toDateKey(date);
  }
  return dateKey;
}

function shiftIsoDate(value: string, repeatRule: RepeatRule): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (repeatRule === "daily") date.setDate(date.getDate() + 1);
  if (repeatRule === "weekly") date.setDate(date.getDate() + 7);
  if (repeatRule === "monthly") date.setMonth(date.getMonth() + 1);
  return date.toISOString();
}

function groupMatrixItems(items: MemoItem[]): Record<MatrixQuadrant, MemoItem[]> {
  const groups: Record<MatrixQuadrant, MemoItem[]> = {
    urgentImportant: [],
    important: [],
    urgent: [],
    later: [],
  };

  for (const item of getFocusCandidates(items)) {
    const important = item.priority === "high" || item.pinned;
    const urgent = isUrgentItem(item);
    if (important && urgent) groups.urgentImportant.push(item);
    else if (important) groups.important.push(item);
    else if (urgent) groups.urgent.push(item);
    else groups.later.push(item);
  }

  return groups;
}

function matrixDraftDefaults(quadrant: MatrixQuadrant): { priority: Priority; dueDate: string | null } {
  if (quadrant === "urgentImportant") return { priority: "high", dueDate: getToday() };
  if (quadrant === "important") return { priority: "high", dueDate: null };
  if (quadrant === "urgent") return { priority: "normal", dueDate: getToday() };
  return { priority: "low", dueDate: null };
}

function matrixPatchForQuadrant(quadrant: MatrixQuadrant): Partial<MemoItem> {
  const defaults = matrixDraftDefaults(quadrant);
  return {
    priority: defaults.priority,
    dueDate: defaults.dueDate,
    reminderAt: null,
    pinned: false,
  };
}

function matrixQuadrantTitle(quadrant: MatrixQuadrant): string {
  return matrixQuadrants.find((item) => item.id === quadrant)?.title ?? "四象限";
}

function matrixQuadrantModalHint(quadrant: MatrixQuadrant): string {
  const today = formatDate(getToday());
  if (quadrant === "urgentImportant") return `默认设为重要，并安排到 ${today}。输入具体时间会自动识别。`;
  if (quadrant === "important") return "默认设为重要，不强制日期。输入今天、明天或时间会自动识别。";
  if (quadrant === "urgent") return `默认安排到 ${today}，优先级保持普通。输入具体时间会自动识别。`;
  return "默认设为低优先级，不强制日期。输入时间时仍会自动识别。";
}

function isUrgentItem(item: MemoItem): boolean {
  const date = item.dueDate ?? item.reminderAt?.slice(0, 10);
  if (!date) return false;
  return date <= addDays(getToday(), 1);
}

function matrixMeta(item: MemoItem): string {
  const parts = [
    item.priority === "high" ? "重要" : item.priority === "low" ? "低优先级" : "普通",
    item.reminderAt ? formatDateTime(item.reminderAt) : item.dueDate ? formatDate(item.dueDate) : "",
    ...item.tags.slice(0, 2).map((tag) => `#${tag}`),
  ].filter(Boolean);
  return parts.join(" · ") || "无日期";
}

function filterItems(
  items: MemoItem[],
  view: ViewFilter,
  query: string,
  selectedListId: string | null,
  selectedTag: string | null,
  sortMode: SortMode
): MemoItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const today = getToday();
  const weekEnd = addDays(today, 7);

  return items
    .filter((item) => {
      if (item.status === "purged") return false;
      if (view === "archive") return Boolean(item.archived || item.deletedAt);
      if (item.archived || item.deletedAt) return false;
      if (view === "today") {
        return (item.dueDate === today || item.reminderAt?.startsWith(today)) && item.status === "open";
      }
      if (view === "upcoming") {
        const date = item.dueDate ?? item.reminderAt?.slice(0, 10);
        return Boolean(date && date <= weekEnd) && item.status === "open";
      }
      if (view === "pinned") return item.pinned;
      if (view === "notes") return item.kind === "note";
      if (view === "done") return item.status === "done";
      return item.status === "open";
    })
    .filter((item) => {
      if (!selectedListId) return true;
      return item.listId === selectedListId;
    })
    .filter((item) => {
      if (!selectedTag) return true;
      return item.tags.includes(selectedTag);
    })
    .filter((item) => {
      if (!normalizedQuery) return true;
      const haystack = [item.title, item.body, item.tags.join(" ")].join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .sort((a, b) => compareItems(a, b, sortMode));
}

function groupItems(
  items: MemoItem[],
  view: ViewFilter,
  lists: MemoList[],
  selectedListId: string | null,
  selectedTag: string | null
): Array<{ title: string; items: MemoItem[] }> {
  if (items.length === 0) return [];
  if (view === "today") return [{ title: "今天", items }];
  if (view === "done") return [{ title: "已完成", items }];
  if (view === "archive") return [{ title: "垃圾桶", items }];
  if (selectedTag) return [{ title: `#${selectedTag}`, items }];
  if (!selectedListId) {
    const map = new Map<string, MemoItem[]>();
    for (const item of items) {
      const list = lists.find((value) => value.id === item.listId);
      const key = list ? `${list.emoji} ${list.name}` : "收集箱";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()].map(([title, groupItemsValue]) => ({ title, items: groupItemsValue }));
  }

  const map = new Map<string, MemoItem[]>();
  for (const item of items) {
    const key = item.pinned ? "置顶" : item.tags[0] || (item.kind === "note" ? "备忘" : "任务");
    map.set(key, [...(map.get(key) ?? []), item]);
  }

  return [...map.entries()].map(([title, groupItemsValue]) => ({ title, items: groupItemsValue }));
}

function countForView(view: ViewFilter, counts: ReturnType<typeof getCounts>): number {
  if (view === "today") return counts.today;
  if (view === "upcoming") return counts.upcoming;
  if (view === "pinned") return counts.pinned;
  if (view === "notes") return counts.notes;
  return counts.open;
}

function countByList(items: MemoItem[], listId: string): number {
  return items.filter((item) => !item.deletedAt && !item.archived && item.status === "open" && item.listId === listId)
    .length;
}

function viewTitle(view: ViewFilter): string {
  if (view === "today") return "📅 今天";
  if (view === "upcoming") return "🗓 最近7天";
  if (view === "done") return "✅ 已完成";
  if (view === "archive") return "🗑 垃圾桶";
  if (view === "notes") return "📝 便签";
  if (view === "pinned") return "📌 置顶";
  return "📥 收集箱";
}

function getTagStats(items: MemoItem[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();

  for (const item of items) {
    if (item.deletedAt || item.archived || item.status !== "open") continue;
    for (const tag of item.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

function isDemoItem(item: MemoItem): boolean {
  return item.status !== "purged" && isDemoItemTitle(item.title);
}

function countDemoItems(items: MemoItem[]): number {
  return items.filter(isDemoItem).length;
}

function cssSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `-${char.charCodeAt(0).toString(16)}`);
}

function nextSortMode(mode: SortMode): SortMode {
  if (mode === "smart") return "time";
  if (mode === "time") return "priority";
  return "smart";
}

function sortModeLabel(mode: SortMode): string {
  if (mode === "time") return "时间";
  if (mode === "priority") return "优先";
  return "智能";
}

function repeatRuleLabel(rule: RepeatRule): string {
  if (rule === "daily") return "每天重复";
  if (rule === "weekly") return "每周重复";
  if (rule === "monthly") return "每月重复";
  return "不重复";
}

function notificationPermissionLabel(permission: ReminderPermissionState): string {
  if (permission === "granted") return "已开启，应用打开时会弹出系统通知。";
  if (permission === "denied") return "浏览器已拒绝通知，需要在站点设置里重新允许。";
  if (permission === "unsupported") return "当前浏览器不支持系统通知。";
  return "未开启，只会显示应用内提示。";
}

function getSyncStatus(
  session: Session | null,
  syncing: boolean,
  pendingSync: boolean,
  syncError: string | null,
  lastSyncedAt: string | null
): { text: string; tone: "offline" | "online" | "syncing" | "pending" | "error" } {
  if (!isSupabaseConfigured) return { text: "仅保存在本机，配置 Supabase 后可多端同步", tone: "offline" };
  if (!session) return { text: "未登录，同步暂未开启", tone: "offline" };
  if (syncing) return { text: "正在同步到云端...", tone: "syncing" };
  if (syncError) return { text: pendingSync ? "同步失败，本地改动仍待上传" : "同步失败，可手动重试", tone: "error" };
  if (pendingSync) return { text: "本地改动等待自动同步", tone: "pending" };
  if (lastSyncedAt) return { text: `已同步：${formatDateTime(lastSyncedAt)}`, tone: "online" };
  return { text: "已登录，正在准备第一次同步", tone: "pending" };
}

function errorMessage(error: unknown, fallback: string): string {
  const schemaMessage = "\u6570\u636E\u5E93\u7ED3\u6784\u8FC7\u65E7\uFF0C\u8BF7\u91CD\u65B0\u6267\u884C supabase-schema.sql\uFF0C\u81F3\u5C11\u8865\u4E0A memo_lists.deleted_at \u4EE5\u53CA memo_items.status \u7684 purged \u7EA6\u675F\u3002";
  const emailConfirmMessage = "\u90AE\u7BB1\u8FD8\u6CA1\u786E\u8BA4\u3002\u8BF7\u5173\u95ED Supabase \u7684 Confirm email \u540E\u518D\u767B\u5F55\u3002";

  if (error instanceof Error && error.message) {
    if (isEmailConfirmIssue(error.message)) return emailConfirmMessage;
    if (isSchemaUpgradeIssue(error.message)) return schemaMessage;
    return error.message;
  }
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [value.message, value.details, value.hint]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim());
    if (parts.length > 0) {
      const code = typeof value.code === "string" ? " [" + value.code + "]" : "";
      const message = parts.join(" ") + code;
      if (isEmailConfirmIssue(message)) return emailConfirmMessage;
      if (isSchemaUpgradeIssue(message)) return schemaMessage;
      return message;
    }
  }
  if (typeof error === "string" && error.trim()) {
    return isSchemaUpgradeIssue(error) ? schemaMessage : error.trim();
  }
  return fallback;
}

function isEmailConfirmIssue(value: string | null | undefined): boolean {
  if (!value) return false;
  const text = value.toLowerCase();
  return text.includes("confirm email") || text.includes("email not confirmed") || text.includes("\u90AE\u7BB1\u8FD8\u6CA1\u786E\u8BA4");
}

function isSchemaUpgradeIssue(value: string | null | undefined): boolean {
  if (!value) return false;
  const text = value.toLowerCase();
  return (
    (text.includes("memo_lists") && text.includes("deleted_at")) ||
    (text.includes("memo_items") && text.includes("status")) ||
    text.includes("pgrst204")
  );
}

function syncSignature(items: MemoItem[], lists: MemoList[]): string {
  const itemParts = items
    .map((item) =>
      [
        item.id,
        item.updatedAt,
        item.deletedAt ?? "",
        item.archived ? "1" : "0",
        item.status,
        item.repeatRule,
        item.listId ?? "",
      ].join(":")
    )
    .sort();
  const listParts = lists
    .map((list) => [list.id, list.updatedAt, list.archived ? "1" : "0", list.deletedAt ?? ""].join(":"))
    .sort();

  return `${itemParts.join("|")}::${listParts.join("|")}`;
}

function compareItems(a: MemoItem, b: MemoItem, mode: SortMode): number {
  if (mode === "time") {
    return itemSortTime(a).localeCompare(itemSortTime(b)) || sortItems(a, b);
  }

  if (mode === "priority") {
    return priorityRank(b.priority) - priorityRank(a.priority) || sortItems(a, b);
  }

  return sortItems(a, b);
}

function itemSortTime(item: MemoItem): string {
  return item.reminderAt ?? item.dueDate ?? "9999-12-31T23:59:59.999Z";
}

function priorityRank(priority: Priority): number {
  if (priority === "high") return 3;
  if (priority === "normal") return 2;
  return 1;
}

function clampTimerMinutes(value: number): number {
  if (!Number.isFinite(value)) return 25;
  return Math.min(180, Math.max(1, Math.round(value)));
}

function panelForView(view: ViewFilter): RailPanel {
  if (view === "today") return "calendar";
  if (view === "upcoming") return "reminders";
  return "tasks";
}

function initialPanel(): RailPanel {
  return window.location.hash === "#calendar" ? "calendar" : "tasks";
}

function emojiForItem(item: MemoItem): string {
  if (item.kind === "note") return "✎";
  if (item.priority === "high") return "!";
  if (item.priority === "low") return "◇";
  if (item.tags.includes("功能模块")) return "▣";
  if (item.tags.includes("探索更多")) return "◆";
  return "•";
}

function itemMarkerClass(item: MemoItem): string {
  const classes = ["task-emoji", `priority-${item.priority}`];
  if (item.kind === "note") classes.push("note-marker");
  if (item.tags.includes("功能模块")) classes.push("feature-marker");
  if (item.tags.includes("探索更多")) classes.push("explore-marker");
  return classes.join(" ");
}

function nextListEmoji(index: number): string {
  const emojis = ["📋", "🧠", "🚀", "📌", "🛠", "🎯", "🧾", "💡"];
  return emojis[index % emojis.length];
}

function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,，、]+/)
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean)
    )
  ).slice(0, 8);
}

function splitInlineTags(value: string): { title: string; tags: string[] } {
  const tags: string[] = [];
  const title = value
    .replace(/(^|\s)#([^\s#，,、]+)/g, (_match, leading: string, tag: string) => {
      tags.push(tag);
      return leading;
    })
    .replace(/\s{2,}/g, " ")
    .trim();

  return { title, tags: parseTags(tags.join(" ")) };
}

function mergeTags(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat())).slice(0, 8);
}

function formatMonthTitle(value: string): string {
  const date = parseMonthKey(value);
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月`;
}

function formatCalendarTitle(mode: CalendarViewMode, month: string, selectedDate: string): string {
  if (mode === "day") return formatFullDate(selectedDate);
  if (mode === "year") return `${parseMonthKey(month).getFullYear()}年`;
  return formatMonthTitle(month);
}

function buildCalendarDays(value: string): Date[] {
  const first = parseMonthKey(value);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function itemDateKey(item: MemoItem): string | null {
  if (item.reminderAt) return toDateKey(new Date(item.reminderAt));
  return item.dueDate;
}

function itemTimeLabel(item: MemoItem): string {
  if (!item.reminderAt) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(item.reminderAt));
}

function buildDayScheduleSections(items: MemoItem[]): Array<{
  id: string;
  label: string;
  range: string;
  items: MemoItem[];
}> {
  const sections = [
    { id: "all-day", label: "全天", range: "无具体时间", from: null, to: null, items: [] as MemoItem[] },
    { id: "morning", label: "上午", range: "06:00-12:00", from: 6 * 60, to: 12 * 60, items: [] as MemoItem[] },
    { id: "afternoon", label: "下午", range: "12:00-18:00", from: 12 * 60, to: 18 * 60, items: [] as MemoItem[] },
    { id: "evening", label: "晚上", range: "18:00-24:00", from: 18 * 60, to: 24 * 60, items: [] as MemoItem[] },
    { id: "late-night", label: "深夜", range: "00:00-06:00", from: 0, to: 6 * 60, items: [] as MemoItem[] },
  ];

  for (const item of items) {
    const minutes = itemScheduleMinutes(item);
    if (minutes === null) {
      sections[0].items.push(item);
      continue;
    }

    const section = sections.find((value) => value.from !== null && minutes >= value.from && minutes < value.to!);
    (section ?? sections[0]).items.push(item);
  }

  return sections.map((section) => ({
    id: section.id,
    label: section.label,
    range: section.range,
    items: section.items.sort(compareScheduleItems),
  }));
}

function compareScheduleItems(a: MemoItem, b: MemoItem): number {
  const aMinutes = itemScheduleMinutes(a);
  const bMinutes = itemScheduleMinutes(b);
  if (aMinutes !== bMinutes) return (aMinutes ?? -1) - (bMinutes ?? -1);
  return sortItems(a, b);
}

function itemScheduleMinutes(item: MemoItem): number | null {
  if (!item.reminderAt) return null;
  const date = new Date(item.reminderAt);
  return date.getHours() * 60 + date.getMinutes();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatFullDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(
    new Date(`${value}T00:00:00`)
  );
}

function formatWeekday(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(new Date(`${value}T00:00:00`));
}

function formatDayNumber(value: string): string {
  return String(new Date(`${value}T00:00:00`).getDate()).padStart(2, "0");
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTimer(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function toLocalDateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
