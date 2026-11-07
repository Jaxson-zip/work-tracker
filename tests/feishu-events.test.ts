import { createCipheriv, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { expect, test } from 'vitest';
import { createEventsHandler } from '../api/feishu/events.js';

const now = new Date('2026-11-06T23:30:00Z');
const env = { FEISHU_ENCRYPT_KEY: 'test-encryption-key', FEISHU_VERIFICATION_TOKEN: 'verified-token' };
function signed(payload: unknown, overrides: Record<string, string> = {}) {
  const iv = Buffer.alloc(16, 7);
  const cipher = createCipheriv('aes-256-cbc', createHash('sha256').update(env.FEISHU_ENCRYPT_KEY).digest(), iv);
  const encrypt = Buffer.concat([iv, cipher.update(JSON.stringify(payload)), cipher.final()]).toString('base64');
  const body = ` { "encrypt": ${JSON.stringify(encrypt)} } `;
  const timestamp = String(now.getTime() / 1000);
  const nonce = 'test-nonce';
  const signature = createHash('sha256').update(timestamp + nonce + env.FEISHU_ENCRYPT_KEY).update(body).digest('hex');
  return { body, headers: { 'x-lark-request-timestamp': timestamp, 'x-lark-request-nonce': nonce, 'x-lark-signature': signature, ...overrides } };
}
async function invoke(payload: unknown, options: { headers?: Record<string,string>; env?: object; raw?: string; rpcError?: unknown } = {}) {
  const packet = signed(payload, options.headers);
  const request = Object.assign(Readable.from([Buffer.from(options.raw ?? packet.body)]), { method: 'POST', headers: packet.headers });
  let status = 0;
  let json: any;
  const calls: { name: string; args: any }[] = [];
  const response: any = { status(code: number) { status = code; return this; }, setHeader() { return this; }, json(value: unknown) { json = value; return this; } };
  const handler = createEventsHandler({ env: options.env ?? env, now: () => now, getClient: () => ({ rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: { ok: true }, error: options.rpcError ?? null }; } }) });
  await handler(request as any, response);
  return { status, json, calls };
}

test('authenticated encrypted URL verification returns the exact challenge without database access', async () => {
  const result = await invoke({ type: 'url_verification', token: env.FEISHU_VERIFICATION_TOKEN, challenge: 'challenge-value' });
  expect(result).toEqual({ status: 200, json: { challenge: 'challenge-value' }, calls: [] });
});

function message(text: string, extra: object = {}) {
  return { schema: '2.0', header: { token: env.FEISHU_VERIFICATION_TOKEN, event_id: 'event-1', event_type: 'im.message.receive_v1' }, event: { sender: { sender_type: 'user', sender_id: { open_id: 'ou_member' } }, message: { message_id: 'om_message', message_type: 'text', chat_type: 'p2p', content: JSON.stringify({ text }), ...extra } } };
}

test('authenticated commands use the verified sender and stable message identity with timezone-correct task dates', async () => {
  const result = await invoke(message('待办 明天9点 提交报告'));
  expect(result.status).toBe(200);
  expect(result.calls).toEqual([{ name: 'wt_ingest_feishu', args: {
    p_event_id: 'message:om_message', p_open_id: 'ou_member',
    p_payload: { action: 'task', title: '提交报告', body: '明天9点 提交报告', dueDate: '2026-11-08', nextAction: '', followUpDate: null, priority: 'normal' },
  } }]);
});

test('rejects wrong/stale signatures, edited raw bytes, wrong tokens and missing settings before database access', async () => {
  const payload = { type: 'url_verification', token: env.FEISHU_VERIFICATION_TOKEN, challenge: 'secret' };
  for (const [body, options, status] of [
    [payload, { headers: { 'x-lark-signature': '0'.repeat(64) } }, 401],
    [payload, { headers: { 'x-lark-request-timestamp': String(now.getTime() / 1000 - 301) } }, 401],
    [payload, { headers: { 'x-lark-request-timestamp': String(now.getTime() / 1000 + 301) } }, 401],
    [payload, { raw: signed(payload).body + ' ' }, 401],
    [{ ...payload, token: 'wrong' }, {}, 401],
    [{ ...payload, token: 123 }, {}, 401],
    [payload, { env: {} }, 503],
  ] as const) {
    const result = await invoke(body, options);
    expect(result.status).toBe(status);
    expect(result.calls).toEqual([]);
    expect(JSON.stringify(result.json)).not.toContain('secret');
  }
});

test('only explicit direct-message text commands ingest, while bind codes and record text stay literal', async () => {
  for (const payload of [message('hello'), message('记录 image', { message_type: 'image' }), message('记录 group', { chat_type: 'group' }), { ...message('记录 unsupported'), header: { token: env.FEISHU_VERIFICATION_TOKEN, event_type: 'other' } }]) {
    expect((await invoke(payload)).calls).toEqual([]);
  }
  const binding = await invoke(message('绑定 WT-a_B-123!'));
  expect(binding.calls[0].args.p_payload).toEqual({ action: 'bind', code: 'WT-a_B-123!' });
  const record = await invoke(message('记录 userId=admin workspaceId=other 完成会议'));
  expect(record.calls[0].args).toMatchObject({ p_open_id: 'ou_member', p_payload: { action: 'record', title: 'userId=admin workspaceId=other 完成会议', body: 'userId=admin workspaceId=other 完成会议', occurredOn: '2026-11-07', important: false } });
  expect(record.calls[0].args.p_payload).not.toHaveProperty('workspaceId');
});

test('database errors are retryable without exposing internal details and explicit IANA time zones control record dates', async () => {
  const failed = await invoke(message('记录 内容'), { rpcError: { message: 'SUPABASE_SERVICE_ROLE_KEY=private-service-secret' } });
  expect(failed.status).toBe(503);
  expect(JSON.stringify(failed.json)).not.toContain('private-service-secret');
  const result = await invoke(message('记录 内容'), { env: { ...env, FEISHU_TIME_ZONE: 'America/Los_Angeles' } });
  expect(result.calls[0].args.p_payload.occurredOn).toBe('2026-11-06');
  const invalidZone = await invoke(message('任务 明天9点 内容'), { env: { ...env, FEISHU_TIME_ZONE: 'Invalid/Zone' } });
  expect(invalidZone.status).toBe(503);
  expect(invalidZone.calls).toEqual([]);
});
