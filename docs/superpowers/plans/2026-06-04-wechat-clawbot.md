# WeChat ClawBot Todo Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ClawBot-compatible WeChat assistant that can bind accounts, create todo items, list tasks, complete/delete tasks, and support reminder delivery state.

**Architecture:** Add focused bot-domain modules for intent parsing and response planning, then expose them through serverless endpoints that use a Supabase service-role client. Keep the existing React app and Supabase sync model unchanged; bot-created tasks write to the same `memo_items` table.

**Tech Stack:** TypeScript, Vite/Vitest, Supabase Postgres, Supabase service-role API, Vercel serverless functions or Supabase Edge Functions, ClawBot webhook/send-message API.

---

## File Structure

- Create `src/bot/intent.ts`: parse incoming bot text into typed intents.
- Create `src/bot/taskText.ts`: parse task text, early reminder offsets, and reminder dates.
- Create `src/bot/taskMatcher.ts`: find the closest open task for done/delete commands.
- Create `src/bot/responses.ts`: format bot replies.
- Create `src/bot/intent.test.ts`: unit tests for command routing and time parsing.
- Create `src/bot/taskMatcher.test.ts`: unit tests for matching open tasks.
- Modify `supabase-schema.sql`: add bot binding and reminder event tables.
- Create `api/bot/message.ts`: ClawBot incoming message endpoint.
- Create `api/bot/reminders.ts`: reminder scan endpoint for Supabase Cron.
- Create `api/_bot/supabaseAdmin.ts`: service-role Supabase client for API routes.
- Create `api/_bot/http.ts`: shared request validation and JSON helpers.
- Modify `.env.example`: document server-side bot environment variables.
- Modify `README.md` only if encoding can be preserved; otherwise add `docs/wechat-clawbot.md`.

## Task 1: Bot Intent Parser

**Files:**
- Create: `src/bot/intent.ts`
- Create: `src/bot/taskText.ts`
- Create: `src/bot/intent.test.ts`

- [ ] **Step 1: Write failing tests for supported commands**

```ts
import { describe, expect, it } from "vitest";
import { parseBotIntent } from "./intent";

const baseDate = new Date("2026-06-04T08:00:00+08:00");

describe("parseBotIntent", () => {
  it("parses bind commands", () => {
    expect(parseBotIntent("绑定 TD-839201", baseDate)).toEqual({
      type: "bind",
      code: "TD-839201",
    });
  });

  it("parses today-list commands", () => {
    expect(parseBotIntent("今天有什么没完成", baseDate)).toEqual({ type: "listToday" });
  });

  it("parses open-list commands", () => {
    expect(parseBotIntent("任务列表", baseDate)).toEqual({ type: "listOpen" });
  });

  it("parses done commands", () => {
    expect(parseBotIntent("完成 复习英语", baseDate)).toEqual({
      type: "complete",
      query: "复习英语",
    });
  });

  it("parses delete commands", () => {
    expect(parseBotIntent("删除 复习英语", baseDate)).toEqual({
      type: "delete",
      query: "复习英语",
    });
  });

  it("parses snooze commands", () => {
    expect(parseBotIntent("稍后10分钟提醒", baseDate)).toEqual({
      type: "snooze",
      minutes: 10,
    });
  });

  it("parses create commands with an early reminder offset", () => {
    const intent = parseBotIntent("明天上午10点交作业，提前30分钟提醒", baseDate);
    expect(intent.type).toBe("createTask");
    if (intent.type !== "createTask") throw new Error("expected createTask");
    expect(intent.title).toBe("交作业");
    expect(intent.dueDate).toBe("2026-06-05");
    expect(new Date(intent.reminderAt ?? "").getTime()).toBe(new Date("2026-06-05T01:30:00.000Z").getTime());
    expect(new Date(intent.eventAt ?? "").getTime()).toBe(new Date("2026-06-05T02:00:00.000Z").getTime());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm.cmd test -- src/bot/intent.test.ts`

Expected: FAIL because `src/bot/intent.ts` does not exist.

- [ ] **Step 3: Implement parser types and routing**

```ts
import { parseTaskInput } from "../taskInputParser";

export type BotIntent =
  | { type: "bind"; code: string }
  | { type: "listToday" }
  | { type: "listOpen" }
  | { type: "complete"; query: string }
  | { type: "delete"; query: string }
  | { type: "snooze"; minutes: number }
  | { type: "createTask"; title: string; dueDate: string | null; reminderAt: string | null; eventAt: string | null; raw: string }
  | { type: "unknown"; raw: string };

export function parseBotIntent(rawText: string, baseDate = new Date()): BotIntent {
  const text = normalizeText(rawText);
  if (!text) return { type: "unknown", raw: rawText };

  const bind = text.match(/^(?:绑定|bind)\s+([A-Za-z]{2,8}-?\d{4,10})$/i);
  if (bind) return { type: "bind", code: bind[1].toUpperCase() };

  if (/^(?:今天.*(?:什么|任务|待办|没完成)|今日任务)$/.test(text)) return { type: "listToday" };
  if (/^(?:任务列表|待办列表|未完成任务|list|tasks)$/i.test(text)) return { type: "listOpen" };

  const complete = text.match(/^(?:完成|搞定|done)\s*(.+)$/i);
  if (complete?.[1]?.trim()) return { type: "complete", query: complete[1].trim() };

  const remove = text.match(/^(?:删除|取消|delete)\s*(.+)$/i);
  if (remove?.[1]?.trim()) return { type: "delete", query: remove[1].trim() };

  const snooze = text.match(/^(?:稍后|过)(\d{1,3})(?:分钟|min|分)(?:提醒)?$/i);
  if (snooze) return { type: "snooze", minutes: clampMinutes(Number(snooze[1])) };

  const offset = parseEarlyOffset(text);
  const cleaned = offset ? text.replace(offset.matchedText, "").replace(/[，,。.\s]+$/, "") : text;
  const parsed = parseTaskInput(cleaned, baseDate);
  if (!parsed.title.trim()) return { type: "unknown", raw: rawText };

  const eventAt = parsed.reminderAt;
  const reminderAt = eventAt && offset ? new Date(new Date(eventAt).getTime() - offset.minutes * 60_000).toISOString() : parsed.reminderAt;

  return {
    type: "createTask",
    title: parsed.title,
    dueDate: parsed.dueDate,
    reminderAt,
    eventAt,
    raw: rawText,
  };
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function parseEarlyOffset(text: string): { minutes: number; matchedText: string } | null {
  const match = text.match(/[，,\s]*(?:提前|早)(\d{1,3})(分钟|分|小时|个小时)(?:提醒)?/);
  if (!match) return null;
  const amount = Number(match[1]);
  const minutes = match[2].includes("小时") ? amount * 60 : amount;
  return { minutes: clampMinutes(minutes), matchedText: match[0] };
}

function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(1440, Math.max(1, Math.round(value)));
}
```

- [ ] **Step 4: Run parser tests**

Run: `npm.cmd test -- src/bot/intent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/bot/intent.ts src/bot/taskText.ts src/bot/intent.test.ts
git commit -m "Add WeChat bot intent parser"
```

## Task 2: Task Matching and Response Formatting

**Files:**
- Create: `src/bot/taskMatcher.ts`
- Create: `src/bot/taskMatcher.test.ts`
- Create: `src/bot/responses.ts`

- [ ] **Step 1: Write failing task matcher tests**

```ts
import { describe, expect, it } from "vitest";
import type { MemoItem } from "../types";
import { findBestOpenTaskMatch } from "./taskMatcher";

const baseItem: MemoItem = {
  id: "11111111-1111-4111-8111-111111111111",
  listId: null,
  title: "复习英语",
  body: "",
  kind: "task",
  status: "open",
  priority: "normal",
  repeatRule: "none",
  dueDate: "2026-06-04",
  reminderAt: null,
  tags: [],
  pinned: false,
  archived: false,
  deletedAt: null,
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z",
};

describe("findBestOpenTaskMatch", () => {
  it("matches by included title text", () => {
    expect(findBestOpenTaskMatch([baseItem], "英语")?.id).toBe(baseItem.id);
  });

  it("ignores done, archived, deleted, and purged tasks", () => {
    const blocked = [
      { ...baseItem, id: "22222222-2222-4222-8222-222222222222", status: "done" as const },
      { ...baseItem, id: "33333333-3333-4333-8333-333333333333", archived: true },
      { ...baseItem, id: "44444444-4444-4444-8444-444444444444", deletedAt: "2026-06-04T00:00:00.000Z" },
      { ...baseItem, id: "55555555-5555-4555-8555-555555555555", status: "purged" as const },
    ];
    expect(findBestOpenTaskMatch(blocked, "英语")).toBeNull();
  });
});
```

- [ ] **Step 2: Run matcher tests to verify failure**

Run: `npm.cmd test -- src/bot/taskMatcher.test.ts`

Expected: FAIL because `taskMatcher.ts` does not exist.

- [ ] **Step 3: Implement matcher and response helpers**

```ts
import type { MemoItem } from "../types";

export function findBestOpenTaskMatch(items: MemoItem[], query: string): MemoItem | null {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return null;

  const candidates = items.filter((item) => {
    return item.kind === "task" && item.status === "open" && !item.archived && !item.deletedAt;
  });

  const exact = candidates.find((item) => normalize(item.title) === normalizedQuery);
  if (exact) return exact;

  return candidates.find((item) => normalize(item.title).includes(normalizedQuery)) ?? null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}
```

```ts
import type { MemoItem } from "../types";

export function formatCreatedTaskReply(item: Pick<MemoItem, "title" | "dueDate" | "reminderAt">): string {
  const lines = [`已记录：${item.title}`];
  if (item.dueDate) lines.push(`日期：${item.dueDate}`);
  if (item.reminderAt) lines.push(`提醒：${formatDateTime(item.reminderAt)}`);
  return lines.join("\n");
}

export function formatTaskListReply(items: MemoItem[], emptyText: string): string {
  if (items.length === 0) return emptyText;
  return items.map((item, index) => `${index + 1}. ${formatTaskLine(item)}`).join("\n");
}

export function formatTaskLine(item: MemoItem): string {
  const when = item.reminderAt ? formatDateTime(item.reminderAt) : item.dueDate ?? "无日期";
  return `${when} ${item.title}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
```

- [ ] **Step 4: Run matcher tests**

Run: `npm.cmd test -- src/bot/taskMatcher.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/bot/taskMatcher.ts src/bot/taskMatcher.test.ts src/bot/responses.ts
git commit -m "Add WeChat bot task matching helpers"
```

## Task 3: Database Schema for Binding and Reminder State

**Files:**
- Modify: `supabase-schema.sql`

- [ ] **Step 1: Add bot tables to schema**

Add these SQL statements after the existing `memo_items` table definition:

```sql
create table if not exists public.bot_bindings (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('clawbot')),
  provider_user_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (provider, provider_user_id),
  unique (provider, user_id)
);

create table if not exists public.bot_binding_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.bot_reminder_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.memo_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('clawbot')),
  provider_user_id text not null,
  reminder_at timestamptz not null,
  sent_at timestamptz,
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  unique (item_id, provider, reminder_at)
);
```

Add indexes and grants near existing index/grant statements:

```sql
create index if not exists bot_bindings_provider_user_idx
on public.bot_bindings (provider, provider_user_id);

create index if not exists bot_binding_codes_user_idx
on public.bot_binding_codes (user_id, expires_at desc);

create index if not exists bot_reminder_events_due_idx
on public.bot_reminder_events (provider, sent_at, reminder_at);

grant select, insert, update, delete on public.bot_bindings to authenticated;
grant select, insert, update, delete on public.bot_binding_codes to authenticated;
grant select, insert, update, delete on public.bot_reminder_events to authenticated;
```

- [ ] **Step 2: Verify schema syntax manually**

Run: `rg -n "bot_bindings|bot_binding_codes|bot_reminder_events" supabase-schema.sql`

Expected: all three table names appear in create table, index, and grant sections.

- [ ] **Step 3: Commit**

```powershell
git add supabase-schema.sql
git commit -m "Add bot binding schema"
```

## Task 4: Serverless Bot Message Endpoint

**Files:**
- Create: `api/_bot/supabaseAdmin.ts`
- Create: `api/_bot/http.ts`
- Create: `api/bot/message.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add server environment docs**

Append to `.env.example`:

```env
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
BOT_WEBHOOK_SECRET=your-shared-clawbot-webhook-secret
CLAWBOT_SEND_MESSAGE_URL=your-clawbot-send-message-url
CLAWBOT_SEND_MESSAGE_TOKEN=your-clawbot-send-message-token
```

- [ ] **Step 2: Create Supabase admin client helper**

```ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing VITE_SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
```

- [ ] **Step 3: Create HTTP validation helpers**

```ts
export type JsonResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export function json(statusCode: number, payload: unknown): JsonResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
}

export function verifyBotSecret(headers: Record<string, string | string[] | undefined>): boolean {
  const expected = process.env.BOT_WEBHOOK_SECRET;
  if (!expected) return false;
  const actual = headers["x-bot-secret"];
  return actual === expected;
}
```

- [ ] **Step 4: Implement message handler**

Create `api/bot/message.ts` as a Vercel Node serverless function. It should:

- accept POST only
- verify `x-bot-secret`
- read `senderId` and `text` from JSON body
- call `parseBotIntent`
- bind accounts with `bot_binding_codes`
- create/query/update `memo_items` filtered by bound `user_id`
- return `{ reply: "..." }`

The first implementation should support a generic ClawBot payload shape:

```ts
type BotMessagePayload = {
  senderId?: string;
  userId?: string;
  from?: string;
  text?: string;
  message?: string;
};
```

- [ ] **Step 5: Run typecheck/build**

Run: `npm.cmd run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add api .env.example
git commit -m "Add ClawBot message endpoint"
```

## Task 5: Reminder Worker Endpoint

**Files:**
- Create: `api/bot/reminders.ts`

- [ ] **Step 1: Implement due reminder scan endpoint**

Create a POST endpoint that:

- verifies `x-bot-secret`
- selects open `memo_items` where `reminder_at <= now`, `status = open`, `deleted_at is null`, and `archived = false`
- joins or separately looks up `bot_bindings`
- skips items already present in `bot_reminder_events` for the same `item_id`, provider, and `reminder_at` with `sent_at` set
- sends message to `CLAWBOT_SEND_MESSAGE_URL` when configured
- inserts or updates `bot_reminder_events.sent_at`
- returns `{ checked, sent, skipped }`

- [ ] **Step 2: Run build**

Run: `npm.cmd run build`

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add api/bot/reminders.ts
git commit -m "Add bot reminder worker"
```

## Task 6: Verification and Setup Notes

**Files:**
- Create: `docs/wechat-clawbot.md`

- [ ] **Step 1: Document setup**

Create a setup guide covering:

- Supabase SQL migration
- Vercel environment variables
- ClawBot webhook URL: `https://<deployment>/api/bot/message`
- reminder worker URL for Supabase Cron: `https://<deployment>/api/bot/reminders`
- required `x-bot-secret` header
- binding flow
- sample test payloads

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
```

Expected: tests PASS and build PASS.

- [ ] **Step 3: Commit**

```powershell
git add docs/wechat-clawbot.md
git commit -m "Document ClawBot setup"
```

## Self-Review

Spec coverage:

- Account binding is covered in Tasks 3 and 4.
- Message commands are covered in Tasks 1, 2, and 4.
- Shared todo storage is covered in Tasks 3 and 4 through `memo_items`.
- Reminder state is covered in Tasks 3 and 5.
- Setup documentation is covered in Task 6.

Placeholder scan:

- No placeholder markers or intentionally vague implementation slots remain. The only external unknown is the exact ClawBot payload/send API shape, so Task 4 accepts a generic inbound shape and Task 6 requires documenting the real configuration once available.

Type consistency:

- Intent types, helper names, and table names are consistent across tasks.
