import { beforeAll, afterAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

const users = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
];
let db: PGlite;
async function asUser(index: number, sql: string, params: unknown[] = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[index]]);
  await db.exec("set role authenticated");
  return db.query(sql, params);
}
async function command(index: number, action: string, payload = {}): Promise<any> {
  const r = await asUser(index, "select public.wt_command($1, $2::jsonb) as result", [action, JSON.stringify(payload)]);
  return (r.rows[0] as any).result;
}
async function team(owner = 0, member = 1) {
  const w = await command(owner, "create_workspace", { name: "Team" });
  const invite = await command(owner, "invite", { workspaceId: w.id, role: "member" });
  await command(member, "join_workspace", { code: invite.code });
  return w.id as string;
}
async function service(sql: string, params: unknown[] = []) {
  await db.exec("reset role");
  await db.exec("set role service_role");
  return db.query(sql, params);
}
async function ingest(event: string, open: string, payload: object): Promise<any> {
  const response = await service("select public.wt_ingest_feishu($1,$2,$3::jsonb) result", [event, open, JSON.stringify(payload)]);
  return (response.rows[0] as any).result;
}
beforeAll(async () => {
  db = await createTestDatabase(users);
}, 60_000);
afterAll(async () => {
  await db?.close();
});
describe("transactional team database", () => {
  test("creates an owned team and exposes a complete snapshot", async () => {
    const workspace = await command(0, "create_workspace", { name: "Alpha" });
    const snapshot = await command(0, "snapshot", { workspaceId: workspace.id });
    expect(snapshot.workspaces).toContainEqual(expect.objectContaining({ id: workspace.id, name: "Alpha" }));
    expect(snapshot.members).toContainEqual(expect.objectContaining({ user_id: users[0], role: "owner", display_name: "user0" }));
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.profile).toEqual({ id: users[0], display_name: "user0" });
  });
  test("identifies the selected workspace independently of the workspaces list order", async () => {
    expect((await command(5, "snapshot")).selected_workspace_id).toBeNull();
    const older = await command(4, "create_workspace", { name: "Older workspace" });
    await command(4, "create_task", { workspaceId: older.id, title: "Older team task", ownerId: users[4] });
    const newer = await command(5, "create_workspace", { name: "Newer workspace" });
    await command(5, "create_task", { workspaceId: newer.id, title: "Selected team task", ownerId: users[5] });
    const invite = await command(4, "invite", { workspaceId: older.id, role: "member" });
    await command(5, "join_workspace", { code: invite.code });
    const snapshot = await command(5, "snapshot");
    expect(snapshot.workspaces.map((x: any) => x.id)).toEqual([older.id, newer.id]);
    expect(snapshot.selected_workspace_id).toBe(newer.id);
    expect(snapshot.tasks.map((x: any) => x.title)).toEqual(["Selected team task"]);
    expect(snapshot.tasks.every((x: any) => x.workspace_id === snapshot.selected_workspace_id)).toBe(true);
    expect(snapshot.members.every((x: any) => x.workspace_id === snapshot.selected_workspace_id)).toBe(true);
    const explicit = await command(5, "snapshot", { workspaceId: older.id });
    expect(explicit.selected_workspace_id).toBe(older.id);
    expect(explicit.tasks.map((x: any) => x.title)).toEqual(["Older team task"]);
  });
  test("single-use invites, isolated teams and owner-protected membership", async () => {
    const w = await command(0, "create_workspace", { name: "Private" });
    const invite = await command(0, "invite", { workspaceId: w.id, role: "member" });
    await command(1, "join_workspace", { code: invite.code });
    await expect(command(2, "join_workspace", { code: invite.code })).rejects.toThrow(/invite/i);
    await expect(command(2, "snapshot", { workspaceId: w.id })).rejects.toThrow(/Forbidden/);
    const other = await team(2, 3);
    const secretTask = await command(0, "create_task", { workspaceId: w.id, title: "Private task", ownerId: users[0] });
    await command(0, "create_record", { workspaceId: w.id, title: "Private note", occurredOn: "2026-11-06" });
    expect((await command(2, "snapshot", { workspaceId: other })).workspaces.map((x: any) => x.id)).not.toContain(w.id);
    expect((await command(2, "snapshot", { workspaceId: other })).tasks).toEqual([]);
    expect((await asUser(2, "select * from public.wt_workspaces where id=$1", [w.id])).rows).toEqual([]);
    expect((await asUser(2, "select * from public.wt_members where workspace_id=$1", [w.id])).rows).toEqual([]);
    for (const table of ["wt_tasks", "wt_records", "wt_activities"]) {
      expect((await asUser(2, `select * from public.${table} where workspace_id=$1`, [w.id])).rows).toEqual([]);
    }
    expect((await asUser(2, "select * from public.wt_profiles where id=$1", [users[0]])).rows).toEqual([]);
    await expect(command(2, "comment_task", { workspaceId: other, taskId: secretTask.id, comment: "Intrude" })).rejects.toThrow(
      /not found/i,
    );
    await expect(command(1, "invite", { workspaceId: w.id, role: "member" })).rejects.toThrow(/Forbidden/);
    await expect(command(0, "update_member", { workspaceId: w.id, userId: users[0], role: null })).rejects.toThrow(/owner/i);
    await command(0, "update_member", { workspaceId: w.id, userId: users[1], role: "admin" });
    await expect(command(1, "invite", { workspaceId: w.id, role: "admin" })).rejects.toThrow(/Forbidden/);
    await expect(command(1, "update_member", { workspaceId: w.id, userId: users[0], role: "member" })).rejects.toThrow(/owner|Forbidden/i);
    await expect(command(1, "update_member", { workspaceId: w.id, userId: users[1], role: "member" })).rejects.toThrow(/Forbidden/);
    await command(0, "update_member", { workspaceId: w.id, userId: users[1], role: null });
    await expect(command(1, "snapshot", { workspaceId: w.id })).rejects.toThrow(/Forbidden/);
  });
  test("authenticated direct writes cannot bypass RPC permissions", async () => {
    const w = await team();
    await expect(asUser(1, "update public.wt_members set role='owner' where workspace_id=$1", [w])).rejects.toThrow(/permission denied/i);
    await expect(asUser(1, "update public.wt_profiles set display_name='spoof' where id=$1", [users[0]])).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asUser(1, "insert into public.wt_workspaces(name,created_by) values ($1,$2)", ["spoof", users[1]])).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asUser(1, "delete from public.wt_members where workspace_id=$1", [w])).rejects.toThrow(/permission denied/i);
    await expect(asUser(0, "select * from public.wt_outbox")).rejects.toThrow(/permission denied/i);
    await expect(asUser(1, "select * from public.wt_feishu_codes")).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(1, "select public.wt_insert_task($1,$2,$3::jsonb)", [
        w,
        users[0],
        JSON.stringify({ title: "Spoofed actor", ownerId: users[1] }),
      ]),
    ).rejects.toThrow(/permission denied/i);
    await command(1, "update_profile", { displayName: "Member One" });
    expect((await command(0, "snapshot", { workspaceId: w })).members.find((x: any) => x.user_id === users[1]).display_name).toBe(
      "Member One",
    );
    expect((await command(1, "snapshot", { workspaceId: w })).invites).toEqual([]);
    expect((await command(1, "snapshot", { workspaceId: w })).outbox).toEqual([]);
  });
  test("revokes permissive Supabase default grants from internal and service RPCs", async () => {
    await db.exec("reset role");
    const grants = await db.query<{ internal: boolean; anon_ingress: boolean; anon_command: boolean; service_command: boolean }>(`select
      has_function_privilege('authenticated','public.wt_task_command(text,jsonb,uuid,uuid,text)','execute') as internal,
      has_function_privilege('anon','public.wt_ingest_feishu(text,text,jsonb)','execute') as anon_ingress,
      has_function_privilege('anon','public.wt_command(text,jsonb)','execute') as anon_command,
      has_function_privilege('service_role','public.wt_command(text,jsonb)','execute') as service_command`);
    expect(grants.rows[0]).toEqual({ internal: false, anon_ingress: false, anon_command: false, service_command: false });
  });
  test("converts a record once and validates dates, enums and workspace owners", async () => {
    const w = await team();
    const record = await command(1, "create_record", {
      workspaceId: w,
      title: "Meeting note",
      body: "Decision",
      occurredOn: "2026-11-06",
      important: true,
    });
    expect(record).toMatchObject({ source: "manual", task_id: null, important: true });
    const task = await command(1, "record_to_task", {
      workspaceId: w,
      recordId: record.id,
      ownerId: users[1],
      priority: "normal",
      nextAction: "Act",
    });
    expect(task).toMatchObject({ title: "Meeting note", body: "Decision", source_record_id: record.id });
    await expect(command(1, "record_to_task", { workspaceId: w, recordId: record.id, ownerId: users[1] })).rejects.toThrow(
      /already|converted/i,
    );
    await expect(command(1, "create_task", { workspaceId: w, title: "Wrong team", ownerId: users[3] })).rejects.toThrow(/member/i);
    await expect(
      command(1, "create_task", { workspaceId: w, title: "Bad priority", ownerId: users[1], priority: "urgent" }),
    ).rejects.toThrow(/priority/i);
    await expect(
      command(1, "create_task", { workspaceId: w, title: "Bad date", ownerId: users[1], dueDate: "2026-02-31" }),
    ).rejects.toThrow();
    await expect(command(1, "create_task", { workspaceId: w, title: "x".repeat(161), ownerId: users[1] })).rejects.toThrow(/title/i);
    await expect(
      command(1, "create_record", { workspaceId: w, title: "Bad bool", occurredOn: "2026-11-06", important: "false" }),
    ).rejects.toThrow(/important/i);
    const snapshot = await command(0, "snapshot", { workspaceId: w });
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0].task_id).toBe(task.id);
    expect(snapshot.activities).toHaveLength(1);
    expect(snapshot.outbox).toHaveLength(0); // 自己给自己记的事不发通知
  });
  test("binds Feishu once, rejects unbound events and deduplicates valid ingress", async () => {
    const w = await team();
    await expect(asUser(1, "select public.wt_ingest_feishu('x','open','{}')")).rejects.toThrow(/permission denied/i);
    expect(await ingest("unbound", "open-1", { action: "task", title: "Ignore" })).toMatchObject({ ignored: true });
    const binding = await command(1, "create_feishu_binding", { workspaceId: w });
    expect(binding).toMatchObject({ code: expect.stringMatching(/^WT-/), expires_at: expect.any(String) });
    expect(await ingest("bind-1", "open-1", { action: "bind", code: binding.code })).toMatchObject({ bound: true });
    expect((await command(1, "snapshot", { workspaceId: w })).feishu_bound).toBe(true);
    expect(await ingest("unbound", "open-1", { action: "task", title: "Ignore" })).toEqual({ ignored: true, reason: "unbound" });
    expect(await ingest("unbound", "open-1", { action: "delete" })).toEqual({ ignored: true, reason: "unbound" });
    await expect(ingest("unbound", "different-open", { action: "task", title: "Intrude" })).rejects.toThrow(/identity conflict/i);
    await expect(ingest("bind-reuse", "open-other", { action: "bind", code: binding.code })).rejects.toThrow(/code/i);
    const note = await ingest("record-1", "open-1", {
      action: "record",
      title: "Chat note",
      body: "Body",
      occurredOn: "2026-11-06",
      important: true,
    });
    expect(note).toMatchObject({ source: "feishu", created_by: users[1] });
    const task = await ingest("task-1", "open-1", {
      action: "task",
      title: "Chat task",
      dueDate: "2026-11-06",
      priority: "high",
      ownerId: users[3],
    });
    expect(task).toMatchObject({ created_by: users[1], owner_id: users[1], status: "pending" });
    expect(await ingest("task-1", "open-1", { action: "task", title: "Duplicate" })).toEqual(task);
    const snapshot = await command(0, "snapshot", { workspaceId: w });
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.tasks).toHaveLength(1);
    await expect(ingest("unknown-1", "open-1", { action: "delete" })).rejects.toThrow(/action/i);
    await command(1, "disconnect_feishu", { workspaceId: w });
    expect(await ingest("after-unbind", "open-1", { action: "task", title: "Ignore" })).toMatchObject({ ignored: true });
    const next = await command(1, "create_feishu_binding", { workspaceId: w });
    await ingest("bind-2", "open-2", { action: "bind", code: next.code });
    await expect(command(0, "update_member", { workspaceId: w, userId: users[1], role: null })).rejects.toThrow(/Reassign open tasks/);
    await command(1, "transfer_task", { workspaceId: w, taskId: task.id, expectedVersion: 1, ownerId: users[0], reason: "Leaving" });
    await expect(command(0, "update_member", { workspaceId: w, userId: users[1], role: null })).rejects.toThrow(/Reassign open tasks/); // 对方接收前仍归原负责人
    await command(0, "accept_transfer", { workspaceId: w, taskId: task.id });
    await command(0, "update_member", { workspaceId: w, userId: users[1], role: null });
    expect(await ingest("after-remove", "open-2", { action: "task", title: "Ignore" })).toMatchObject({ ignored: true });
    expect((await command(0, "snapshot", { workspaceId: w })).tasks).toHaveLength(1);
  });
});
