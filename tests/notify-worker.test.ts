import { expect, test } from "vitest";
// @ts-expect-error Standalone Node worker intentionally has no build dependency.
import { runWorkerOnce } from "../server/notification-worker.mjs";

test("standalone scheduled worker authenticates one HTTPS dispatch and never follows redirects", async () => {
  let request: RequestInit | undefined;
  const endpoint = "https://tracker.example/api/notify/dispatch";
  await runWorkerOnce({ DISPATCH_URL: endpoint, CRON_SECRET: "private-cron-token" }, async (input: unknown, options: RequestInit) => {
    expect(input).toBe(endpoint);
    request = options;
    return new Response(JSON.stringify({ claimed: 0, sent: 0, failed: 0 }));
  });
  expect(request).toMatchObject({ method: "POST", redirect: "error", headers: { authorization: "Bearer private-cron-token" } });
  await expect(
    runWorkerOnce({ DISPATCH_URL: "http://tracker.example/api/notify/dispatch", CRON_SECRET: "private-cron-token" }),
  ).rejects.toThrow("Invalid dispatcher configuration");
});
