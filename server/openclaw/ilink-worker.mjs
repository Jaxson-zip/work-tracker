import { createClient } from "@supabase/supabase-js";
import { pollIlinkUpdates, sendIlinkMessage } from "./api-runtime/_bot/ilink.js";
import { fetchActiveIlinkConnections, updateIlinkPollState } from "./api-runtime/_bot/ilinkRepository.js";
import { handleBoundBotText } from "./api-runtime/_bot/messageProcessor.js";
import { formatTaskLine } from "./api-runtime/_bot/responses.js";
import {
  claimReminderDelivery,
  markReminderSent,
  memoItemFromRow,
  releaseReminderClaim,
} from "./api-runtime/_bot/todoRepository.js";

const supabaseUrl = requiredEnv("VITE_SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const connectionLimit = numberEnv("TODO_ILINK_CONNECTION_LIMIT", 50);
const reminderLimit = numberEnv("TODO_ILINK_REMINDER_LIMIT", 50);
const dryRun = process.env.TODO_ILINK_DRY_RUN === "1";
const remindersOnly = process.env.TODO_ILINK_REMINDERS_ONLY === "1";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const result = await runIlinkWorker();
console.log(JSON.stringify(result));

async function runIlinkWorker() {
  const result = {
    connections: 0,
    messages: 0,
    repliesSent: 0,
    remindersChecked: 0,
    remindersSent: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  const connections = await fetchActiveIlinkConnections(supabase, connectionLimit);
  result.connections = connections.length;

  await sendDueReminders(connections, result);
  if (remindersOnly) return result;

  for (const connection of connections) {
    await pollConnection(connection, result);
  }

  await sendDueReminders(connections, result);
  return result;
}

async function pollConnection(connection, result) {
  const credentials = credentialsFromConnection(connection);

  try {
    const poll = await pollIlinkUpdates(credentials, connection.get_updates_buf || "");
    let replyToUserId;
    let contextToken;
    let lastError = null;

    for (const message of poll.messages) {
      result.messages += 1;
      replyToUserId = message.fromUserId;
      contextToken = message.contextToken;

      const reply = await handleBoundBotText(supabase, connection.user_id, message.fromUserId, message.text, {
        reminderProvider: "ilink",
      });
      if (!reply) continue;

      const sendResult = dryRun
        ? { status: "sent" }
        : await sendIlinkMessage(credentials, message.fromUserId, message.contextToken, reply);
      if (sendResult.status === "sent") {
        result.repliesSent += 1;
        continue;
      }

      result.failed += 1;
      lastError =
        sendResult.status === "context_expired"
          ? "微信回复上下文已过期，请先给插件发一句话。"
          : sendResult.reason;
      result.details.push({
        connectionId: connection.id,
        status: "reply_failed",
        reason: lastError,
      });
    }

    await updateIlinkPollState(supabase, connection.id, {
      cursor: poll.cursor,
      replyToUserId,
      contextToken,
      status: "connected",
      lastError,
    });
    connection.get_updates_buf = poll.cursor;
    if (replyToUserId) connection.reply_to_user_id = replyToUserId;
    if (contextToken) connection.context_token = contextToken;
  } catch (error) {
    result.failed += 1;
    const reason = error instanceof Error ? error.message : String(error);
    result.details.push({ connectionId: connection.id, status: "poll_failed", reason });
    await updateIlinkPollState(supabase, connection.id, {
      status: "error",
      lastError: reason,
    }).catch((updateError) => {
      console.error(updateError);
    });
  }
}

async function sendDueReminders(connections, result) {
  const nowIso = new Date().toISOString();
  const dueTasks = await fetchDueReminderTasks(nowIso, reminderLimit);
  result.remindersChecked += dueTasks.length;
  const connectionByUserId = new Map(connections.map((connection) => [connection.user_id, connection]));

  for (const row of dueTasks) {
    const connection = connectionByUserId.get(row.user_id);
    if (!connection) {
      result.skipped += 1;
      result.details.push({ itemId: row.id, status: "skipped", reason: "missing ilink connection" });
      continue;
    }

    if (!connection.reply_to_user_id || !connection.context_token) {
      result.skipped += 1;
      result.details.push({ itemId: row.id, status: "skipped", reason: "missing reply context" });
      continue;
    }

    const item = memoItemFromRow(row);
    const binding = {
      provider: "ilink",
      provider_user_id: connection.reply_to_user_id,
      user_id: connection.user_id,
    };
    const claim = await claimReminderDelivery(supabase, item, binding, nowIso);
    if (claim.status !== "claimed") {
      result.skipped += 1;
      result.details.push({ itemId: item.id, status: "skipped", reason: claim.status });
      continue;
    }

    const message = `提醒：${formatTaskLine(item)}\n回复“完成 ${item.title}”可以标记完成。`;
    const sendResult = dryRun
      ? { status: "sent" }
      : await sendIlinkMessage(
          credentialsFromConnection(connection),
          connection.reply_to_user_id,
          connection.context_token,
          message
        );

    if (sendResult.status === "sent") {
      const marked = await markReminderSent(supabase, item, claim.token, nowIso, "ilink");
      if (marked) {
        result.remindersSent += 1;
        result.details.push({ itemId: item.id, status: "reminder_sent" });
      } else {
        result.failed += 1;
        result.details.push({ itemId: item.id, status: "failed", reason: "claim lost before marking sent" });
      }
      continue;
    }

    await releaseReminderClaim(supabase, item, claim.token, "ilink");
    result.failed += 1;
    const reason =
      sendResult.status === "context_expired"
        ? "微信回复上下文已过期，请先给插件发一句话。"
        : sendResult.reason;
    result.details.push({ itemId: item.id, status: "failed", reason });
    await updateIlinkPollState(supabase, connection.id, { status: "connected", lastError: reason }).catch(
      (error) => {
        console.error(error);
      }
    );
  }
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

function credentialsFromConnection(connection) {
  return {
    botToken: connection.bot_token,
    baseUrl: connection.base_url,
    wechatUin: connection.wechat_uin,
  };
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
