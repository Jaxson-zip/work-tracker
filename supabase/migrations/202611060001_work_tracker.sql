-- All writes cross an authenticated, transactional RPC boundary. Never expose
-- service_role credentials to browsers. Public tables are read-only under RLS.
revoke create on schema public from public,anon,authenticated,service_role;

create table public.wt_profiles (
  id uuid primary key references auth.users(id),
  display_name text not null check (length(display_name) between 1 and 80)
);
create table public.wt_workspaces (
  id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 1 and 80),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.wt_members (
  workspace_id uuid not null references public.wt_workspaces(id), user_id uuid not null references public.wt_profiles(id),
  role text not null check (role in ('owner','admin','member')), created_at timestamptz not null default now(),
  primary key(workspace_id,user_id)
);
create unique index wt_one_owner on public.wt_members(workspace_id) where role='owner';
create table public.wt_invites (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.wt_workspaces(id),
  code text not null unique default replace(gen_random_uuid()::text,'-',''),
  role text not null check(role in ('admin','member')), created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now()+interval '7 days', used_at timestamptz, used_by uuid references auth.users(id)
);
create table public.wt_records (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.wt_workspaces(id),
  title text not null check(length(title) between 1 and 160), body text not null default '' check(length(body)<=10000),
  occurred_on date not null, important boolean not null default false, created_by uuid not null references auth.users(id),
  source text not null default 'manual' check(source in ('manual','feishu')), task_id uuid,
  created_at timestamptz not null default now()
);
create table public.wt_tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.wt_workspaces(id),
  title text not null check(length(title) between 1 and 160), body text not null default '' check(length(body)<=10000),
  owner_id uuid not null references auth.users(id), created_by uuid not null references auth.users(id),
  status text not null default 'pending' check(status in ('pending','in_progress','blocked','review','done')),
  priority text not null default 'normal' check(priority in ('low','normal','high')), due_date date, follow_up_date date,
  next_action text not null default '' check(length(next_action)<=1000), version integer not null default 1,
  source_record_id uuid unique references public.wt_records(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.wt_records add foreign key(task_id) references public.wt_tasks(id);
create index wt_tasks_workspace on public.wt_tasks(workspace_id);
create index wt_records_workspace on public.wt_records(workspace_id);
create table public.wt_activities (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.wt_workspaces(id),
  task_id uuid not null references public.wt_tasks(id), actor_id uuid not null references auth.users(id),
  action text not null, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create index wt_activities_workspace on public.wt_activities(workspace_id,created_at);
create table public.wt_outbox (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.wt_workspaces(id),
  task_id uuid references public.wt_tasks(id), recipient_id uuid references auth.users(id),
  payload jsonb not null, dedupe_key text unique, status text not null default 'pending' check(status in ('pending','processing','sent','failed','cancelled')),
  attempts integer not null default 0, available_at timestamptz not null default now(), claim_token uuid, lease_until timestamptz,
  last_error text, created_at timestamptz not null default now(), sent_at timestamptz
);
create index wt_outbox_pending on public.wt_outbox(status,available_at);
create table public.wt_feishu_codes (
  code text primary key default replace(gen_random_uuid()::text,'-',''), workspace_id uuid not null references public.wt_workspaces(id),
  user_id uuid not null references auth.users(id), expires_at timestamptz not null default now()+interval '10 minutes', used_at timestamptz
);
create table public.wt_feishu_bindings (
  open_id text primary key, workspace_id uuid not null references public.wt_workspaces(id), user_id uuid not null references auth.users(id),
  unique(workspace_id,user_id)
);
create table public.wt_feishu_events (
  event_id text primary key, open_id text not null, result jsonb not null, created_at timestamptz not null default now()
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
alter table public.wt_workspaces enable row level security;
create policy wt_workspaces_read on public.wt_workspaces for select to authenticated using(public.wt_is_member(id));
alter table public.wt_members enable row level security;
create policy wt_members_read on public.wt_members for select to authenticated using(public.wt_is_member(workspace_id));
alter table public.wt_invites enable row level security;
create policy wt_invites_read on public.wt_invites for select to authenticated using(public.wt_is_admin(workspace_id));
alter table public.wt_records enable row level security;
create policy wt_records_read on public.wt_records for select to authenticated using(public.wt_is_member(workspace_id));
alter table public.wt_tasks enable row level security;
create policy wt_tasks_read on public.wt_tasks for select to authenticated using(public.wt_is_member(workspace_id));
alter table public.wt_activities enable row level security;
create policy wt_activities_read on public.wt_activities for select to authenticated using(public.wt_is_member(workspace_id));
alter table public.wt_outbox enable row level security;
alter table public.wt_feishu_codes enable row level security;
alter table public.wt_feishu_bindings enable row level security;
alter table public.wt_feishu_events enable row level security;
revoke all on public.wt_profiles,public.wt_workspaces,public.wt_members,public.wt_invites,public.wt_records,public.wt_tasks,public.wt_activities,public.wt_outbox,public.wt_feishu_codes,public.wt_feishu_bindings,public.wt_feishu_events from public,anon,authenticated,service_role;
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

create function public.wt_task_payload(t public.wt_tasks,p_action text) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
  select jsonb_build_object('title',t.title,'message',
    case p_action when 'created' then '任务已创建' when 'updated' then '任务已更新' when 'transition' then '状态已变更'
      when 'transfer' then '负责人已转交' when 'comment' then '新增任务评论' when 'overdue' then '任务已逾期'
      when 'followup' then '任务待跟进' else '任务动态' end ||
    '｜负责人：' || coalesce((select display_name from public.wt_profiles where id=t.owner_id),'用户') ||
    '｜状态：' || case t.status when 'pending' then '待接单' when 'in_progress' then '进行中' when 'blocked' then '受阻'
      when 'review' then '待验收' when 'done' then '已完成' end || '｜截止：' || coalesce(t.due_date::text,'未设置') ||
    '｜跟进：' || coalesce(t.follow_up_date::text,'未设置') || '｜下一步：' || t.next_action)
$$;
create function public.wt_emit(t public.wt_tasks,p_actor uuid,p_action text,p_detail jsonb default '{}') returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
  insert into public.wt_activities(workspace_id,task_id,actor_id,action,detail) values(t.workspace_id,t.id,p_actor,p_action,p_detail);
  insert into public.wt_outbox(workspace_id,task_id,recipient_id,payload)
    values(t.workspace_id,t.id,t.owner_id,public.wt_task_payload(t,p_action));
end $$;
create function public.wt_insert_task(p_workspace uuid,p_actor uuid,p jsonb,p_record uuid default null) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare t public.wt_tasks%rowtype; v_owner uuid:=(p->>'ownerId')::uuid; v_priority text:=coalesce(p->>'priority','normal');
begin
  if not exists(select 1 from public.wt_members where workspace_id=p_workspace and user_id=v_owner) then raise exception 'Owner must be an active workspace member'; end if;
  if v_priority not in ('low','normal','high') then raise exception 'Invalid priority'; end if;
  insert into public.wt_tasks(workspace_id,title,body,owner_id,created_by,priority,due_date,follow_up_date,next_action,source_record_id)
    values(p_workspace,public.wt_text(p,'title',160,true),public.wt_text(p,'body',10000),v_owner,p_actor,v_priority,
      public.wt_date(p,'dueDate'),public.wt_date(p,'followUpDate'),public.wt_text(p,'nextAction',1000),p_record) returning * into t;
  perform public.wt_emit(t,p_actor,'created',jsonb_build_object('source_record_id',p_record));
  return to_jsonb(t);
end $$;
revoke all on function public.wt_task_payload(public.wt_tasks,text),public.wt_emit(public.wt_tasks,uuid,text,jsonb),public.wt_insert_task(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

create function public.wt_insert_record(p_workspace uuid,p_actor uuid,p jsonb,p_source text default 'manual') returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare a public.wt_records%rowtype; v_date date:=public.wt_date(p,'occurredOn');
begin
  if v_date is null then raise exception 'occurredOn required'; end if;
  if p ? 'important' and jsonb_typeof(p->'important')<>'boolean' then raise exception 'Invalid important'; end if;
  insert into public.wt_records(workspace_id,title,body,occurred_on,important,created_by,source)
    values(p_workspace,public.wt_text(p,'title',160,true),public.wt_text(p,'body',10000),v_date,coalesce((p->>'important')::boolean,false),p_actor,p_source)
    returning * into a;
  return to_jsonb(a);
end $$;
revoke all on function public.wt_insert_record(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

create function public.wt_command(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  u uuid:=auth.uid(); w uuid; r text; result jsonb; v_name text;
  inv public.wt_invites%rowtype; target uuid; target_role text; new_role text;
  t public.wt_tasks%rowtype; old_status text; new_status text; v_reason text; v_version integer; old_owner uuid;
  a public.wt_records%rowtype;
  binding_code public.wt_feishu_codes%rowtype;
begin
  if u is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid payload'; end if;
  insert into public.wt_profiles(id,display_name)
    select id,left(coalesce(nullif(split_part(email,'@',1),''),'User'),80) from auth.users where id=u
    on conflict(id) do nothing;
  if not exists(select 1 from public.wt_profiles where id=u) then raise exception 'Unknown user'; end if;
  if p_action='create_workspace' then
    v_name:=public.wt_text(p_payload,'name',80,true);
    insert into public.wt_workspaces(name,created_by) values(v_name,u) returning id into w;
    insert into public.wt_members(workspace_id,user_id,role) values(w,u,'owner');
    return (select to_jsonb(x) from public.wt_workspaces x where id=w);
  elsif p_action='update_profile' then
    update public.wt_profiles set display_name=public.wt_text(p_payload,'displayName',80,true) where id=u;
    return (select to_jsonb(x) from public.wt_profiles x where id=u);
  elsif p_action='join_workspace' then
    select * into inv from public.wt_invites where code=public.wt_text(p_payload,'code',100,true) for update;
    if inv.id is null or inv.used_at is not null or inv.expires_at<=now() then raise exception 'Invalid or expired invite'; end if;
    perform 1 from public.wt_workspaces where id=inv.workspace_id for update;
    if exists(select 1 from public.wt_members where workspace_id=inv.workspace_id and user_id=u) then raise exception 'Already a member'; end if;
    insert into public.wt_members(workspace_id,user_id,role) values(inv.workspace_id,u,inv.role);
    update public.wt_invites set used_at=now(),used_by=u where id=inv.id;
    return (select to_jsonb(x) from public.wt_workspaces x where id=inv.workspace_id);
  end if;
  w:=nullif(p_payload->>'workspaceId','')::uuid;
  if p_action='snapshot' then
    if w is null then select workspace_id into w from public.wt_members where user_id=u order by created_at,workspace_id limit 1; end if;
    if w is not null and not public.wt_is_member(w) then raise exception 'Forbidden workspace'; end if;
    select role into r from public.wt_members where workspace_id=w and user_id=u;
    return jsonb_build_object(
      'selected_workspace_id',w,
      'workspaces',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.wt_workspaces x join public.wt_members m on m.workspace_id=x.id where m.user_id=u),'[]'::jsonb),
      'members',coalesce((select jsonb_agg(to_jsonb(x)) from (select m.workspace_id,m.user_id,m.role,p.display_name from public.wt_members m join public.wt_profiles p on p.id=m.user_id where m.workspace_id=w) x),'[]'::jsonb),
      'tasks',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.wt_tasks x where workspace_id=w),'[]'::jsonb),
      'records',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.wt_records x where workspace_id=w),'[]'::jsonb),
      'activities',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.wt_activities x where workspace_id=w),'[]'::jsonb),
      'invites',case when r in ('owner','admin') then coalesce((select jsonb_agg(to_jsonb(x)) from (select id,code,role,expires_at,used_at from public.wt_invites where workspace_id=w) x),'[]'::jsonb) else '[]'::jsonb end,
      'outbox',case when r in ('owner','admin') then coalesce((select jsonb_agg(to_jsonb(x)) from (select id,status,last_error,created_at from public.wt_outbox where workspace_id=w) x),'[]'::jsonb) else '[]'::jsonb end,
      'profile',(select to_jsonb(x) from public.wt_profiles x where id=u),
      'feishu_bound',exists(select 1 from public.wt_feishu_bindings where workspace_id=w and user_id=u)
    );
  end if;
  -- Serialize authorization changes against writes in the same workspace.
  perform 1 from public.wt_workspaces where id=w for update;
  select role into r from public.wt_members where workspace_id=w and user_id=u;
  if r is null then raise exception 'Forbidden workspace'; end if;
  if p_action='invite' then
    new_role:=public.wt_text(p_payload,'role',10,true);
    if r not in ('owner','admin') or (new_role='admin' and r<>'owner') then raise exception 'Forbidden invite role'; end if;
    if new_role not in ('admin','member') then raise exception 'Invalid role'; end if;
    insert into public.wt_invites(workspace_id,role,created_by) values(w,new_role,u) returning * into inv;
    return to_jsonb(inv);
  elsif p_action='update_member' then
    target:=(p_payload->>'userId')::uuid;
    select role into target_role from public.wt_members where workspace_id=w and user_id=target;
    if target_role is null then raise exception 'Member not found'; end if;
    if target_role='owner' then raise exception 'Workspace owner is protected'; end if;
    new_role:=p_payload->>'role';
    if not (p_payload ? 'role') or (new_role is not null and new_role not in ('admin','member')) then raise exception 'Invalid role'; end if;
    if r='member' or (r='admin' and (target_role='admin' or new_role='admin')) then raise exception 'Forbidden member change'; end if;
    if new_role is null then
      if exists(select 1 from public.wt_tasks where workspace_id=w and owner_id=target and status<>'done') then raise exception 'Reassign open tasks before removing member'; end if;
      delete from public.wt_members where workspace_id=w and user_id=target;
      delete from public.wt_feishu_bindings where workspace_id=w and user_id=target;
      delete from public.wt_feishu_codes where workspace_id=w and user_id=target;
    else
      update public.wt_members set role=new_role where workspace_id=w and user_id=target;
    end if;
    return jsonb_build_object('ok',true);
  elsif p_action='create_feishu_binding' then
    delete from public.wt_feishu_codes where workspace_id=w and user_id=u;
    insert into public.wt_feishu_codes(workspace_id,user_id) values(w,u) returning * into binding_code;
    return jsonb_build_object('code',binding_code.code,'expires_at',binding_code.expires_at);
  elsif p_action='disconnect_feishu' then
    delete from public.wt_feishu_codes where workspace_id=w and user_id=u;
    delete from public.wt_feishu_bindings where workspace_id=w and user_id=u;
    return jsonb_build_object('ok',true);
  elsif p_action='retry_notification' then
    if r not in ('owner','admin') then raise exception 'Forbidden notification retry'; end if;
    update public.wt_outbox set status='pending',attempts=0,available_at=now(),claim_token=null,lease_until=null,last_error=null
      where workspace_id=w and id=(p_payload->>'notificationId')::uuid and status='failed';
    if not found then raise exception 'Failed notification not found'; end if;
    return jsonb_build_object('ok',true);
  elsif p_action='create_task' then
    return public.wt_insert_task(w,u,p_payload);
  elsif p_action='create_record' then
    return public.wt_insert_record(w,u,p_payload);
  elsif p_action='record_to_task' then
    select * into a from public.wt_records where workspace_id=w and id=(p_payload->>'recordId')::uuid for update;
    if a.id is null then raise exception 'Record not found'; end if;
    if a.task_id is not null then raise exception 'Record already converted'; end if;
    result:=public.wt_insert_task(w,u,p_payload || jsonb_build_object('title',a.title,'body',a.body),a.id);
    update public.wt_records set task_id=(result->>'id')::uuid where id=a.id;
    return result;
  elsif p_action in ('update_task','transition_task','transfer_task','comment_task') then
    select * into t from public.wt_tasks where workspace_id=w and id=(p_payload->>'taskId')::uuid for update;
    if t.id is null then raise exception 'Task not found'; end if;
    if p_action='comment_task' then
      perform public.wt_emit(t,u,'comment',jsonb_build_object('comment',public.wt_text(p_payload,'comment',2000,true)));
      return to_jsonb(t);
    end if;
    if jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion') !~ '^[1-9][0-9]*$' then raise exception 'Expected version required'; end if;
    v_version:=(p_payload->>'expectedVersion')::integer;
    if t.version<>v_version then raise exception 'Version conflict'; end if;
    if p_action='update_task' then
      if u not in (t.owner_id,t.created_by) and r not in ('owner','admin') then raise exception 'Forbidden task edit'; end if;
      if p_payload ? 'title' then t.title:=public.wt_text(p_payload,'title',160,true); end if;
      if p_payload ? 'body' then t.body:=public.wt_text(p_payload,'body',10000); end if;
      if p_payload ? 'priority' then
        t.priority:=public.wt_text(p_payload,'priority',10,true);
        if t.priority not in ('low','normal','high') then raise exception 'Invalid priority'; end if;
      end if;
      if p_payload ? 'dueDate' then t.due_date:=public.wt_date(p_payload,'dueDate'); end if;
      if p_payload ? 'followUpDate' then t.follow_up_date:=public.wt_date(p_payload,'followUpDate'); end if;
      if p_payload ? 'nextAction' then t.next_action:=public.wt_text(p_payload,'nextAction',1000); end if;
      result:=jsonb_build_object('fields',p_payload-'workspaceId'-'taskId'-'expectedVersion');
    elsif p_action='transition_task' then
      old_status:=t.status; new_status:=public.wt_text(p_payload,'status',20,true);
      v_reason:=public.wt_text(p_payload,'reason',1000);
      if new_status='blocked' and v_reason='' then raise exception 'Reason required'; end if;
      if (old_status='pending' and new_status='in_progress') or
         (old_status='in_progress' and new_status in ('review','blocked')) or
         (old_status='blocked' and new_status='in_progress') then
        if u<>t.owner_id and r not in ('owner','admin') then raise exception 'Forbidden transition'; end if;
      elsif (old_status='review' and new_status in ('done','in_progress')) or (old_status='done' and new_status='in_progress') then
        if u<>t.created_by and r not in ('owner','admin') then raise exception 'Forbidden review'; end if;
        if new_status='in_progress' and v_reason='' then raise exception 'Reason required'; end if;
      else raise exception 'Invalid transition'; end if;
      if new_status<>'done' and not exists(select 1 from public.wt_members where workspace_id=w and user_id=t.owner_id) then
        raise exception 'Reassign to an active member before reopening task';
      end if;
      t.status:=new_status;
      result:=jsonb_build_object('from',old_status,'to',new_status,'reason',v_reason);
    else
      if u not in (t.owner_id,t.created_by) and r not in ('owner','admin') then raise exception 'Forbidden transfer'; end if;
      v_reason:=public.wt_text(p_payload,'reason',1000,true);
      target:=(p_payload->>'ownerId')::uuid;
      if not exists(select 1 from public.wt_members where workspace_id=w and user_id=target) then raise exception 'Owner must be an active workspace member'; end if;
      old_owner:=t.owner_id; old_status:=t.status; t.owner_id:=target; t.status:='pending';
      result:=jsonb_build_object('from_owner',old_owner,'to_owner',target,'from_status',old_status,'to_status','pending','reason',v_reason);
    end if;
    update public.wt_tasks set title=t.title,body=t.body,owner_id=t.owner_id,status=t.status,priority=t.priority,
      due_date=t.due_date,follow_up_date=t.follow_up_date,next_action=t.next_action,version=version+1,updated_at=now()
      where id=t.id returning * into t;
    perform public.wt_emit(t,u,case p_action when 'transition_task' then 'transition' when 'transfer_task' then 'transfer' else 'updated' end,result);
    return to_jsonb(t);
  end if;
  raise exception 'Unknown action: %',p_action;
end $$;
revoke all on function public.wt_command(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.wt_command(text,jsonb) to authenticated;

-- Only the server-side, signature-verifying Feishu receiver may call ingress.
create function public.wt_ingest_feishu(p_event_id text,p_open_id text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  code_row public.wt_feishu_codes%rowtype; binding public.wt_feishu_bindings%rowtype;
  prior public.wt_feishu_events%rowtype; w uuid; result jsonb; v_action text;
begin
  if p_event_id is null or btrim(p_event_id)='' or length(p_event_id)>200 or p_open_id is null or btrim(p_open_id)='' or length(p_open_id)>200 then raise exception 'Invalid event identity'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event_id,0));
  perform pg_advisory_xact_lock(hashtextextended('feishu-open:' || p_open_id,0));
  select * into prior from public.wt_feishu_events where event_id=p_event_id;
  if prior.event_id is not null then
    if prior.open_id<>p_open_id then raise exception 'Event identity conflict'; end if;
    return prior.result;
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid payload'; end if;
  v_action:=public.wt_text(p_payload,'action',20,true);
  if v_action not in ('bind','record','task') then raise exception 'Unknown Feishu action'; end if;
  if v_action='bind' then
    select * into code_row from public.wt_feishu_codes where code=public.wt_text(p_payload,'code',100,true);
    if code_row.code is null then raise exception 'Invalid binding code'; end if;
    perform 1 from public.wt_workspaces where id=code_row.workspace_id for update;
    select * into code_row from public.wt_feishu_codes where code=code_row.code for update;
    if code_row.code is null or code_row.used_at is not null or code_row.expires_at<=now() then raise exception 'Invalid or expired binding code'; end if;
    if not exists(select 1 from public.wt_members where workspace_id=code_row.workspace_id and user_id=code_row.user_id) then raise exception 'Binding member no longer active'; end if;
    delete from public.wt_feishu_bindings where workspace_id=code_row.workspace_id and user_id=code_row.user_id;
    insert into public.wt_feishu_bindings(open_id,workspace_id,user_id) values(p_open_id,code_row.workspace_id,code_row.user_id)
      on conflict(open_id) do update set workspace_id=excluded.workspace_id,user_id=excluded.user_id;
    update public.wt_feishu_codes set used_at=now() where code=code_row.code;
    result:=jsonb_build_object('bound',true,'workspace_id',code_row.workspace_id);
  else
    select * into binding from public.wt_feishu_bindings where open_id=p_open_id;
    if binding.open_id is not null then
      perform 1 from public.wt_workspaces where id=binding.workspace_id for update;
      select * into binding from public.wt_feishu_bindings where open_id=p_open_id;
    end if;
    if binding.open_id is null or not exists(select 1 from public.wt_members where workspace_id=binding.workspace_id and user_id=binding.user_id) then
      -- An ignored valid event is a terminal receipt too: binding later must
      -- never turn an old delivery into a new task or record.
      result:=jsonb_build_object('ignored',true,'reason','unbound');
    elsif v_action='record' then
      result:=public.wt_insert_record(binding.workspace_id,binding.user_id,p_payload,'feishu');
    else
      result:=public.wt_insert_task(binding.workspace_id,binding.user_id,p_payload || jsonb_build_object('ownerId',binding.user_id));
    end if;
  end if;
  insert into public.wt_feishu_events(event_id,open_id,result) values(p_event_id,p_open_id,result);
  return result;
end $$;
revoke all on function public.wt_ingest_feishu(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.wt_ingest_feishu(text,text,jsonb) to service_role;

create function public.wt_enqueue_due() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin
  insert into public.wt_outbox(workspace_id,task_id,recipient_id,payload,dedupe_key)
    select t.workspace_id,t.id,t.owner_id,public.wt_task_payload(t,v.kind),v.kind || ':' || t.id::text || ':' || current_date::text
    from public.wt_tasks t join public.wt_members m on m.workspace_id=t.workspace_id and m.user_id=t.owner_id
    cross join lateral (select 'overdue'::text as kind where t.due_date<current_date
      union all select 'followup'::text where t.follow_up_date<=current_date) v
    where t.status<>'done' on conflict(dedupe_key) do nothing;
  get diagnostics n=row_count;
  return jsonb_build_object('enqueued',n);
end $$;

create function public.wt_claim_notifications(p_limit integer default 20)
returns table(id uuid,workspace_id uuid,payload jsonb,claim_token uuid,attempts integer)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.wt_outbox%rowtype; t public.wt_tasks%rowtype; v_payload jsonb;
begin
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Limit must be between 1 and 100'; end if;
  update public.wt_outbox o set status='failed',claim_token=null,lease_until=null,
    last_error=coalesce(o.last_error,'Maximum notification attempts reached')
    where o.attempts>=5 and (o.status='pending' or (o.status='processing' and o.lease_until<=now()));
  for q in select o.* from public.wt_outbox o
    where o.attempts<5 and ((o.status='pending' and o.available_at<=now()) or (o.status='processing' and o.lease_until<=now()))
    order by o.created_at,o.id limit p_limit for update skip locked
  loop
    select * into t from public.wt_tasks where wt_tasks.id=q.task_id;
    if t.id is null or not exists(select 1 from public.wt_members m where m.workspace_id=q.workspace_id and m.user_id=t.owner_id) then
      update public.wt_outbox o set status='failed',last_error='Owner is no longer a workspace member',claim_token=null,lease_until=null where o.id=q.id;
      continue;
    end if;
    if q.dedupe_key is not null and (
      t.status='done' or split_part(q.dedupe_key,':',3)<>current_date::text or
      not ((split_part(q.dedupe_key,':',1)='overdue' and t.due_date is not null and t.due_date<current_date) or
           (split_part(q.dedupe_key,':',1)='followup' and t.follow_up_date is not null and t.follow_up_date<=current_date))
    ) then
      update public.wt_outbox o set status='cancelled',last_error=null,claim_token=null,lease_until=null where o.id=q.id;
      continue;
    end if;
    v_payload:=public.wt_task_payload(t,case when q.dedupe_key is not null then split_part(q.dedupe_key,':',1) else 'Task update' end);
    update public.wt_outbox o set status='processing',attempts=o.attempts+1,claim_token=gen_random_uuid(),
      lease_until=now()+interval '120 seconds',recipient_id=t.owner_id,payload=v_payload where o.id=q.id returning o.* into q;
    return query select q.id,q.workspace_id,q.payload,q.claim_token,q.attempts;
  end loop;
end $$;

create function public.wt_finish_notification(p_id uuid,p_claim_token uuid,p_error text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.wt_outbox%rowtype; v_status text;
begin
  select * into q from public.wt_outbox where id=p_id for update;
  if q.id is null or q.status<>'processing' or p_claim_token is null or q.claim_token is distinct from p_claim_token or q.lease_until<=now() then raise exception 'Invalid or expired notification claim'; end if;
  v_status:=case when p_error is null then 'sent' when q.attempts>=5 then 'failed' else 'pending' end;
  update public.wt_outbox set status=v_status,claim_token=null,lease_until=null,
    last_error=case when p_error is null then null else left(p_error,1000) end,
    sent_at=case when p_error is null then now() else null end,
    available_at=case when p_error is null then available_at else now()+make_interval(secs=>least(3600,30*power(2,q.attempts-1))::integer) end
    where id=p_id;
  return jsonb_build_object('status',v_status);
end $$;

revoke all on function public.wt_enqueue_due(),public.wt_claim_notifications(integer),public.wt_finish_notification(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.wt_enqueue_due(),public.wt_claim_notifications(integer),public.wt_finish_notification(uuid,uuid,text) to service_role;
