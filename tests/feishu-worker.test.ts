import { expect, test } from 'vitest';
// @ts-expect-error Standalone Node worker intentionally has no build dependency.
import { runWorkerOnce } from '../server/feishu/notification-worker.mjs';

test('standalone scheduled worker authenticates one HTTPS dispatch and never follows redirects', async () => {
  let request: RequestInit | undefined;
  const endpoint = 'https://tracker.example/api/feishu/dispatch';
  await runWorkerOnce({ FEISHU_DISPATCH_URL: endpoint, CRON_SECRET: 'private-cron-token' }, async (input: unknown, options: RequestInit) => {
    expect(input).toBe(endpoint);
    request = options;
    return new Response(JSON.stringify({ claimed: 0, sent: 0, failed: 0 }));
  });
  expect(request).toMatchObject({ method: 'POST', redirect: 'error', headers: { authorization: 'Bearer private-cron-token' } });
  await expect(runWorkerOnce({ FEISHU_DISPATCH_URL: 'http://tracker.example/api/feishu/dispatch', CRON_SECRET: 'private-cron-token' })).rejects.toThrow('Invalid dispatcher configuration');
});
