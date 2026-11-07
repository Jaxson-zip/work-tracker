-- 业务写入都在这里。权限、经过记录和通知入队在同一个事务里完成。
create function public.wt_name(p_user uuid) returns text
language sql stable set search_path=pg_catalog,public as $$
  select coalesce((select display_name from public.wt_profiles where id=p_user),'已离开的成员')
$$;
create function public.wt_log(t public.wt_tasks,p_actor uuid,p_action text,p_detail jsonb default '{}') returns void
language sql set search_path=pg_catalog,public as $$
  insert into public.wt_activities(workspace_id,task_id,actor_id,action,detail) values(t.workspace_id,t.id,p_actor,p_action,p_detail)
$$;
-- 操作人自己不需要被提醒；没有其他收件人时不产生消息。
create function public.wt_notify(p_workspace uuid,p_actor uuid,p_recipients uuid[],p_message text) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare v_mentions jsonb;
begin
  select jsonb_agg(distinct r) into v_mentions from unnest(p_recipients) r where r is not null and r<>p_actor;
  if v_mentions is null then return; end if;
  insert into public.wt_outbox(workspace_id,payload) values(p_workspace,jsonb_build_object('message',p_message,'mention_ids',v_mentions));
end $$;
-- 发起交接：记录经过并通知接手人。调用前已确认权限，负责人此时不变。
create function public.wt_start_handoff(t public.wt_tasks,p_actor uuid,p_to uuid,p_note text) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
  perform public.wt_log(t,p_actor,'handoff',jsonb_build_object('to',p_to,'note',p_note));
  perform public.wt_notify(t.workspace_id,p_actor,array[p_to],
    '【待接手】' || public.wt_name(p_actor) || ' 把「' || t.title || '」交给 ' || public.wt_name(p_to) ||
    case when p_note<>'' then E'\n交接说明：' || p_note else '' end ||
    case when t.due_date is not null then E'\n截止：' || t.due_date::text else '' end ||
    E'\n请打开系统接手或退回。');
end $$;
create function public.wt_create_task(w uuid,u uuid,p jsonb) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare t public.wt_tasks%rowtype; v_to uuid:=coalesce(nullif(p->>'ownerId','')::uuid,u); v_note text:=public.wt_text(p,'note',1000);
begin
  if not exists(select 1 from public.wt_members where workspace_id=w and user_id=v_to) then raise exception 'Owner must be a team member'; end if;
  insert into public.wt_tasks(workspace_id,title,owner_id,created_by,due_date,pending_owner_id,handoff_by,handoff_note)
    values(w,public.wt_text(p,'title',160,true),u,u,public.wt_date(p,'dueDate'),nullif(v_to,u),case when v_to<>u then u end,case when v_to<>u then v_note else '' end)
    returning * into t;
  perform public.wt_log(t,u,'created');
  if t.pending_owner_id is not null then perform public.wt_start_handoff(t,u,v_to,t.handoff_note); end if;
  return to_jsonb(t);
end $$;
revoke all on function public.wt_name(uuid),public.wt_log(public.wt_tasks,uuid,text,jsonb),public.wt_notify(uuid,uuid,uuid[],text),public.wt_start_handoff(public.wt_tasks,uuid,uuid,text),public.wt_create_task(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

-- 单条待办的流转。调用方已确认成员身份并锁定团队。
create function public.wt_task_command(p_action text,p jsonb,w uuid,u uuid,r text) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare t public.wt_tasks%rowtype; manager boolean:=r in ('owner','admin'); v_note text; v_to uuid; v_people uuid[]; v_title text; v_due date;
begin
  select * into t from public.wt_tasks where workspace_id=w and id=(p->>'taskId')::uuid for update;
  if t.id is null then raise exception 'Task not found'; end if;
  if p_action='accept_task' then
    if t.pending_owner_id is distinct from u then raise exception 'Only the receiver can respond'; end if;
    perform public.wt_log(t,u,'accepted',jsonb_build_object('from',t.handoff_by));
    perform public.wt_notify(w,u,array[t.handoff_by],'【已接手】' || public.wt_name(u) || ' 接手了「' || t.title || '」');
    t.owner_id:=u; t.pending_owner_id:=null; t.handoff_by:=null; t.handoff_note:='';
  elsif p_action='reject_task' then
    if t.pending_owner_id is distinct from u then raise exception 'Only the receiver can respond'; end if;
    v_note:=public.wt_text(p,'note',1000,true);
    perform public.wt_log(t,u,'rejected',jsonb_build_object('note',v_note));
    perform public.wt_notify(w,u,array[t.handoff_by,t.owner_id],'【被退回】' || public.wt_name(u) || ' 退回了「' || t.title || E'」\n原因：' || v_note);
    t.pending_owner_id:=null; t.handoff_by:=null; t.handoff_note:='';
  elsif p_action='withdraw_task' then
    if t.pending_owner_id is null then raise exception 'No pending handoff'; end if;
    if u not in (t.handoff_by,t.owner_id) and not manager then raise exception 'Forbidden'; end if;
    perform public.wt_log(t,u,'withdrawn');
    perform public.wt_notify(w,u,array[t.pending_owner_id],'【已撤回】' || public.wt_name(u) || ' 撤回了「' || t.title || '」的交接');
    t.pending_owner_id:=null; t.handoff_by:=null; t.handoff_note:='';
  elsif p_action='delete_task' then
    -- 只有自己写的、还没交给过别人的才能删；流转过的要留下记录。
    if t.created_by<>u or t.owner_id<>u or t.pending_owner_id is not null or exists(select 1 from public.wt_activities a where a.task_id=t.id and a.action='handoff') then raise exception 'Forbidden'; end if;
    delete from public.wt_tasks where id=t.id;
    return jsonb_build_object('ok',true);
  else
    if (p->>'expectedVersion') is null or (p->>'expectedVersion') !~ '^[1-9][0-9]*$' then raise exception 'Expected version required'; end if;
    if t.version<>(p->>'expectedVersion')::integer then raise exception 'Version conflict'; end if;
    if p_action='handoff_task' then
      if u<>t.owner_id and not manager then raise exception 'Forbidden'; end if;
      if t.status='done' then raise exception 'Task done'; end if;
      if t.pending_owner_id is not null then raise exception 'Handoff pending'; end if;
      v_note:=public.wt_text(p,'note',1000,true);
      v_to:=(p->>'toUserId')::uuid;
      if not exists(select 1 from public.wt_members where workspace_id=w and user_id=v_to) then raise exception 'Owner must be a team member'; end if;
      if v_to=t.owner_id then raise exception 'Already the owner'; end if;
      t.pending_owner_id:=v_to; t.handoff_by:=u; t.handoff_note:=v_note;
      perform public.wt_start_handoff(t,u,v_to,v_note);
    elsif p_action='complete_task' then
      if u<>t.owner_id then raise exception 'Forbidden'; end if;
      if t.status='done' then raise exception 'Task done'; end if;
      if t.pending_owner_id is not null then raise exception 'Handoff pending'; end if;
      t.status:='done';
      perform public.wt_log(t,u,'done');
      select array_agg(a.actor_id) into v_people from public.wt_activities a where a.task_id=t.id;
      perform public.wt_notify(w,u,v_people,'【已完成】' || public.wt_name(u) || ' 完成了「' || t.title || '」');
    elsif p_action='update_task' then
      -- 交接中不能改：对方正在按交接时的内容决定接不接。
      if u<>t.owner_id and not manager then raise exception 'Forbidden'; end if;
      if t.status='done' then raise exception 'Task done'; end if;
      if t.pending_owner_id is not null then raise exception 'Handoff pending'; end if;
      v_title:=public.wt_text(p,'title',160,true);
      v_due:=public.wt_date(p,'dueDate');
      if v_title=t.title and v_due is not distinct from t.due_date then return to_jsonb(t); end if;
      perform public.wt_log(t,u,'edited',
        case when v_title<>t.title then jsonb_build_object('title',v_title) else '{}'::jsonb end ||
        case when v_due is distinct from t.due_date then jsonb_build_object('due',v_due) else '{}'::jsonb end);
      perform public.wt_notify(w,u,array[t.owner_id],'【已修改】' || public.wt_name(u) || ' 修改了「' || t.title || '」');
      t.title:=v_title; t.due_date:=v_due;
    elsif p_action='reopen_task' then
      if u not in (t.owner_id,t.created_by) and not manager then raise exception 'Forbidden'; end if;
      if t.status<>'done' then raise exception 'Task not done'; end if;
      if not exists(select 1 from public.wt_members where workspace_id=w and user_id=t.owner_id) then raise exception 'Owner must be a team member'; end if;
      t.status:='open';
      perform public.wt_log(t,u,'reopened');
      perform public.wt_notify(w,u,array[t.owner_id],'【重新打开】' || public.wt_name(u) || ' 重新打开了「' || t.title || '」');
    else raise exception 'Unknown action: %',p_action; end if;
  end if;
  update public.wt_tasks set title=t.title,due_date=t.due_date,owner_id=t.owner_id,status=t.status,pending_owner_id=t.pending_owner_id,handoff_by=t.handoff_by,handoff_note=t.handoff_note,
    version=version+1,updated_at=now() where id=t.id returning * into t;
  return to_jsonb(t);
end $$;
revoke all on function public.wt_task_command(text,jsonb,uuid,uuid,text) from public,anon,authenticated,service_role;

-- 管理者看全队；其他人只看自己写的、手上的、等自己接手的和经手过的。
create function public.wt_visible_tasks(w uuid,u uuid,r text) returns setof public.wt_tasks
language sql stable set search_path=pg_catalog,public as $$
  select t.* from public.wt_tasks t where t.workspace_id=w and (
    r in ('owner','admin') or u in (t.created_by,t.owner_id,t.pending_owner_id)
    or exists(select 1 from public.wt_activities a where a.task_id=t.id and a.actor_id=u))
$$;
create function public.wt_snapshot(w uuid,u uuid) returns jsonb
language plpgsql stable set search_path=pg_catalog,public as $$
declare r text; manager boolean;
begin
  select role into r from public.wt_members where workspace_id=w and user_id=u;
  manager:=r in ('owner','admin');
  return jsonb_build_object(
    'workspaces',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.wt_workspaces x join public.wt_members m on m.workspace_id=x.id where m.user_id=u),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select m.user_id,m.role,m.created_at,p.display_name from public.wt_members m join public.wt_profiles p on p.id=m.user_id where m.workspace_id=w) x),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.wt_visible_tasks(w,u,r) x),'[]'::jsonb),
    'activities',coalesce((select jsonb_agg(to_jsonb(a) order by a.seq) from public.wt_activities a where a.task_id in (select id from public.wt_visible_tasks(w,u,r))),'[]'::jsonb),
    'invites',case when manager then coalesce((select jsonb_agg(to_jsonb(x)) from (select id,code,expires_at from public.wt_invites where workspace_id=w and used_at is null and expires_at>now()) x),'[]'::jsonb) else '[]'::jsonb end,
    'failed_notifications',case when manager then (select count(*) from public.wt_outbox where workspace_id=w and status='failed') else 0 end,
    'profile',(select to_jsonb(x) from public.wt_profiles x where id=u),
    'my_mobile',coalesce((select mobile from public.wt_contacts where user_id=u),'')
  );
end $$;
revoke all on function public.wt_visible_tasks(uuid,uuid,text),public.wt_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create function public.wt_command(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid(); w uuid; r text; v_mobile text; inv public.wt_invites%rowtype; target uuid; target_role text; new_role text; n integer;
begin
  if u is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid payload'; end if;
  insert into public.wt_profiles(id,display_name)
    select id,left(coalesce(nullif(btrim(raw_user_meta_data->>'display_name'),''),nullif(split_part(email,'@',1),''),'User'),80) from auth.users where id=u
    on conflict(id) do nothing;
  if not exists(select 1 from public.wt_profiles where id=u) then raise exception 'Unknown user'; end if;
  if p_action='create_workspace' then
    insert into public.wt_workspaces(name,created_by) values(public.wt_text(p_payload,'name',80,true),u) returning id into w;
    insert into public.wt_members(workspace_id,user_id,role) values(w,u,'owner');
    return (select to_jsonb(x) from public.wt_workspaces x where id=w);
  elsif p_action='update_profile' then
    update public.wt_profiles set display_name=public.wt_text(p_payload,'displayName',80,true) where id=u;
    v_mobile:=public.wt_text(p_payload,'mobile',11);
    if v_mobile='' then delete from public.wt_contacts where user_id=u;
    elsif v_mobile !~ '^1[0-9]{10}$' then raise exception 'Invalid mobile';
    else insert into public.wt_contacts(user_id,mobile) values(u,v_mobile) on conflict(user_id) do update set mobile=excluded.mobile;
    end if;
    return jsonb_build_object('ok',true);
  elsif p_action='join_workspace' then
    select * into inv from public.wt_invites where code=public.wt_text(p_payload,'code',100,true) for update;
    if inv.id is null or inv.used_at is not null or inv.expires_at<=now() then raise exception 'Invalid or expired invite'; end if;
    if exists(select 1 from public.wt_members where workspace_id=inv.workspace_id and user_id=u) then raise exception 'Already a member'; end if;
    insert into public.wt_members(workspace_id,user_id,role) values(inv.workspace_id,u,'member');
    update public.wt_invites set used_at=now(),used_by=u where id=inv.id;
    return (select to_jsonb(x) from public.wt_workspaces x where id=inv.workspace_id);
  end if;
  w:=nullif(p_payload->>'workspaceId','')::uuid;
  if p_action='snapshot' then
    if w is null then select workspace_id into w from public.wt_members where user_id=u order by created_at,workspace_id limit 1; end if;
    if w is not null and not exists(select 1 from public.wt_members where workspace_id=w and user_id=u) then raise exception 'Forbidden'; end if;
    return public.wt_snapshot(w,u);
  end if;
  -- 权限变更和业务写入按团队串行，避免刚被移除的人继续操作。
  perform 1 from public.wt_workspaces where id=w for update;
  select role into r from public.wt_members where workspace_id=w and user_id=u;
  if r is null then raise exception 'Forbidden'; end if;
  if p_action='create_task' then
    return public.wt_create_task(w,u,p_payload);
  elsif p_action in ('handoff_task','accept_task','reject_task','withdraw_task','complete_task','reopen_task','delete_task','update_task') then
    return public.wt_task_command(p_action,p_payload,w,u,r);
  end if;
  if r not in ('owner','admin') then raise exception 'Forbidden'; end if;
  if p_action='invite' then
    insert into public.wt_invites(workspace_id,created_by) values(w,u) returning * into inv;
    return to_jsonb(inv);
  elsif p_action='retry_notifications' then
    update public.wt_outbox set status='pending',attempts=0,available_at=now(),claim_token=null,lease_until=null,last_error=null where workspace_id=w and status='failed';
    get diagnostics n=row_count;
    return jsonb_build_object('count',n);
  elsif p_action='update_member' then
    target:=(p_payload->>'userId')::uuid;
    select role into target_role from public.wt_members where workspace_id=w and user_id=target;
    if target_role is null then raise exception 'Member not found'; end if;
    if target_role='owner' then raise exception 'Workspace owner is protected'; end if;
    new_role:=p_payload->>'role';
    if not (p_payload ? 'role') or (new_role is not null and new_role not in ('admin','member')) then raise exception 'Invalid role'; end if;
    if r='admin' and (target_role='admin' or new_role='admin') then raise exception 'Forbidden'; end if;
    if new_role is null then
      if exists(select 1 from public.wt_tasks where workspace_id=w and status='open' and (owner_id=target or pending_owner_id=target)) then raise exception 'Reassign open tasks before removing member'; end if;
      delete from public.wt_members where workspace_id=w and user_id=target;
    else
      update public.wt_members set role=new_role where workspace_id=w and user_id=target;
    end if;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'Unknown action: %',p_action;
end $$;
revoke all on function public.wt_command(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.wt_command(text,jsonb) to authenticated;
