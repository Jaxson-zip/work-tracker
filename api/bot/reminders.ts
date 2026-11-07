import type { VercelRequest, VercelResponse } from "@vercel/node";
import { formatTaskLine } from "../_bot/responses.js";
import { hasValidBotSecret, readJsonBody, requirePost, sendJson } from "../_bot/http.js";
import { sendClawBotMessage } from "../_bot/clawbot.js";
import { getSupabaseAdmin } from "../_bot/supabaseAdmin.js";
import {
  claimReminderDelivery,
  fetchDueReminderTasks,
  getBotBindingByUserId,
  markReminderSent,
  releaseReminderClaim,
} from "../_bot/todoRepository.js";

type ReminderRequestPayload = {
  secret?: string;
};

type ReminderResult = {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  details: Array<{ itemId: string; status: "sent" | "skipped" | "failed"; reason?: string }>;
};

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (!requirePost(request, response)) return;

  let payload: ReminderRequestPayload = {};
  try {
    payload = await readJsonBody<ReminderRequestPayload>(request);
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!hasValidBotSecret(request, payload)) {
    sendJson(response, 401, { error: "Invalid bot secret" });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const dueTasks = await fetchDueReminderTasks(supabase, nowIso);
    const result: ReminderResult = { checked: dueTasks.length, sent: 0, skipped: 0, failed: 0, details: [] };

    for (const item of dueTasks) {
      if (!item.reminderAt) {
        result.skipped += 1;
        result.details.push({ itemId: item.id, status: "skipped", reason: "missing reminderAt" });
        continue;
      }

      const binding = await getBotBindingByUserId(supabase, item.userId);
      if (!binding) {
        result.skipped += 1;
        result.details.push({ itemId: item.id, status: "skipped", reason: "missing binding" });
        continue;
      }

      const claim = await claimReminderDelivery(supabase, item, binding, nowIso);
      if (claim.status === "already_sent") {
        result.skipped += 1;
        result.details.push({ itemId: item.id, status: "skipped", reason: "already sent" });
        continue;
      }
      if (claim.status === "claimed_elsewhere") {
        result.skipped += 1;
        result.details.push({ itemId: item.id, status: "skipped", reason: "claimed elsewhere" });
        continue;
      }

      const sendResult = await sendClawBotMessage(binding.provider_user_id, `提醒：${formatTaskLine(item)}\n回复“完成 ${item.title}”可以标记完成。`);
      if (sendResult.status === "sent") {
        const marked = await markReminderSent(supabase, item, claim.token, nowIso);
        if (!marked) {
          result.failed += 1;
          result.details.push({ itemId: item.id, status: "failed", reason: "claim lost before marking sent" });
          continue;
        }
        result.sent += 1;
        result.details.push({ itemId: item.id, status: "sent" });
        continue;
      }

      await releaseReminderClaim(supabase, item, claim.token);
      if (sendResult.status === "skipped") {
        result.skipped += 1;
        result.details.push({ itemId: item.id, status: "skipped", reason: sendResult.reason });
      } else {
        result.failed += 1;
        result.details.push({ itemId: item.id, status: "failed", reason: sendResult.reason });
      }
    }

    sendJson(response, 200, result);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Reminder scan failed" });
  }
}
