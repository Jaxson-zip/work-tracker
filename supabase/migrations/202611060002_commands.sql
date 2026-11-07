-- 业务写入都在这里。权限、状态流转、操作历史和通知入队在同一个事务里完成。
create function public.wt_name(p_user uuid) returns text
language sql stable set search_path=pg_catalog,public as $$
  select coalesce((select display_name from public.wt_profiles where id=p_user),'已离开的成员')
$$;
create function public.wt_log(t public.wt_tasks,p_actor uuid,p_action text,p_detail jsonb default '{}') returns void
language sql set search_path=pg_catalog,public as $$
  insert into public.wt_activities(workspace_id,task_id,actor_id,action,detail) values(t.workspace_id,t.id,p_actor,p_action,p_detail)
$$;
-- 操作人自己不需要被提醒；没有其他收件人时不产生消息。
create function public.wt_notify(p_workspace uuid,p_task uuid,p_actor uuid,p_recipients uuid[],p_message text) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare v_mentions jsonb;
begin
  select jsonb_agg(distinct r) into v_mentions from unnest(p_recipients) r where r is not null and r<>p_actor;
  if v_mentions is null then return; end if;
  insert into public.wt_outbox(workspace_id,task_id,payload)
    values(p_workspace,p_task,jsonb_build_object('message',p_message,'mention_ids',v_mentions));
end $$;
create function public.wt_handoff_message(t public.wt_tasks,p_actor uuid) returns text
language sql stable set search_path=pg_catalog,public as $$
  select '【待接收】' || public.wt_name(p_actor) || ' 把「' || t.title || '」转给 ' || public.wt_name(t.pending_owner_id) ||
    case when t.handoff_note<>'' then E'\n说明：' || t.handoff_note else '' end ||
    case when t.due_date is not null then E'\n截止：' || t.due_date::text else '' end ||
    E'\n请打开系统接收或退回。'
$$;
create function public.wt_insert_task(p_workspace uuid,p_actor uuid,p jsonb,p_record uuid default null) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare t public.wt_tasks%rowtype; v_owner uuid:=(p->>'ownerId')::uuid; v_priority text:=coalesce(p->>'priority','normal');
begin
  if not exists(select 1 from public.wt_members where workspace_id=p_workspace and user_id=v_owner) then raise exception 'Owner must be an active workspace member'; end if;
  if v_priority not in ('low','normal','high') then raise exception 'Invalid priority'; end if;
  -- 指派给别人等同于转交：对方接收后才算他的。
  insert into public.wt_tasks(workspace_id,title,body,owner_id,created_by,priority,due_date,follow_up_date,next_action,source_record_id,pending_owner_id,handoff_by,handoff_note)
    values(p_workspace,public.wt_text(p,'title',160,true),public.wt_text(p,'body',10000),p_actor,p_actor,v_priority,
      public.wt_date(p,'dueDate'),public.wt_date(p,'followUpDate'),public.wt_text(p,'nextAction',1000),p_record,
      nullif(v_owner,p_actor),case when v_owner<>p_actor then p_actor end,public.wt_text(p,'handoffNote',1000)) returning * into t;
  perform public.wt_log(t,p_actor,'created',jsonb_build_object('source_record_id',p_record));
  if t.pending_owner_id is not null then
    perform public.wt_log(t,p_actor,'handoff',jsonb_build_object('from_owner',p_actor,'to_owner',v_owner,'reason',t.handoff_note));
    perform public.wt_notify(p_workspace,t.id,p_actor,array[v_owner],public.wt_handoff_message(t,p_actor));
  end if;
  return to_jsonb(t);
end $$;
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
revoke all on function public.wt_name(uuid),public.wt_log(public.wt_tasks,uuid,text,jsonb),public.wt_notify(uuid,uuid,uuid,uuid[],text),public.wt_handoff_message(public.wt_tasks,uuid),public.wt_insert_task(uuid,uuid,jsonb,uuid),public.wt_insert_record(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

-- 单个事项的写操作：编辑、状态流转、转交、接收、退回、撤回。调用方已确认成员身份并锁定团队。
create function public.wt_task_command(p_action text,p_payload jsonb,w uuid,u uuid,r text) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare
  t public.wt_tasks%rowtype; old_status text; new_status text; v_reason text; target uuid; old_owner uuid;
  v_log text; result jsonb; manager boolean:=r in ('owner','admin');
begin
  select * into t from public.wt_tasks where workspace_id=w and id=(p_payload->>'taskId')::uuid for update;
  if t.id is null then raise exception 'Task not found'; end if;
  if p_action='comment_task' then
    v_reason:=public.wt_text(p_payload,'comment',2000,true);
    perform public.wt_log(t,u,'comment',jsonb_build_object('comment',v_reason));
    perform public.wt_notify(w,t.id,u,array[case when u=t.owner_id then t.created_by else t.owner_id end],
      '【跟进】' || public.wt_name(u) || ' 在「' || t.title || '」补充：' || v_reason);
    return to_jsonb(t);
  end if;
  if p_action='accept_transfer' then
    if t.pending_owner_id is distinct from u then raise exception 'Only the receiver can respond'; end if;
    perform public.wt_notify(w,t.id,u,array[t.handoff_by],'【已接收】' || public.wt_name(u) || ' 接收了「' || t.title || '」');
    old_owner:=t.owner_id; t.owner_id:=u;
    if t.status<>'blocked' then t.status:='in_progress'; end if;
    t.pending_owner_id:=null; t.handoff_by:=null; t.handoff_note:='';
    t.returned_to:=null; t.returned_by:=null; t.returned_note:='';
    v_log:='handoff_accepted'; result:=jsonb_build_object('from_owner',old_owner,'to_owner',u);
  elsif p_action='reject_transfer' then
    if t.pending_owner_id is distinct from u then raise exception 'Only the receiver can respond'; end if;
    v_reason:=public.wt_text(p_payload,'reason',1000);
    if v_reason='' then raise exception 'Reason required'; end if;
    perform public.wt_notify(w,t.id,u,array[t.handoff_by,t.owner_id],
      '【被退回】' || public.wt_name(u) || ' 退回了「' || t.title || E'」\n原因：' || v_reason);
    t.returned_to:=t.handoff_by; t.returned_by:=u; t.returned_note:=v_reason;
    t.pending_owner_id:=null; t.handoff_by:=null; t.handoff_note:='';
    v_log:='handoff_rejected'; result:=jsonb_build_object('reason',v_reason);
  elsif p_action='withdraw_transfer' then
    if t.pending_owner_id is null then raise exception 'No pending handoff'; end if;
    if u not in (t.handoff_by,t.owner_id) and not manager then raise exception 'Forbidden transfer'; end if;
    perform public.wt_notify(w,t.id,u,array[t.pending_owner_id],'【已撤回】' || public.wt_name(u) || ' 撤回了「' || t.title || '」的转交');
    t.pending_owner_id:=null; t.handoff_by:=null; t.handoff_note:='';
    v_log:='handoff_withdrawn'; result:='{}';
  elsif p_action='ack_return' then
    if t.returned_to is null then raise exception 'No returned handoff'; end if;
    if u not in (t.returned_to,t.owner_id) and not manager then raise exception 'Forbidden transfer'; end if;
    t.returned_to:=null; t.returned_by:=null; t.returned_note:='';
    v_log:='return_ack'; result:='{}';
  else
    if jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion') !~ '^[1-9][0-9]*$' then raise exception 'Expected version required'; end if;
    if t.version<>(p_payload->>'expectedVersion')::integer then raise exception 'Version conflict'; end if;
    if p_action='update_task' then
      if u not in (t.owner_id,t.created_by) and not manager then raise exception 'Forbidden task edit'; end if;
      if p_payload ? 'title' then t.title:=public.wt_text(p_payload,'title',160,true); end if;
      if p_payload ? 'body' then t.body:=public.wt_text(p_payload,'body',10000); end if;
      if p_payload ? 'priority' then
        t.priority:=public.wt_text(p_payload,'priority',10,true);
        if t.priority not in ('low','normal','high') then raise exception 'Invalid priority'; end if;
      end if;
      if p_payload ? 'dueDate' then t.due_date:=public.wt_date(p_payload,'dueDate'); end if;
      if p_payload ? 'followUpDate' then t.follow_up_date:=public.wt_date(p_payload,'followUpDate'); end if;
      if p_payload ? 'nextAction' then t.next_action:=public.wt_text(p_payload,'nextAction',1000); end if;
      v_log:='updated'; result:=jsonb_build_object('fields',p_payload-'workspaceId'-'taskId'-'expectedVersion');
    elsif p_action='transition_task' then
      if t.pending_owner_id is not null then raise exception 'Handoff pending'; end if;
      old_status:=t.status; new_status:=public.wt_text(p_payload,'status',20,true);
      v_reason:=public.wt_text(p_payload,'reason',1000);
      if new_status in ('blocked','cancelled') and v_reason='' then raise exception 'Reason required'; end if;
      if (old_status='pending' and new_status='in_progress') or
         (old_status='in_progress' and new_status in ('review','blocked')) or
         (old_status='blocked' and new_status='in_progress') then
        if u<>t.owner_id and not manager then raise exception 'Forbidden transition'; end if;
      elsif old_status in ('pending','in_progress','blocked') and new_status='done' then
        -- 自己的事自己确认完成；别人交来的事要由发起人验收。
        if u<>t.owner_id or t.created_by<>t.owner_id then raise exception 'Forbidden transition'; end if;
      elsif (old_status='review' and new_status in ('done','in_progress')) or (old_status='done' and new_status='in_progress') then
        if u<>t.created_by and not manager then raise exception 'Forbidden review'; end if;
        if new_status='in_progress' and v_reason='' then raise exception 'Reason required'; end if;
      elsif (old_status<>'cancelled' and old_status<>'done' and new_status='cancelled') or (old_status='cancelled' and new_status='in_progress') then
        if u not in (t.owner_id,t.created_by) and not manager then raise exception 'Forbidden transition'; end if;
        if v_reason='' then raise exception 'Reason required'; end if;
      else raise exception 'Invalid transition'; end if;
      if new_status<>'done' and new_status<>'cancelled' and not exists(select 1 from public.wt_members where workspace_id=w and user_id=t.owner_id) then
        raise exception 'Reassign to an active member before reopening task';
      end if;
      t.status:=new_status;
      v_log:='transition'; result:=jsonb_build_object('from',old_status,'to',new_status,'reason',v_reason);
      if new_status='review' then
        perform public.wt_notify(w,t.id,u,array[t.created_by],'【待验收】' || public.wt_name(t.owner_id) || ' 提交了「' || t.title || '」，请验收');
      elsif new_status='done' then
        perform public.wt_notify(w,t.id,u,array[t.owner_id],'【已完成】「' || t.title || '」已通过验收');
      elsif new_status='in_progress' and old_status='review' then
        perform public.wt_notify(w,t.id,u,array[t.owner_id],'【验收退回】「' || t.title || E'」\n原因：' || v_reason);
      elsif new_status='blocked' then
        perform public.wt_notify(w,t.id,u,array[t.created_by],'【受阻】' || public.wt_name(t.owner_id) || '：「' || t.title || E'」\n原因：' || v_reason);
      elsif new_status='cancelled' then
        perform public.wt_notify(w,t.id,u,array[t.owner_id,t.created_by],'【已取消】「' || t.title || E'」\n原因：' || v_reason);
      end if;
    elsif p_action='transfer_task' then
      if u not in (t.owner_id,t.created_by) and not manager then raise exception 'Forbidden transfer'; end if;
      if t.status='cancelled' then raise exception 'Invalid transition'; end if;
      if t.pending_owner_id is not null then raise exception 'Handoff pending'; end if;
      v_reason:=public.wt_text(p_payload,'reason',1000,true);
      target:=(p_payload->>'ownerId')::uuid;
      if not exists(select 1 from public.wt_members where workspace_id=w and user_id=target) then raise exception 'Owner must be an active workspace member'; end if;
      if target=t.owner_id then raise exception 'Already the owner'; end if;
      t.pending_owner_id:=target; t.handoff_by:=u; t.handoff_note:=v_reason;
      t.returned_to:=null; t.returned_by:=null; t.returned_note:='';
      v_log:='handoff'; result:=jsonb_build_object('from_owner',t.owner_id,'to_owner',target,'reason',v_reason);
      perform public.wt_notify(w,t.id,u,array[target],public.wt_handoff_message(t,u));
    else raise exception 'Unknown action: %',p_action; end if;
  end if;
  update public.wt_tasks set title=t.title,body=t.body,owner_id=t.owner_id,status=t.status,priority=t.priority,
    due_date=t.due_date,follow_up_date=t.follow_up_date,next_action=t.next_action,
    pending_owner_id=t.pending_owner_id,handoff_by=t.handoff_by,handoff_note=t.handoff_note,
    returned_to=t.returned_to,returned_by=t.returned_by,returned_note=t.returned_note,
    version=version+1,updated_at=now()
    where id=t.id returning * into t;
  perform public.wt_log(t,u,v_log,result);
  return to_jsonb(t);
end $$;

-- 交接：把一个人的未完成事项一次转给另一个人（休假、离职、调岗）。
create function public.wt_transfer_all(p_payload jsonb,w uuid,u uuid,r text) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare t public.wt_tasks%rowtype; v_from uuid:=(p_payload->>'fromUserId')::uuid; v_to uuid:=(p_payload->>'toUserId')::uuid;
  v_reason text:=public.wt_text(p_payload,'reason',1000,true); n integer:=0; v_titles text:='';
begin
  if u<>v_from and r not in ('owner','admin') then raise exception 'Forbidden transfer'; end if;
  if v_from=v_to then raise exception 'Already the owner'; end if;
  if not exists(select 1 from public.wt_members where workspace_id=w and user_id=v_to) then raise exception 'Owner must be an active workspace member'; end if;
  for t in select * from public.wt_tasks where workspace_id=w and owner_id=v_from and status not in ('done','cancelled') and pending_owner_id is null order by due_date nulls last,created_at for update loop
    update public.wt_tasks set pending_owner_id=v_to,handoff_by=u,handoff_note=v_reason,returned_to=null,returned_by=null,returned_note='',version=version+1,updated_at=now() where id=t.id;
    perform public.wt_log(t,u,'handoff',jsonb_build_object('from_owner',v_from,'to_owner',v_to,'reason',v_reason));
    n:=n+1;
    if n<=8 then v_titles:=v_titles || E'\n· ' || t.title; end if;
  end loop;
  if n=0 then raise exception 'No open tasks'; end if;
  perform public.wt_notify(w,null,u,array[v_to],'【待接收】' || public.wt_name(u) || ' 把 ' || public.wt_name(v_from) || ' 的 ' || n || ' 件事项转给 ' || public.wt_name(v_to) ||
    E'\n说明：' || v_reason || v_titles || case when n>8 then E'\n…还有 ' || (n-8) || ' 件' else '' end || E'\n请打开系统接收或退回。');
  return jsonb_build_object('count',n);
end $$;
create function public.wt_accept_all(w uuid,u uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare t public.wt_tasks%rowtype; n integer:=0; v_senders uuid[]:='{}';
begin
  for t in select * from public.wt_tasks where workspace_id=w and pending_owner_id=u for update loop
    v_senders:=v_senders || t.handoff_by;
    update public.wt_tasks set owner_id=u,status=case when status='blocked' then status else 'in_progress' end,
      pending_owner_id=null,handoff_by=null,handoff_note='',returned_to=null,returned_by=null,returned_note='',version=version+1,updated_at=now() where id=t.id;
    perform public.wt_log(t,u,'handoff_accepted',jsonb_build_object('from_owner',t.owner_id,'to_owner',u));
    n:=n+1;
  end loop;
  if n>0 then perform public.wt_notify(w,null,u,v_senders,'【已接收】' || public.wt_name(u) || ' 接收了 ' || n || ' 件事项'); end if;
  return jsonb_build_object('count',n);
end $$;
revoke all on function public.wt_task_command(text,jsonb,uuid,uuid,text),public.wt_transfer_all(jsonb,uuid,uuid,text),public.wt_accept_all(uuid,uuid) from public,anon,authenticated,service_role;

create function public.wt_snapshot(w uuid,u uuid) returns jsonb
language plpgsql stable set search_path=pg_catalog,public as $$
declare r text;
begin
  select role into r from public.wt_members where workspace_id=w and user_id=u;
  return jsonb_build_object(
    'selected_workspace_id',w,
    'workspaces',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.wt_workspaces x join public.wt_members m on m.workspace_id=x.id where m.user_id=u),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(to_jsonb(x)) from (select m.workspace_id,m.user_id,m.role,m.department,p.display_name from public.wt_members m join public.wt_profiles p on p.id=m.user_id where m.workspace_id=w) x),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.wt_tasks x where workspace_id=w),'[]'::jsonb),
    'records',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.wt_records x where workspace_id=w),'[]'::jsonb),
    'activities',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.wt_activities x where workspace_id=w),'[]'::jsonb),
    'invites',case when r in ('owner','admin') then coalesce((select jsonb_agg(to_jsonb(x)) from (select id,code,role,expires_at,used_at from public.wt_invites where workspace_id=w) x),'[]'::jsonb) else '[]'::jsonb end,
    'outbox',case when r in ('owner','admin') then coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,status,last_error,created_at,payload->>'message' as message from public.wt_outbox where workspace_id=w order by created_at desc limit 50) x),'[]'::jsonb) else '[]'::jsonb end,
    'profile',(select to_jsonb(x) from public.wt_profiles x where id=u),
    'my_mobile',coalesce((select mobile from public.wt_contacts where user_id=u),''),
    'feishu_bound',exists(select 1 from public.wt_feishu_bindings where workspace_id=w and user_id=u)
  );
end $$;
revoke all on function public.wt_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create function public.wt_command(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  u uuid:=auth.uid(); w uuid; r text; v_name text; v_mobile text;
  inv public.wt_invites%rowtype; target uuid; target_role text; new_role text;
  a public.wt_records%rowtype; result jsonb; binding_code public.wt_feishu_codes%rowtype;
begin
  if u is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid payload'; end if;
  insert into public.wt_profiles(id,display_name)
    select id,left(coalesce(nullif(btrim(raw_user_meta_data->>'display_name'),''),nullif(split_part(email,'@',1),''),'User'),80) from auth.users where id=u
    on conflict(id) do nothing;
  if not exists(select 1 from public.wt_profiles where id=u) then raise exception 'Unknown user'; end if;
  if p_action='create_workspace' then
    v_name:=public.wt_text(p_payload,'name',80,true);
    insert into public.wt_workspaces(name,created_by) values(v_name,u) returning id into w;
    insert into public.wt_members(workspace_id,user_id,role,department) values(w,u,'owner',public.wt_text(p_payload,'department',40));
    return (select to_jsonb(x) from public.wt_workspaces x where id=w);
  elsif p_action='update_profile' then
    update public.wt_profiles set display_name=public.wt_text(p_payload,'displayName',80,true) where id=u;
    if p_payload ? 'mobile' then
      v_mobile:=public.wt_text(p_payload,'mobile',11);
      if v_mobile='' then delete from public.wt_contacts where user_id=u;
      elsif v_mobile !~ '^1[0-9]{10}$' then raise exception 'Invalid mobile';
      else insert into public.wt_contacts(user_id,mobile) values(u,v_mobile) on conflict(user_id) do update set mobile=excluded.mobile;
      end if;
    end if;
    return (select to_jsonb(x) from public.wt_profiles x where id=u);
  elsif p_action='join_workspace' then
    select * into inv from public.wt_invites where code=public.wt_text(p_payload,'code',100,true) for update;
    if inv.id is null or inv.used_at is not null or inv.expires_at<=now() then raise exception 'Invalid or expired invite'; end if;
    perform 1 from public.wt_workspaces where id=inv.workspace_id for update;
    if exists(select 1 from public.wt_members where workspace_id=inv.workspace_id and user_id=u) then raise exception 'Already a member'; end if;
    insert into public.wt_members(workspace_id,user_id,role,department) values(inv.workspace_id,u,inv.role,public.wt_text(p_payload,'department',40));
    update public.wt_invites set used_at=now(),used_by=u where id=inv.id;
    return (select to_jsonb(x) from public.wt_workspaces x where id=inv.workspace_id);
  end if;
  w:=nullif(p_payload->>'workspaceId','')::uuid;
  if p_action='snapshot' then
    if w is null then select workspace_id into w from public.wt_members where user_id=u order by created_at,workspace_id limit 1; end if;
    if w is not null and not public.wt_is_member(w) then raise exception 'Forbidden workspace'; end if;
    return public.wt_snapshot(w,u);
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
  elsif p_action='set_department' then
    target:=(p_payload->>'userId')::uuid;
    if target<>u and r not in ('owner','admin') then raise exception 'Forbidden member change'; end if;
    update public.wt_members set department=public.wt_text(p_payload,'department',40) where workspace_id=w and user_id=target;
    if not found then raise exception 'Member not found'; end if;
    return jsonb_build_object('ok',true);
  elsif p_action='update_member' then
    target:=(p_payload->>'userId')::uuid;
    select role into target_role from public.wt_members where workspace_id=w and user_id=target;
    if target_role is null then raise exception 'Member not found'; end if;
    if target_role='owner' then raise exception 'Workspace owner is protected'; end if;
    new_role:=p_payload->>'role';
    if not (p_payload ? 'role') or (new_role is not null and new_role not in ('admin','member')) then raise exception 'Invalid role'; end if;
    if r='member' or (r='admin' and (target_role='admin' or new_role='admin')) then raise exception 'Forbidden member change'; end if;
    if new_role is null then
      if exists(select 1 from public.wt_tasks where workspace_id=w and status not in ('done','cancelled') and (owner_id=target or pending_owner_id=target)) then raise exception 'Reassign open tasks before removing member'; end if;
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
  elsif p_action='transfer_all' then
    return public.wt_transfer_all(p_payload,w,u,r);
  elsif p_action='accept_all' then
    return public.wt_accept_all(w,u);
  elsif p_action in ('update_task','transition_task','transfer_task','comment_task','accept_transfer','reject_transfer','withdraw_transfer','ack_return') then
    return public.wt_task_command(p_action,p_payload,w,u,r);
  end if;
  raise exception 'Unknown action: %',p_action;
end $$;
revoke all on function public.wt_command(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.wt_command(text,jsonb) to authenticated;
