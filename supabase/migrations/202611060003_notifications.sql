-- 每个团队每天一条摘要。日期由调用方按业务时区计算，数据库时区不参与判断。
create function public.wt_enqueue_digest(p_today date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w record; v_sections text; v_mentions jsonb; n integer:=0; inserted integer;
begin
  if p_today is null then raise exception 'Date required'; end if;
  for w in select distinct workspace_id as id from public.wt_tasks where status='open' loop
    with hits as (
      select s.ord,s.label,s.person,public.wt_name(s.person) || '：' || t.title as line
      from public.wt_tasks t cross join lateral (values
        (1,'待接手',t.pending_owner_id is not null,t.pending_owner_id),
        (2,'已逾期',t.due_date<p_today,t.owner_id),
        (3,'今天到期',t.due_date=p_today,t.owner_id)
      ) s(ord,label,hit,person)
      where t.workspace_id=w.id and t.status='open' and s.hit
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
