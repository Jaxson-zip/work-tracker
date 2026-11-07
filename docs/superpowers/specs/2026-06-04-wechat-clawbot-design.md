# WeChat ClawBot Todo Assistant Design

## Goal

Build a WeChat-facing assistant for the existing todo app. A user can scan a ClawBot QR code, bind their WeChat identity to their todo account, send natural-language todo messages, query unfinished tasks, mark tasks done, and receive due reminders.

## Product Shape

The website remains the visual task manager. WeChat becomes the fast capture and reminder surface.

Supported first-version conversations:

- `bind TD-839201`: bind the sender's ClawBot user id to a Supabase auth user.
- `tomorrow 10am submit homework, remind me 30 minutes early`: create a task with `due_date` and `reminder_at`.
- `today tasks`: list open tasks for today.
- `task list`: list open tasks sorted by reminder date, due date, and update time.
- `done homework`: mark the closest matching open task done.
- `delete homework`: soft-delete the closest matching open task.
- `remind me later 10 minutes`: reschedule the most recent reminder for that WeChat user.

Chinese commands must be supported in implementation. The English examples above are canonical meanings, not user-facing copy.

## Architecture

ClawBot posts every incoming WeChat message to one serverless endpoint:

```text
ClawBot / WeChat
  -> /api/bot/message
  -> Supabase service client
  -> memo_items / bot_bindings / reminder delivery state
```

The endpoint is stateless. Account identity comes from a binding table that maps the ClawBot sender id to the Supabase `auth.users.id`.

Active reminders are handled outside Vercel Cron because Vercel Hobby cron is not suitable for minute-level reminders. Supabase Cron should call a reminder endpoint or Edge Function every minute:

```text
Supabase Cron
  -> reminder worker
  -> due memo_items with unsent reminder state
  -> ClawBot send-message API
  -> mark reminder as sent or rescheduled
```

## Data Model

Existing `memo_items` remains the source of truth for todo content. Bot-created tasks use the same fields as app-created tasks:

- `kind = 'task'`
- `status = 'open'`
- `priority = 'normal'` unless the command explicitly says urgent/high priority
- `repeat_rule = 'none'` for first version
- `due_date` from parsed event date
- `reminder_at` from parsed reminder date
- `tags = ['wechat']` to make source visible without adding a column

New tables:

```sql
create table public.bot_bindings (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('clawbot')),
  provider_user_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (provider, provider_user_id),
  unique (provider, user_id)
);

create table public.bot_binding_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.bot_reminder_events (
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

RLS stays enabled for app-owned tables. Serverless bot endpoints use the Supabase service role key and must never expose it to the browser.

## Message Handling

`/api/bot/message` performs these steps:

1. Verify the request came from ClawBot using a shared secret or ClawBot signature.
2. Normalize sender id and text from the ClawBot payload.
3. If the command starts with binding intent, validate the binding code and create/update `bot_bindings`.
4. For every other command, require an existing binding. If missing, reply with instructions to bind the account first.
5. Route the message by intent:
   - binding
   - create task
   - list today tasks
   - list open tasks
   - complete task
   - delete task
   - snooze reminder
6. Return a short text response for ClawBot to send back to WeChat.

Natural-language parsing should reuse the current `parseTaskInput` logic where possible, but bot-specific parsing needs a small wrapper for:

- "提前/early" offset parsing
- "今天有什么/任务列表/完成/删除/稍后" intent detection
- choosing the task title after removing command words

## Reminder Handling

The reminder worker scans open tasks with `reminder_at <= now()` and no sent event for the same item/reminder time. For each due task:

1. Find the user's ClawBot binding.
2. Send a reminder through ClawBot.
3. Insert or update `bot_reminder_events.sent_at`.

When the user replies `稍后10分钟提醒`, the message endpoint updates the most recent due reminder's item `reminder_at` and clears or replaces the reminder event so the task can notify again.

## Account Binding UX

The app should eventually show a "Bind WeChat" button that creates a short-lived binding code. For the first implementation, a minimal API can generate a code for the currently authenticated user, and a small UI can be added later if needed.

Binding flow:

```text
User logs into website
Website generates code TD-839201
User sends "绑定 TD-839201" to ClawBot
Bot endpoint stores ClawBot sender id -> Supabase user_id
Future messages read/write that user's tasks
```

## Security

- Service role key lives only in serverless/Edge runtime environment variables.
- Bot endpoints reject missing or invalid shared secret/signature.
- Binding codes expire after 10 minutes and can be used once.
- The bot never accepts a user id from the message text.
- Task queries always filter by the bound `user_id`.

## Testing

Unit tests should cover:

- intent detection for create/list/today/done/delete/bind/snooze commands
- early-reminder offset parsing
- task creation payload shape
- fuzzy task matching rules
- unbound user response
- binding code expiration behavior

Manual verification should cover:

- create a task through the bot API and confirm it appears after app sync
- query today's tasks through the bot API
- mark a task done through the bot API
- simulate a due reminder and confirm the worker marks it sent

