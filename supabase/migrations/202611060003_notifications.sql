-- Only the server-side, signature-verifying Feishu receiver may call ingress.
create function public.wt_ingest_feishu(p_event_id text,p_open_id text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  code_row public.wt_feishu_codes%rowtype; binding public.wt_feishu_bindings%rowtype;
  prior public.wt_feishu_events%rowtype; result jsonb; v_action text;
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

-- 每个团队每天一条摘要。日期由调用方按业务时区计算，数据库时区不参与判断。
create function public.wt_enqueue_digest(p_today date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w record; v_sections text; v_mentions jsonb; n integer:=0; inserted integer;
begin
  if p_today is null then raise exception 'Date required'; end if;
  for w in select distinct workspace_id as id from public.wt_tasks where status not in ('done','cancelled') loop
    with hits as (
      select s.ord,s.label,s.person,public.wt_name(s.person) || '：' || t.title as line
      from public.wt_tasks t cross join lateral (values
        (1,'待接收',t.pending_owner_id is not null,t.pending_owner_id),
        (2,'转交被退回',t.returned_to is not null,t.returned_to),
        (3,'已逾期',t.due_date<p_today,t.owner_id),
        (4,'今天到期',t.due_date=p_today,t.owner_id),
        (5,'今天要跟进',t.follow_up_date<=p_today,t.owner_id),
        (6,'待验收',t.status='review',t.created_by)
      ) s(ord,label,hit,person)
      where t.workspace_id=w.id and t.status not in ('done','cancelled') and s.hit
    ), numbered as (
      select *,row_number() over (partition by ord order by line) rn,count(*) over (partition by ord) total from hits
    ), sections as (
      select ord,label,max(total) total,string_agg('· ' || line,E'\n' order by rn) filter (where rn<=8) lines from numbered group by ord,label
    )
    select string_agg(label || '（' || total || E'）\n' || lines || case when total>8 then E'\n…还有 ' || (total-8) || ' 件' else '' end,E'\n\n' order by ord),
      (select jsonb_agg(distinct person) from hits)
    into v_sections,v_mentions from sections;
    if v_sections is null then continue; end if;
    insert into public.wt_outbox(workspace_id,payload,dedupe_key)
      values(w.id,jsonb_build_object('message','【每日待办 ' || to_char(p_today,'MM-DD') || E'】\n\n' || v_sections,'mention_ids',v_mentions),'digest:' || w.id || ':' || p_today)
      on conflict(dedupe_key) do nothing;
    get diagnostics inserted=row_count;
    n:=n+inserted;
  end loop;
  return jsonb_build_object('enqueued',n);
end $$;

create function public.wt_claim_notifications(p_limit integer,p_today date)
returns table(id uuid,workspace_id uuid,payload jsonb,mentions jsonb,claim_token uuid,attempts integer)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.wt_outbox%rowtype; v_mentions jsonb;
begin
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Limit must be between 1 and 100'; end if;
  update public.wt_outbox o set status='failed',claim_token=null,lease_until=null,
    last_error=coalesce(o.last_error,'Maximum notification attempts reached')
    where o.attempts>=5 and (o.status='pending' or (o.status='processing' and o.lease_until<=now()));
  for q in select o.* from public.wt_outbox o
    where o.attempts<5 and ((o.status='pending' and o.available_at<=now()) or (o.status='processing' and o.lease_until<=now()))
    order by o.created_at,o.id limit p_limit for update skip locked
  loop
    -- 摘要过了当天就没有意义，不再补发。
    if q.dedupe_key is not null and split_part(q.dedupe_key,':',3)<>p_today::text then
      update public.wt_outbox o set status='cancelled',last_error=null,claim_token=null,lease_until=null where o.id=q.id;
      continue;
    end if;
    select jsonb_agg(c.mobile) into v_mentions from public.wt_contacts c
      where c.user_id in (select (x)::uuid from jsonb_array_elements_text(coalesce(q.payload->'mention_ids','[]'::jsonb)) x);
    update public.wt_outbox o set status='processing',attempts=o.attempts+1,claim_token=gen_random_uuid(),
      lease_until=now()+interval '120 seconds' where o.id=q.id returning o.* into q;
    return query select q.id,q.workspace_id,q.payload,coalesce(v_mentions,'[]'::jsonb),q.claim_token,q.attempts;
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

revoke all on function public.wt_enqueue_digest(date),public.wt_claim_notifications(integer,date),public.wt_finish_notification(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.wt_enqueue_digest(date),public.wt_claim_notifications(integer,date),public.wt_finish_notification(uuid,uuid,text) to service_role;
