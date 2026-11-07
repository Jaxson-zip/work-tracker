import { expect, test } from 'vitest';
import { createDispatchHandler } from '../api/feishu/dispatch.js';

test('dispatch requires a configured matching bearer secret before queue access', async () => {
  for (const [secret, bearer, expected] of [['cron-secret', 'wrong', 401], ['', 'anything', 503], ['cron-secret', 'cron-secret', 200]] as const) {
    const calls: string[] = [];
    let status = 0;
    let body: any;
    const handler = createDispatchHandler({ env: { CRON_SECRET: secret, FEISHU_WORKSPACE_WEBHOOKS: JSON.stringify({ '11111111-1111-4111-8111-111111111111': { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test', secret: 'sign-secret' } }) }, getClient: () => ({ rpc: async (name: string) => { calls.push(name); return { error: null, data: name === 'wt_claim_notifications' ? [] : { enqueued: 0 } }; } }) });
    const response: any = { status(value: number) { status = value; return this; }, setHeader() { return this; }, json(value: unknown) { body = value; return this; } };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${bearer}` } } as any, response);
    expect(status).toBe(expected);
    expect(calls).toEqual(expected === 200 ? ['wt_enqueue_due', 'wt_claim_notifications'] : []);
    expect(JSON.stringify(body)).not.toContain('cron-secret');
  }
});
