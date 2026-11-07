import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);

const supabaseUrl = requiredEnv("VITE_SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const channel = process.env.OPENCLAW_CHANNEL?.trim() || "openclaw-weixin";
const account = process.env.OPENCLAW_ACCOUNT?.trim() || "default";
const openclawBin = process.env.OPENCLAW_BIN?.trim() || "openclaw";
const limit = Number(process.env.TODO_REMINDER_LIMIT ?? 50);
const dryRun = process.env.TODO_REMINDER_DRY_RUN === "1";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const result = await runReminderWorker();
console.log(JSON.stringify(result));

async function runReminderWorker() {
  const nowIso = new Date().toISOString();
  const dueTasks = await fetchDueReminderTasks(nowIso, Number.isFinite(limit) ? limit : 50);
  const result = { checked: dueTasks.length, sent: 0, skipped: 0, failed: 0, details: [] };

  for (const item of dueTasks) {
    const binding = await getBotBindingByUserId(item.user_id);
    if (!binding) {
      result.skipped += 1;
      result.details.push({ itemId: item.id, status: "skipped", reason: "missing binding" });
      continue;
    }

    const claim = await claimReminderDelivery(item, binding, nowIso);
    if (claim.status !== "claimed") {
      result.skipped += 1;
      result.details.push({ itemId: item.id, status: "skipped", reason: claim.status });
      continue;
    }

    const message = `提醒：${formatTaskLine(item)}\n回复“完成 ${item.title}”可以标记完成。`;
    const sendResult = await sendOpenClawMessage(binding.provider_user_id, message);
    if (sendResult.status === "sent") {
      const marked = await markReminderSent(item, claim.token, nowIso);
      if (marked) {
        result.sent += 1;
        result.details.push({ itemId: item.id, status: "sent" });
      } else {
        result.failed += 1;
        result.details.push({ itemId: item.id, status: "failed", reason: "claim lost before marking sent" });
      }
      continue;
    }

    await releaseReminderClaim(item, claim.token);
    result.failed += 1;
    result.details.push({ itemId: item.id, status: "failed", reason: sendResult.reason });
  }

  return result;
}

async function fetchDueReminderTasks(nowIso, rowLimit) {
  const { data, error } = await supabase
    .from("memo_items")
    .select("*")
    .eq("kind", "task")
    .eq("status", "open")
    .eq("archived", false)
    .is("deleted_at", null)
    .not("reminder_at", "is", null)
    .lte("reminder_at", nowIso)
    .order("reminder_at", { ascending: true })
    .limit(rowLimit);

  if (error) throw error;
  return data ?? [];
}

async function getBotBindingByUserId(userId) {
  const { data, error } = await supabase
    .from("bot_bindings")
    .select("provider, provider_user_id, user_id")
    .eq("provider", "clawbot")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function getReminderEvent(item) {
  const { data, error } = await supabase
    .from("bot_reminder_events")
    .select("*")
    .eq("provider", "clawbot")
    .eq("item_id", item.id)
    .eq("reminder_at", item.reminder_at)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function claimReminderDelivery(item, binding, nowIso) {
  const token = randomUUID();
  const claimExpiresAt = new Date(new Date(nowIso).getTime() + 2 * 60_000).toISOString();
  const { error } = await supabase.from("bot_reminder_events").insert({
    item_id: item.id,
    user_id: binding.user_id,
    provider: "clawbot",
    provider_user_id: binding.provider_user_id,
    reminder_at: item.reminder_at,
    attempted_at: nowIso,
    claim_token: token,
    claim_expires_at: claimExpiresAt,
  });

  if (!error) return { status: "claimed", token };
  if (error.code !== "23505") throw error;

  const existing = await getReminderEvent(item);
  if (existing?.sent_at) return { status: "already_sent" };
  if (existing?.claim_expires_at && new Date(existing.claim_expires_at).getTime() > new Date(nowIso).getTime()) {
    return { status: "claimed_elsewhere" };
  }

  const query = supabase
    .from("bot_reminder_events")
    .update({
      attempted_at: nowIso,
      claim_token: token,
      claim_expires_at: claimExpiresAt,
    })
    .eq("provider", "clawbot")
    .eq("item_id", item.id)
    .eq("reminder_at", item.reminder_at)
    .is("sent_at", null);

  const { data, error: updateError } = await (existing?.claim_expires_at
    ? query.lte("claim_expires_at", nowIso)
    : query.is("claim_expires_at", null)
  )
    .select("id")
    .maybeSingle();

  if (updateError) throw updateError;
  return data ? { status: "claimed", token } : { status: "claimed_elsewhere" };
}

async function markReminderSent(item, claimToken, sentAt) {
  const { data, error } = await supabase
    .from("bot_reminder_events")
    .update({
      sent_at: sentAt,
      claim_token: null,
      claim_expires_at: null,
    })
    .eq("provider", "clawbot")
    .eq("item_id", item.id)
    .eq("reminder_at", item.reminder_at)
    .eq("claim_token", claimToken)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function releaseReminderClaim(item, claimToken) {
  const { error } = await supabase
    .from("bot_reminder_events")
    .update({
      claim_token: null,
      claim_expires_at: null,
    })
    .eq("provider", "clawbot")
    .eq("item_id", item.id)
    .eq("reminder_at", item.reminder_at)
    .eq("claim_token", claimToken);

  if (error) throw error;
}

async function sendOpenClawMessage(target, message) {
  if (dryRun) return { status: "sent" };

  try {
    await execFileAsync(
      openclawBin,
      ["message", "send", "--channel", channel, "--account", account, "--target", target, "--message", message, "--json"],
      { timeout: 45_000, windowsHide: true }
    );
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

function formatTaskLine(item) {
  const when = item.reminder_at ? formatDateTime(item.reminder_at) : item.due_date ?? "无日期";
  return `${when} ${item.title}`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env.BOT_TIME_ZONE || "Asia/Shanghai",
  }).format(new Date(value));
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
