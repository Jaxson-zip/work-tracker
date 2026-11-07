create extension if not exists pgcrypto;

create table if not exists public.memo_lists (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text not null default '📋',
  archived boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.memo_items (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid,
  title text not null,
  body text not null default '',
  kind text not null check (kind in ('task', 'note')),
  status text not null check (status in ('open', 'done', 'purged')),
  priority text not null check (priority in ('low', 'normal', 'high')),
  repeat_rule text not null default 'none' check (repeat_rule in ('none', 'daily', 'weekly', 'monthly')),
  due_date date,
  reminder_at timestamptz,
  tags text[] not null default '{}',
  pinned boolean not null default false,
  archived boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

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
  attempted_at timestamptz,
  claim_token uuid,
  claim_expires_at timestamptz,
  sent_at timestamptz,
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  unique (item_id, provider, reminder_at)
);

create table if not exists public.bot_ilink_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'ilink' check (provider in ('ilink')),
  user_id uuid not null references auth.users(id) on delete cascade,
  bot_token text not null,
  base_url text not null,
  get_updates_buf text not null default '',
  wechat_uin text not null,
  reply_to_user_id text,
  context_token text,
  context_updated_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'error', 'disabled')),
  last_error text,
  connected_at timestamptz not null default now(),
  last_polled_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (provider, user_id)
);

alter table public.memo_items
add column if not exists list_id uuid;

alter table public.memo_items
add column if not exists reminder_at timestamptz;

alter table public.memo_items
add column if not exists repeat_rule text not null default 'none';

alter table public.memo_lists
add column if not exists deleted_at timestamptz;

alter table public.bot_reminder_events
add column if not exists attempted_at timestamptz;

alter table public.bot_reminder_events
add column if not exists claim_token uuid;

alter table public.bot_reminder_events
add column if not exists claim_expires_at timestamptz;

alter table public.bot_ilink_connections
add column if not exists get_updates_buf text not null default '';

alter table public.bot_ilink_connections
add column if not exists reply_to_user_id text;

alter table public.bot_ilink_connections
add column if not exists context_token text;

alter table public.bot_ilink_connections
add column if not exists context_updated_at timestamptz;

alter table public.bot_ilink_connections
add column if not exists last_error text;

alter table public.bot_ilink_connections
add column if not exists last_polled_at timestamptz;

alter table public.bot_ilink_connections
add column if not exists updated_at timestamptz not null default now();

alter table public.memo_items
drop constraint if exists memo_items_repeat_rule_check;

alter table public.memo_items
add constraint memo_items_repeat_rule_check check (repeat_rule in ('none', 'daily', 'weekly', 'monthly'));

alter table public.memo_items
drop constraint if exists memo_items_status_check;

alter table public.memo_items
add constraint memo_items_status_check check (status in ('open', 'done', 'purged'));

alter table public.bot_reminder_events
drop constraint if exists bot_reminder_events_provider_check;

alter table public.bot_reminder_events
add constraint bot_reminder_events_provider_check check (provider in ('clawbot', 'ilink'));

alter table public.bot_ilink_connections
drop constraint if exists bot_ilink_connections_status_check;

alter table public.bot_ilink_connections
add constraint bot_ilink_connections_status_check check (status in ('connected', 'error', 'disabled'));

alter table public.memo_items enable row level security;
alter table public.memo_lists enable row level security;
alter table public.bot_bindings enable row level security;
alter table public.bot_binding_codes enable row level security;
alter table public.bot_reminder_events enable row level security;
alter table public.bot_ilink_connections enable row level security;

drop policy if exists "Users can read their own memo lists" on public.memo_lists;
create policy "Users can read their own memo lists"
on public.memo_lists for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own memo lists" on public.memo_lists;
create policy "Users can insert their own memo lists"
on public.memo_lists for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own memo lists" on public.memo_lists;
create policy "Users can update their own memo lists"
on public.memo_lists for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own memo lists" on public.memo_lists;
create policy "Users can delete their own memo lists"
on public.memo_lists for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read their own memo items" on public.memo_items;
create policy "Users can read their own memo items"
on public.memo_items for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own memo items" on public.memo_items;
create policy "Users can insert their own memo items"
on public.memo_items for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own memo items" on public.memo_items;
create policy "Users can update their own memo items"
on public.memo_items for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own memo items" on public.memo_items;
create policy "Users can delete their own memo items"
on public.memo_items for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read their own bot bindings" on public.bot_bindings;
create policy "Users can read their own bot bindings"
on public.bot_bindings for select
using (auth.uid() = user_id);

drop policy if exists "Users can read their own bot binding codes" on public.bot_binding_codes;
create policy "Users can read their own bot binding codes"
on public.bot_binding_codes for select
using (auth.uid() = user_id);

drop policy if exists "Users can read their own bot reminder events" on public.bot_reminder_events;
create policy "Users can read their own bot reminder events"
on public.bot_reminder_events for select
using (auth.uid() = user_id);

create or replace function public.consume_bot_binding_code(
  p_provider text,
  p_provider_user_id text,
  p_code text
)
returns table (result text, bound_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  if p_provider <> 'clawbot' then
    result := 'invalid';
    bound_user_id := null;
    return next;
    return;
  end if;

  select user_id
  into target_user_id
  from public.bot_binding_codes
  where code = upper(p_code)
    and used_at is null
    and expires_at > now()
  for update;

  if target_user_id is null then
    result := 'invalid';
    bound_user_id := null;
    return next;
    return;
  end if;

  delete from public.bot_bindings
  where provider = p_provider
    and (provider_user_id = p_provider_user_id or user_id = target_user_id);

  insert into public.bot_bindings (provider, provider_user_id, user_id)
  values (p_provider, p_provider_user_id, target_user_id);

  update public.bot_binding_codes
  set used_at = now()
  where code = upper(p_code);

  result := 'bound';
  bound_user_id := target_user_id;
  return next;
end;
$$;

revoke all on function public.consume_bot_binding_code(text, text, text) from public;
grant execute on function public.consume_bot_binding_code(text, text, text) to service_role;

create index if not exists memo_items_user_updated_idx
on public.memo_items (user_id, updated_at desc);

create index if not exists memo_lists_user_updated_idx
on public.memo_lists (user_id, updated_at desc);

create index if not exists memo_items_due_reminder_idx
on public.memo_items (reminder_at)
where kind = 'task'
  and status = 'open'
  and archived = false
  and deleted_at is null
  and reminder_at is not null;

create index if not exists bot_bindings_provider_user_idx
on public.bot_bindings (provider, provider_user_id);

create index if not exists bot_binding_codes_user_idx
on public.bot_binding_codes (user_id, expires_at desc);

create index if not exists bot_reminder_events_due_idx
on public.bot_reminder_events (provider, sent_at, reminder_at);

create index if not exists bot_ilink_connections_status_poll_idx
on public.bot_ilink_connections (status, last_polled_at);

create index if not exists bot_ilink_connections_user_idx
on public.bot_ilink_connections (user_id);

grant usage on schema public to authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on public.memo_items to authenticated;
grant select, insert, update, delete on public.memo_lists to authenticated;
grant select, insert, update, delete on public.bot_bindings to authenticated;
grant select, insert, update, delete on public.bot_binding_codes to authenticated;
grant select, insert, update, delete on public.bot_reminder_events to authenticated;
grant select, insert, update, delete on public.bot_ilink_connections to service_role;
revoke all on public.bot_ilink_connections from authenticated;
