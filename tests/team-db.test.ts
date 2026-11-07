import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const users = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'];
let db: PGlite;
async function asUser(index: number, sql: string, params: unknown[] = []) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[index]]);
  await db.exec('set role authenticated');
  return db.query(sql, params);
}
async function command(index: number, action: string, payload = {}): Promise<any> {
  const r = await asUser(index, 'select public.wt_command($1, $2::jsonb) as result', [action, JSON.stringify(payload)]);
  return (r.rows[0] as any).result;
}
async function team(owner = 0, member = 1) {
  const w = await command(owner,'create_workspace',{name:'Team'});
  const invite = await command(owner,'invite',{workspaceId:w.id,role:'member'});
  await command(member,'join_workspace',{code:invite.code});
  return w.id as string;
}
async function service(sql: string, params: unknown[] = []) {
  await db.exec('reset role');
  await db.exec('set role service_role');
  return db.query(sql,params);
}
async function ingest(event: string, open: string, payload: object): Promise<any> {
  const response = await service('select public.wt_ingest_feishu($1,$2,$3::jsonb) result',[event,open,JSON.stringify(payload)]);
  return (response.rows[0] as any).result;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;`);
  for (let i = 0; i < users.length; i++) await db.query('insert into auth.users values ($1, $2)', [users[i], `user${i}@example.test`]);
  await db.exec(await readFile(new URL('../supabase/migrations/202611060001_work_tracker.sql', import.meta.url), 'utf8'));
}, 60_000);
afterAll(async () => { await db?.close(); });
describe('transactional team database', () => {
  test('creates an owned team and exposes a complete snapshot', async () => {
    const workspace = await command(0, 'create_workspace', {name:'Alpha'});
    const snapshot = await command(0, 'snapshot', {workspaceId:workspace.id});
    expect(snapshot.workspaces).toContainEqual(expect.objectContaining({id:workspace.id, name:'Alpha'}));
    expect(snapshot.members).toContainEqual(expect.objectContaining({user_id:users[0],role:'owner',display_name:'user0'}));
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.profile).toEqual({id:users[0],display_name:'user0'});
  });
  test('identifies the selected workspace independently of the workspaces list order', async () => {
    expect((await command(5,'snapshot')).selected_workspace_id).toBeNull();
    const older=await command(4,'create_workspace',{name:'Older workspace'});
    await command(4,'create_task',{workspaceId:older.id,title:'Older team task',ownerId:users[4]});
    const newer=await command(5,'create_workspace',{name:'Newer workspace'});
    await command(5,'create_task',{workspaceId:newer.id,title:'Selected team task',ownerId:users[5]});
    const invite=await command(4,'invite',{workspaceId:older.id,role:'member'});
    await command(5,'join_workspace',{code:invite.code});
    const snapshot=await command(5,'snapshot');
    expect(snapshot.workspaces.map((x:any)=>x.id)).toEqual([older.id,newer.id]);
    expect(snapshot.selected_workspace_id).toBe(newer.id);
    expect(snapshot.tasks.map((x:any)=>x.title)).toEqual(['Selected team task']);
    expect(snapshot.tasks.every((x:any)=>x.workspace_id===snapshot.selected_workspace_id)).toBe(true);
    expect(snapshot.members.every((x:any)=>x.workspace_id===snapshot.selected_workspace_id)).toBe(true);
    const explicit=await command(5,'snapshot',{workspaceId:older.id});
    expect(explicit.selected_workspace_id).toBe(older.id);
    expect(explicit.tasks.map((x:any)=>x.title)).toEqual(['Older team task']);
  });
  test('single-use invites, isolated teams and owner-protected membership', async () => {
    const w = await command(0,'create_workspace',{name:'Private'});
    const invite = await command(0,'invite',{workspaceId:w.id,role:'member'});
    await command(1,'join_workspace',{code:invite.code});
    await expect(command(2,'join_workspace',{code:invite.code})).rejects.toThrow(/invite/i);
    await expect(command(2,'snapshot',{workspaceId:w.id})).rejects.toThrow(/Forbidden/);
    const other = await team(2,3);
    const secretTask = await command(0,'create_task',{workspaceId:w.id,title:'Private task',ownerId:users[0]});
    await command(0,'create_record',{workspaceId:w.id,title:'Private note',occurredOn:'2026-11-06'});
    expect((await command(2,'snapshot',{workspaceId:other})).workspaces.map((x:any)=>x.id)).not.toContain(w.id);
    expect((await command(2,'snapshot',{workspaceId:other})).tasks).toEqual([]);
    expect((await asUser(2,'select * from public.wt_workspaces where id=$1',[w.id])).rows).toEqual([]);
    expect((await asUser(2,'select * from public.wt_members where workspace_id=$1',[w.id])).rows).toEqual([]);
    for (const table of ['wt_tasks','wt_records','wt_activities']) {
      expect((await asUser(2,`select * from public.${table} where workspace_id=$1`,[w.id])).rows).toEqual([]);
    }
    expect((await asUser(2,'select * from public.wt_profiles where id=$1',[users[0]])).rows).toEqual([]);
    await expect(command(2,'comment_task',{workspaceId:other,taskId:secretTask.id,comment:'Intrude'})).rejects.toThrow(/not found/i);
    await expect(command(1,'invite',{workspaceId:w.id,role:'member'})).rejects.toThrow(/Forbidden/);
    await expect(command(0,'update_member',{workspaceId:w.id,userId:users[0],role:null})).rejects.toThrow(/owner/i);
    await command(0,'update_member',{workspaceId:w.id,userId:users[1],role:'admin'});
    await expect(command(1,'invite',{workspaceId:w.id,role:'admin'})).rejects.toThrow(/Forbidden/);
    await expect(command(1,'update_member',{workspaceId:w.id,userId:users[0],role:'member'})).rejects.toThrow(/owner|Forbidden/i);
    await expect(command(1,'update_member',{workspaceId:w.id,userId:users[1],role:'member'})).rejects.toThrow(/Forbidden/);
    await command(0,'update_member',{workspaceId:w.id,userId:users[1],role:null});
    await expect(command(1,'snapshot',{workspaceId:w.id})).rejects.toThrow(/Forbidden/);
  });
  test('authenticated direct writes cannot bypass RPC permissions', async () => {
    const w = await team();
    await expect(asUser(1,"update public.wt_members set role='owner' where workspace_id=$1",[w])).rejects.toThrow(/permission denied/i);
    await expect(asUser(1,"update public.wt_profiles set display_name='spoof' where id=$1",[users[0]])).rejects.toThrow(/permission denied/i);
    await expect(asUser(1,'insert into public.wt_workspaces(name,created_by) values ($1,$2)',['spoof',users[1]])).rejects.toThrow(/permission denied/i);
    await expect(asUser(1,'delete from public.wt_members where workspace_id=$1',[w])).rejects.toThrow(/permission denied/i);
    await expect(asUser(0,'select * from public.wt_outbox')).rejects.toThrow(/permission denied/i);
    await expect(asUser(1,'select * from public.wt_feishu_codes')).rejects.toThrow(/permission denied/i);
    await expect(asUser(1,'select public.wt_insert_task($1,$2,$3::jsonb)',[w,users[0],JSON.stringify({title:'Spoofed actor',ownerId:users[1]})])).rejects.toThrow(/permission denied/i);
    await command(1,'update_profile',{displayName:'Member One'});
    expect((await command(0,'snapshot',{workspaceId:w})).members.find((x:any)=>x.user_id===users[1]).display_name).toBe('Member One');
    expect((await command(1,'snapshot',{workspaceId:w})).invites).toEqual([]);
    expect((await command(1,'snapshot',{workspaceId:w})).outbox).toEqual([]);
  });
  test('revokes permissive Supabase default grants from internal and service RPCs', async () => {
    await db.exec('reset role');
    const grants = await db.query<{internal:boolean; anon_ingress:boolean; anon_command:boolean; service_command:boolean}>(`select
      has_function_privilege('authenticated','public.wt_insert_task(uuid,uuid,jsonb,uuid)','execute') as internal,
      has_function_privilege('anon','public.wt_ingest_feishu(text,text,jsonb)','execute') as anon_ingress,
      has_function_privilege('anon','public.wt_command(text,jsonb)','execute') as anon_command,
      has_function_privilege('service_role','public.wt_command(text,jsonb)','execute') as service_command`);
    expect(grants.rows[0]).toEqual({internal:false,anon_ingress:false,anon_command:false,service_command:false});
  });
  test('enforces owner/creator workflow, versions and atomic history', async () => {
    const w = await team();
    const invite = await command(0,'invite',{workspaceId:w,role:'member'});
    await command(2,'join_workspace',{code:invite.code});
    const task = await command(1,'create_task',{workspaceId:w,title:'Deliver report',body:'Details',ownerId:users[2],priority:'high',dueDate:'2026-11-05',followUpDate:'2026-11-06',nextAction:'Draft'});
    expect(task).toMatchObject({status:'pending',version:1,created_by:users[1],owner_id:users[2]});
    await expect(command(1,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:1,status:'in_progress'})).rejects.toThrow(/Forbidden|transition/i);
    await command(2,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:1,status:'in_progress'});
    await expect(command(1,'update_task',{workspaceId:w,taskId:task.id,expectedVersion:1,title:'Stale'})).rejects.toThrow(/version|conflict/i);
    await expect(command(0,'transfer_task',{workspaceId:w,taskId:task.id,expectedVersion:2,ownerId:users[3],reason:'Elsewhere'})).rejects.toThrow(/member|owner/i);
    await command(2,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:2,status:'review'});
    await expect(command(2,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:3,status:'done'})).rejects.toThrow(/Forbidden|transition/i);
    await expect(command(1,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:3,status:'in_progress'})).rejects.toThrow(/reason/i);
    await command(1,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:3,status:'in_progress',reason:'Needs figures'});
    await expect(command(2,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:4,status:'blocked',reason:'   '})).rejects.toThrow(/reason/i);
    await command(2,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:4,status:'blocked',reason:'Waiting'});
    await command(2,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:5,status:'in_progress'});
    await command(2,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:6,status:'review'});
    await command(1,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:7,status:'done'});
    await command(1,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:8,status:'in_progress',reason:'Reopen'});
    await command(1,'transfer_task',{workspaceId:w,taskId:task.id,expectedVersion:9,ownerId:users[1],reason:'Take over'});
    await command(2,'comment_task',{workspaceId:w,taskId:task.id,comment:'Handoff complete'});
    const snapshot = await command(0,'snapshot',{workspaceId:w});
    expect(snapshot.tasks[0]).toMatchObject({status:'pending',version:10,owner_id:users[1]});
    expect(snapshot.activities).toHaveLength(11);
    expect(snapshot.activities.map((x:any)=>x.action)).toContain('comment');
    expect(snapshot.outbox).toHaveLength(11);
    expect(Object.keys(snapshot.outbox[0]).sort()).toEqual(['created_at','id','last_error','status']);
    expect((await command(2,'snapshot',{workspaceId:w})).outbox).toEqual([]);
    await expect(command(3,'comment_task',{workspaceId:w,taskId:task.id,comment:'Intrude'})).rejects.toThrow(/Forbidden/);
    await expect(asUser(1,"update public.wt_tasks set status='done' where id=$1",[task.id])).rejects.toThrow(/permission denied/i);
  });
  test('converts a record once and validates dates, enums and workspace owners', async () => {
    const w = await team();
    const record = await command(1,'create_record',{workspaceId:w,title:'Meeting note',body:'Decision',occurredOn:'2026-11-06',important:true});
    expect(record).toMatchObject({source:'manual',task_id:null,important:true});
    const task = await command(1,'record_to_task',{workspaceId:w,recordId:record.id,ownerId:users[1],priority:'normal',nextAction:'Act'});
    expect(task).toMatchObject({title:'Meeting note',body:'Decision',source_record_id:record.id});
    await expect(command(1,'record_to_task',{workspaceId:w,recordId:record.id,ownerId:users[1]})).rejects.toThrow(/already|converted/i);
    await expect(command(1,'create_task',{workspaceId:w,title:'Wrong team',ownerId:users[3]})).rejects.toThrow(/member/i);
    await expect(command(1,'create_task',{workspaceId:w,title:'Bad priority',ownerId:users[1],priority:'urgent'})).rejects.toThrow(/priority/i);
    await expect(command(1,'create_task',{workspaceId:w,title:'Bad date',ownerId:users[1],dueDate:'2026-02-31'})).rejects.toThrow();
    await expect(command(1,'create_task',{workspaceId:w,title:'x'.repeat(161),ownerId:users[1]})).rejects.toThrow(/title/i);
    await expect(command(1,'create_record',{workspaceId:w,title:'Bad bool',occurredOn:'2026-11-06',important:'false'})).rejects.toThrow(/important/i);
    const snapshot = await command(0,'snapshot',{workspaceId:w});
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0].task_id).toBe(task.id);
    expect(snapshot.activities).toHaveLength(1);
    expect(snapshot.outbox).toHaveLength(1);
  });
  test('binds Feishu once, rejects unbound events and deduplicates valid ingress', async () => {
    const w = await team();
    await expect(asUser(1,"select public.wt_ingest_feishu('x','open','{}')")).rejects.toThrow(/permission denied/i);
    expect(await ingest('unbound','open-1',{action:'task',title:'Ignore'})).toMatchObject({ignored:true});
    const binding = await command(1,'create_feishu_binding',{workspaceId:w});
    expect(binding).toMatchObject({code:expect.any(String),expires_at:expect.any(String)});
    expect(await ingest('bind-1','open-1',{action:'bind',code:binding.code})).toMatchObject({bound:true});
    expect((await command(1,'snapshot',{workspaceId:w})).feishu_bound).toBe(true);
    expect(await ingest('unbound','open-1',{action:'task',title:'Ignore'})).toEqual({ignored:true,reason:'unbound'});
    expect(await ingest('unbound','open-1',{action:'delete'})).toEqual({ignored:true,reason:'unbound'});
    await expect(ingest('unbound','different-open',{action:'task',title:'Intrude'})).rejects.toThrow(/identity conflict/i);
    await expect(ingest('bind-reuse','open-other',{action:'bind',code:binding.code})).rejects.toThrow(/code/i);
    const note = await ingest('record-1','open-1',{action:'record',title:'Chat note',body:'Body',occurredOn:'2026-11-06',important:true});
    expect(note).toMatchObject({source:'feishu',created_by:users[1]});
    const task = await ingest('task-1','open-1',{action:'task',title:'Chat task',dueDate:'2026-11-06',priority:'high',ownerId:users[3]});
    expect(task).toMatchObject({created_by:users[1],owner_id:users[1],status:'pending'});
    expect(await ingest('task-1','open-1',{action:'task',title:'Duplicate'})).toEqual(task);
    const snapshot = await command(0,'snapshot',{workspaceId:w});
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.tasks).toHaveLength(1);
    await expect(ingest('unknown-1','open-1',{action:'delete'})).rejects.toThrow(/action/i);
    await command(1,'disconnect_feishu',{workspaceId:w});
    expect(await ingest('after-unbind','open-1',{action:'task',title:'Ignore'})).toMatchObject({ignored:true});
    const next = await command(1,'create_feishu_binding',{workspaceId:w});
    await ingest('bind-2','open-2',{action:'bind',code:next.code});
    await expect(command(0,'update_member',{workspaceId:w,userId:users[1],role:null})).rejects.toThrow(/Reassign open tasks/);
    await command(1,'transfer_task',{workspaceId:w,taskId:task.id,expectedVersion:1,ownerId:users[0],reason:'Leaving'});
    await command(0,'update_member',{workspaceId:w,userId:users[1],role:null});
    expect(await ingest('after-remove','open-2',{action:'task',title:'Ignore'})).toMatchObject({ignored:true});
    expect((await command(0,'snapshot',{workspaceId:w})).tasks).toHaveLength(1);
  });
  test('leases notifications, validates tokens, deduplicates daily reminders and bounds retries', async () => {
    const w = await team();
    await db.exec('reset role');
    await db.exec("update public.wt_outbox set status='sent'");
    await db.exec("update public.wt_tasks set status='done'");
    const t = await command(1,'create_task',{workspaceId:w,title:'Overdue task',ownerId:users[1],dueDate:'2020-01-01',followUpDate:'2020-01-01'});
    await expect(asUser(1,'select public.wt_enqueue_due()')).rejects.toThrow(/permission denied/i);
    await service('select public.wt_enqueue_due()');
    await service('select public.wt_enqueue_due()');
    expect((await command(0,'snapshot',{workspaceId:w})).outbox).toHaveLength(3);
    const claimed = (await service('select * from public.wt_claim_notifications(20)')).rows as any[];
    expect(claimed).toHaveLength(3);
    expect(claimed.every(x=>x.attempts===1 && x.claim_token)).toBe(true);
    expect(claimed[0].payload).toMatchObject({title:'Overdue task',message:expect.stringContaining('Member One')});
    expect((await service('select * from public.wt_claim_notifications(20)')).rows).toEqual([]);
    await expect(service('select public.wt_finish_notification($1,$2,null)',[claimed[0].id,'99999999-9999-4999-8999-999999999999'])).rejects.toThrow(/claim|lease/i);
    await service('select public.wt_finish_notification($1,$2,null)',[claimed[0].id,claimed[0].claim_token]);
    await service('select public.wt_finish_notification($1,$2,$3)',[claimed[1].id,claimed[1].claim_token,'Missing webhook']);
    expect((await service('select * from public.wt_claim_notifications(20)')).rows).toEqual([]);
    await db.exec('reset role');
    await db.query("update public.wt_outbox set lease_until=now()-interval '1 second' where id=$1",[claimed[2].id]);
    const reclaimed = (await service('select * from public.wt_claim_notifications(20)')).rows as any[];
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].attempts).toBe(2);
    expect(reclaimed[0].claim_token).not.toBe(claimed[2].claim_token);
    await expect(service('select public.wt_finish_notification($1,$2,null)',[claimed[2].id,claimed[2].claim_token])).rejects.toThrow(/claim|lease/i);
    await service('select public.wt_finish_notification($1,$2,null)',[reclaimed[0].id,reclaimed[0].claim_token]);
    for (let attempt=2; attempt<=5; attempt++) {
      await db.exec('reset role');
      await db.query("update public.wt_outbox set available_at=now()-interval '1 second' where id=$1",[claimed[1].id]);
      const next = (await service('select * from public.wt_claim_notifications(20)')).rows as any[];
      expect(next).toHaveLength(1);
      expect(next[0].attempts).toBe(attempt);
      await service('select public.wt_finish_notification($1,$2,$3)',[next[0].id,next[0].claim_token,'Missing webhook'.repeat(200)]);
    }
    const failed = (await command(0,'snapshot',{workspaceId:w})).outbox.find((x:any)=>x.id===claimed[1].id);
    expect(failed.status).toBe('failed');
    expect(failed.last_error.length).toBeLessThanOrEqual(1000);
    await expect(command(1,'retry_notification',{workspaceId:w,notificationId:failed.id})).rejects.toThrow(/Forbidden/);
    await command(0,'retry_notification',{workspaceId:w,notificationId:failed.id});
    expect((await service('select * from public.wt_claim_notifications(20)')).rows).toHaveLength(1);
    expect(t.id).toBeTruthy();
  });
  test('a departed historical owner must be replaced before reopening a completed task', async () => {
    const w = await team();
    let task = await command(0,'create_task',{workspaceId:w,title:'Finished',ownerId:users[1]});
    for (const status of ['in_progress','review','done']) task=await command(0,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:task.version,status});
    await command(0,'update_member',{workspaceId:w,userId:users[1],role:null});
    await expect(command(0,'transition_task',{workspaceId:w,taskId:task.id,expectedVersion:task.version,status:'in_progress',reason:'More work'})).rejects.toThrow(/active|Reassign/i);
    expect((await command(0,'snapshot',{workspaceId:w})).tasks[0].status).toBe('done');
    await command(0,'transfer_task',{workspaceId:w,taskId:task.id,expectedVersion:task.version,ownerId:users[0],reason:'New owner'});
    expect((await command(0,'snapshot',{workspaceId:w})).tasks[0]).toMatchObject({status:'pending',owner_id:users[0]});
  });
  test('rolls task and history back if its notification cannot be persisted', async () => {
    const w=await team();
    await db.exec('reset role');
    await db.exec(`create function public.test_reject_outbox() returns trigger language plpgsql as $$ begin raise exception 'Injected storage failure'; end $$;
      create trigger test_reject_outbox before insert on public.wt_outbox for each row execute function public.test_reject_outbox();`);
    try {
      await expect(command(1,'create_task',{workspaceId:w,title:'Must roll back',ownerId:users[1]})).rejects.toThrow(/Injected storage failure/);
    } finally {
      await db.exec('reset role');
      await db.exec('drop trigger test_reject_outbox on public.wt_outbox; drop function public.test_reject_outbox();');
    }
    const snapshot=await command(0,'snapshot',{workspaceId:w});
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.activities).toEqual([]);
    expect(snapshot.outbox).toEqual([]);
  });
  test('cancels reminders whose current dates or queued business day are obsolete', async () => {
    const w=await team();
    await db.exec('reset role');
    await db.exec("update public.wt_outbox set status='sent'; update public.wt_tasks set status='done';");
    const postponed=await command(1,'create_task',{workspaceId:w,title:'Postponed',ownerId:users[1],dueDate:'2020-01-01',followUpDate:'2020-01-01'});
    await service('select public.wt_enqueue_due()');
    const future=((await service('select (current_date+7)::text as day')).rows[0] as any).day;
    await command(1,'update_task',{workspaceId:w,taskId:postponed.id,expectedVersion:1,dueDate:future,followUpDate:future});
    const oldDay=await command(1,'create_task',{workspaceId:w,title:'Yesterday delivery',ownerId:users[1],dueDate:'2020-01-01',followUpDate:'2020-01-01'});
    await service('select public.wt_enqueue_due()');
    await db.exec('reset role');
    await db.query("update public.wt_outbox set dedupe_key=split_part(dedupe_key,':',1)||':'||task_id::text||':'||(current_date-1)::text where task_id=$1 and dedupe_key is not null",[oldDay.id]);
    const claimed=(await service('select * from public.wt_claim_notifications(20)')).rows as any[];
    expect(claimed).toHaveLength(3); // created/updated activity notifications only
    const snapshot=await command(0,'snapshot',{workspaceId:w});
    expect(snapshot.outbox.filter((x:any)=>x.status==='cancelled')).toHaveLength(4);
    expect(snapshot.outbox.filter((x:any)=>x.status==='processing')).toHaveLength(3);
  });
});
