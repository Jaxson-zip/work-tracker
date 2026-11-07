-- 浏览器只能调用 wt_command，所有表都不直接开放读写。
-- 谁能看到哪些待办的规则因此只有一处：wt_visible_tasks。
revoke create on schema public from public,anon,authenticated,service_role;

create table public.wt_profiles (
  id uuid primary key references auth.users(id),
  display_name text not null check (length(display_name) between 1 and 80)
);
-- 手机号只用于群消息 @，不返回给其他成员。
create table public.wt_contacts (
  user_id uuid primary key references public.wt_profiles(id),
  mobile text not null check (mobile ~ '^1[0-9]{10}$')
);
create table public.wt_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.wt_members (
  workspace_id uuid not null references public.wt_workspaces(id),
  user_id uuid not null references public.wt_profiles(id),
  role text not null check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create unique index wt_one_owner on public.wt_members(workspace_id) where role='owner';
create table public.wt_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.wt_workspaces(id),
  code text not null unique default replace(gen_random_uuid()::text,'-',''),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now()+interval '7 days',
  used_at timestamptz,
  used_by uuid references auth.users(id)
);
create table public.wt_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.wt_workspaces(id),
  title text not null check (length(title) between 1 and 160),
  owner_id uuid not null references auth.users(id),
  created_by uuid not null references auth.users(id),
  status text not null default 'open' check (status in ('open','done')),
  due_date date,
  version integer not null default 1,
  -- 交接：对方接手前，事情仍然算在原来的人手上。
  pending_owner_id uuid references auth.users(id),
  handoff_by uuid references auth.users(id),
  handoff_note text not null default '' check (length(handoff_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index wt_tasks_workspace on public.wt_tasks(workspace_id);
-- 同一事务里的多条经过时间相同，先后顺序靠 seq。
create table public.wt_activities (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  workspace_id uuid not null references public.wt_workspaces(id),
  task_id uuid not null references public.wt_tasks(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('created','handoff','accepted','rejected','withdrawn','done','reopened','edited')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index wt_activities_task on public.wt_activities(task_id,seq);
create table public.wt_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.wt_workspaces(id),
  payload jsonb not null,
  dedupe_key text unique,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  claim_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index wt_outbox_pending on public.wt_outbox(status,available_at);

alter table public.wt_profiles enable row level security;
alter table public.wt_contacts enable row level security;
alter table public.wt_workspaces enable row level security;
alter table public.wt_members enable row level security;
alter table public.wt_invites enable row level security;
alter table public.wt_tasks enable row level security;
alter table public.wt_activities enable row level security;
alter table public.wt_outbox enable row level security;
revoke all on public.wt_profiles,public.wt_contacts,public.wt_workspaces,public.wt_members,public.wt_invites,public.wt_tasks,public.wt_activities,public.wt_outbox from public,anon,authenticated,service_role;

create function public.wt_text(p jsonb,k text,max_len integer,required boolean default false) returns text
language plpgsql immutable set search_path=pg_catalog,public as $$
declare v text;
begin
  if p ? k and jsonb_typeof(p->k) not in ('string','null') then raise exception 'Invalid %',k; end if;
  v:=btrim(coalesce(p->>k,''));
  if length(v)>max_len or (required and v='') then raise exception 'Invalid %',k; end if;
  return v;
end $$;
create function public.wt_date(p jsonb,k text) returns date
language plpgsql immutable set search_path=pg_catalog,public as $$
declare v text:=public.wt_text(p,k,10);
begin
  if v='' then return null; end if;
  if v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid %',k; end if;
  return v::date;
end $$;
revoke all on function public.wt_text(jsonb,text,integer,boolean),public.wt_date(jsonb,text) from public,anon,authenticated,service_role;
