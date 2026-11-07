import { pathToFileURL } from 'node:url';

/** One invocation per scheduled minute; secrets stay in process environment. */
export async function runWorkerOnce(env = process.env, fetchImpl = fetch) {
  let endpoint;
  try {
    endpoint = new URL(env.FEISHU_DISPATCH_URL);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/api/feishu/dispatch' || !env.CRON_SECRET) throw new Error();
  } catch { throw new Error('Invalid dispatcher configuration'); }
  try {
    const response = await fetchImpl(endpoint.href, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (!result || typeof result.claimed !== 'number' || typeof result.failed !== 'number' || result.failed > 0) throw new Error();
    return { claimed: result.claimed, sent: result.sent, failed: result.failed };
  } catch { throw new Error('Feishu notification dispatch failed'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWorkerOnce().then(() => console.log('Feishu notification dispatch completed')).catch(() => {
    console.error('Feishu notification dispatch failed; check configuration and queue status');
    process.exitCode = 1;
  });
}
