import { createHmac } from 'node:crypto';
import { expect, test } from 'vitest';
import { runDeliveryBatch } from '../api/_feishu/delivery.js';

const workspace = '11111111-1111-4111-8111-111111111111';
const secret = 'test-webhook-secret';
const url = 'https://open.feishu.cn/open-apis/bot/v2/hook/test-hook';
const env = { FEISHU_WORKSPACE_WEBHOOKS: JSON.stringify({ [workspace]: { url, secret } }) };
function database() {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  return { calls, rpc: async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    return { error: null, data: name === 'wt_enqueue_due' ? { enqueued: 1 } : name === 'wt_claim_notifications' ? [{ id: 'notification-id', workspace_id: workspace, payload: { title: '待办到期', message: '提交报告' }, claim_token: 'claim-123', attempts: 1 }] : { status: 'sent' } };
  } };
}

test('delivery enqueues, claims, signs a workspace webhook, and finishes the matching claim after successful response', async () => {
  const db = database();
  const requests: { url: string; options: RequestInit }[] = [];
  const fetchMock: typeof fetch = async (input, options) => {
    requests.push({ url: String(input), options: options! });
    return new Response(JSON.stringify({ code: 0 }), { status: 200 });
  };
  const result = await runDeliveryBatch(db, env, fetchMock);
  expect(result).toEqual({ enqueued: 1, claimed: 1, sent: 1, failed: 0 });
  expect(requests[0].url).toBe(url);
  expect(requests[0].options.redirect).toBe('error');
  const body = JSON.parse(String(requests[0].options.body));
  expect(body).toMatchObject({ msg_type: 'text', content: { text: '待办到期\n提交报告' } });
  expect(body.sign).toBe(createHmac('sha256', `${body.timestamp}\n${secret}`).update('').digest('base64'));
  expect(db.calls.map(call => call.name)).toEqual(['wt_enqueue_due', 'wt_claim_notifications', 'wt_finish_notification']);
  expect(db.calls[2].args).toEqual({ p_id: 'notification-id', p_claim_token: 'claim-123', p_error: null });
});

test('HTTP errors, nonzero Feishu codes, malformed responses, and network failures persist only safe retry errors', async () => {
  for (const fetchMock of [
    async () => new Response('sensitive-url-and-secret', { status: 500 }),
    async () => new Response(JSON.stringify({ code: 19021, msg: secret })),
    async () => new Response('not json'),
    async () => { throw new Error(`${url} ${secret}`); },
  ]) {
    const db = database();
    const result = await runDeliveryBatch(db, env, fetchMock as typeof fetch);
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(db.calls[2].args?.p_error).toBe('Feishu delivery failed');
    expect(JSON.stringify(db.calls)).not.toContain(secret);
    expect(JSON.stringify(db.calls)).not.toContain(url);
  }
});

test('missing or untrusted webhook configuration fails closed before database work or network calls', async () => {
  const forbidden = ['http://open.feishu.cn/open-apis/bot/v2/hook/a', 'https://open.feishu.cn.attacker.test/open-apis/bot/v2/hook/a', 'https://open.feishu.cn@attacker.test/open-apis/bot/v2/hook/a', 'https://open.feishu.cn:444/open-apis/bot/v2/hook/a', 'https://open.feishu.cn/open-apis/bot/v2/hook/a?token=secret', 'https://open.feishu.cn/open-apis/bot/v2/hook/a/extra'];
  for (const config of [undefined, 'not-json', '{}', ...forbidden.map(value => JSON.stringify({ [workspace]: { url: value, secret } }))]) {
    const db = database();
    await expect(runDeliveryBatch(db, { FEISHU_WORKSPACE_WEBHOOKS: config }, async () => { throw new Error('must not fetch'); })).rejects.toThrow('Invalid Feishu webhook configuration');
    expect(db.calls).toEqual([]);
  }
});

test('missing workspace destinations safely retry and failed claim receipt prevents a false success', async () => {
  const db = database();
  const otherWorkspace = '22222222-2222-4222-8222-222222222222';
  const result = await runDeliveryBatch(db, { FEISHU_WORKSPACE_WEBHOOKS: JSON.stringify({ [otherWorkspace]: { url, secret } }) }, async () => { throw new Error('must not fetch'); });
  expect(result.failed).toBe(1);
  expect(db.calls[2].args?.p_error).toBe('Feishu delivery failed');
  const failedDb = database();
  const boundary = { rpc: async (name: string, args?: Record<string,unknown>) => name === 'wt_finish_notification' ? { data: null, error: { message: `${url} ${secret}` } } : failedDb.rpc(name,args) };
  await expect(runDeliveryBatch(boundary, env, async () => new Response('{"code":0}'))).rejects.toThrow('Notification receipt unavailable');
});
