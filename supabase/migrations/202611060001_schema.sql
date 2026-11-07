-- All writes cross an authenticated, transactional RPC boundary. Never expose
-- service_role credentials to browsers. Public tables are read-only under RLS.
revoke create on schema public from public,anon,authenticated,service_role;

create table public.wt_profiles (
  id uuid primary key references auth.users(id),
  display_name text not null check (length(display_name) between 1 and 80)
);
-- 手机号只用于群消息 @，同事不能读取，所以单独成表且不授予任何读权限。
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
  department text not null default '' check (length(department) <= 40),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create unique index wt_one_owner on public.wt_members(workspace_id) where role='owner';
create table public.wt_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.wt_workspaces(id),
  code text not null unique default replace(gen_random_uuid()::text,'-',''),
  role text not null check (role in ('admin','member')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now()+interval '7 days',
  used_at timestamptz,
  used_by uuid references auth.users(id)
);
create table public.wt_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.wt_workspaces(id),
  title text not null check (length(title) between 1 and 160),
  body text not null default '' check (length(body) <= 10000),
  occurred_on date not null,
  important boolean not null default false,
  created_by uuid not null references auth.users(id),
  source text not null default 'manual' check (source in ('manual','feishu')),
  task_id uuid,
  created_at timestamptz not null default now()
);
create table public.wt_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.wt_workspaces(id),
  title text not null check (length(title) between 1 and 160),
  body text not null default '' check (length(body) <= 10000),
  owner_id uuid not null references auth.users(id),
  created_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','in_progress','blocked','review','done','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  due_date date,
  follow_up_date date,
  next_action text not null default '' check (length(next_action) <= 1000),
  version integer not null default 1,
  source_record_id uuid unique references public.wt_records(id),
  -- 转交：接收方确认前，负责人不变。
  pending_owner_id uuid references auth.users(id),
  handoff_by uuid references auth.users(id),
  handoff_note text not null default '' check (length(handoff_note) <= 1000),
  -- 退回：提醒发起人和负责人，有人处理后清除。
  returned_to uuid references auth.users(id),
  returned_by uuid references auth.users(id),
  returned_note text not null default '' check (length(returned_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.wt_records add foreign key (task_id) references public.wt_tasks(id);
create index wt_tasks_workspace on public.wt_tasks(workspace_id);
create index wt_tasks_pending_owner on public.wt_tasks(pending_owner_id) where pending_owner_id is not null;
create index wt_records_workspace on public.wt_records(workspace_id);
create table public.wt_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.wt_workspaces(id),
  task_id uuid not null references public.wt_tasks(id),
  actor_id uuid not null references auth.users(id),
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index wt_activities_workspace on public.wt_activities(workspace_id,created_at);
create table public.wt_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.wt_workspaces(id),
  task_id uuid references public.wt_tasks(id),
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
create table public.wt_feishu_codes (
  code text primary key default 'WT-' || replace(gen_random_uuid()::text,'-',''),
  workspace_id uuid not null references public.wt_workspaces(id),
  user_id uuid not null references auth.users(id),
  expires_at timestamptz not null default now()+interval '10 minutes',
  used_at timestamptz
);
create table public.wt_feishu_bindings (
  open_id text primary key,
  workspace_id uuid not null references public.wt_workspaces(id),
  user_id uuid not null references auth.users(id),
  unique (workspace_id,user_id)
);
create table public.wt_feishu_events (
  event_id text primary key,
  open_id text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create function public.wt_is_member(p_workspace uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.wt_members where workspace_id=p_workspace and user_id=auth.uid())
$$;
create function public.wt_is_admin(p_workspace uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.wt_members where workspace_id=p_workspace and user_id=auth.uid() and role in ('owner','admin'))
$$;
revoke all on function public.wt_is_member(uuid),public.wt_is_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.wt_is_member(uuid),public.wt_is_admin(uuid) to authenticated;

alter table public.wt_profiles enable row level security;
create policy wt_profiles_read on public.wt_profiles for select to authenticated using (
  id=auth.uid() or exists(select 1 from public.wt_members m where m.user_id=id and public.wt_is_member(m.workspace_id))
);
alter table public.wt_contacts enable row level security;
alter table public.wt_workspaces enable row level security;
create policy wt_workspaces_read on public.wt_workspaces for select to authenticated using (public.wt_is_member(id));
alter table public.wt_members enable row level security;
create policy wt_members_read on public.wt_members for select to authenticated using (public.wt_is_member(workspace_id));
alter table public.wt_invites enable row level security;
create policy wt_invites_read on public.wt_invites for select to authenticated using (public.wt_is_admin(workspace_id));
alter table public.wt_records enable row level security;
create policy wt_records_read on public.wt_records for select to authenticated using (public.wt_is_member(workspace_id));
alter table public.wt_tasks enable row level security;
create policy wt_tasks_read on public.wt_tasks for select to authenticated using (public.wt_is_member(workspace_id));
alter table public.wt_activities enable row level security;
create policy wt_activities_read on public.wt_activities for select to authenticated using (public.wt_is_member(workspace_id));
alter table public.wt_outbox enable row level security;
alter table public.wt_feishu_codes enable row level security;
alter table public.wt_feishu_bindings enable row level security;
alter table public.wt_feishu_events enable row level security;
revoke all on public.wt_profiles,public.wt_contacts,public.wt_workspaces,public.wt_members,public.wt_invites,public.wt_records,public.wt_tasks,public.wt_activities,public.wt_outbox,public.wt_feishu_codes,public.wt_feishu_bindings,public.wt_feishu_events from public,anon,authenticated,service_role;
grant select on public.wt_profiles,public.wt_workspaces,public.wt_members,public.wt_invites,public.wt_records,public.wt_tasks,public.wt_activities to authenticated;

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
