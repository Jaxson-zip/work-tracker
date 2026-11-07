import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBotIntent, type BotIntent } from "./intent.js";
import {
  formatCompletedReply,
  formatCreatedNoteReply,
  formatCreatedTaskReply,
  formatCreatedTasksReply,
  formatDeletedReply,
  formatTaskListReply,
} from "./responses.js";
import { findBestOpenTaskMatch, sortOpenTasksForBot } from "./taskMatcher.js";
import { dateKeyInBotTimeZone } from "./time.js";
import {
  type BotProvider,
  completeMostRecentReminder,
  createNoteFromIntent,
  createTaskFromIntent,
  fetchOpenTasks,
  markTaskDone,
  snoozeMostRecentReminder,
  softDeleteOpenTasks,
  softDeleteTask,
} from "./todoRepository.js";

type BotProcessorOptions = {
  reminderProvider?: BotProvider;
};

export async function handleBoundBotText(
  supabase: SupabaseClient,
  userId: string,
  senderId: string,
  text: string,
  options?: BotProcessorOptions
): Promise<string> {
  return handleBoundIntent(supabase, userId, senderId, parseBotIntent(text), options);
}

export async function handleBoundIntent(
  supabase: SupabaseClient,
  userId: string,
  senderId: string,
  intent: BotIntent,
  options?: BotProcessorOptions
): Promise<string> {
  if (intent.type === "unknown") return "我还没看懂这句话。可以试试：今天任务、任务列表、完成 xxx、删除 xxx、明天10点提醒我xxx。";
  if (intent.type === "ack") return "";

  if (intent.type === "createTask") {
    const item = await createTaskFromIntent(supabase, userId, intent);
    return formatCreatedTaskReply(item, intent);
  }

  if (intent.type === "createTasks") {
    const entries = [];
    for (const taskIntent of intent.items) {
      const item = await createTaskFromIntent(supabase, userId, taskIntent);
      entries.push({ item, intent: taskIntent });
    }
    return formatCreatedTasksReply(entries);
  }

  if (intent.type === "createNote") {
    const item = await createNoteFromIntent(supabase, userId, intent);
    return formatCreatedNoteReply(item);
  }

  if (intent.type === "listToday") {
    const today = dateKeyInBotTimeZone();
    const tasks = sortOpenTasksForBot(await fetchOpenTasks(supabase, userId)).filter((item) => {
      if (item.dueDate === today) return true;
      if (!item.reminderAt) return false;
      return dateKeyInBotTimeZone(new Date(item.reminderAt)) === today;
    });
    if (tasks.length === 0) return "今天没有未完成任务。";
    return `你今天的待办还挂着这些：\n${formatTaskListReply(tasks, "今天没有未完成任务。")}\n后面的都还没到点，到时间我会提醒你。`;
  }

  if (intent.type === "listOpen") {
    const tasks = sortOpenTasksForBot(await fetchOpenTasks(supabase, userId, 20));
    if (tasks.length === 0) return "现在没有未完成任务。";
    return `你现在的未完成任务：\n${formatTaskListReply(tasks, "现在没有未完成任务。")}`;
  }

  if (intent.type === "completeRecent") {
    const item = await completeMostRecentReminder(
      supabase,
      userId,
      senderId,
      options?.reminderProvider ?? "clawbot"
    );
    if (!item) return "没有找到最近提醒过、还没完成的任务。";
    return formatCompletedReply(item);
  }

  if (intent.type === "deleteAllTasks") {
    const deleted = await softDeleteOpenTasks(supabase, userId);
    return deleted > 0 ? `已清理 ${deleted} 个未完成任务。` : "现在没有需要清理的未完成任务。";
  }

  if (intent.type === "complete" || intent.type === "delete") {
    const match = findBestOpenTaskMatch(await fetchOpenTasks(supabase, userId), intent.query);
    if (!match) return `没找到未完成任务：${intent.query}`;

    if (intent.type === "complete") {
      await markTaskDone(supabase, userId, match.id);
      return formatCompletedReply(match);
    }

    await softDeleteTask(supabase, userId, match.id);
    return formatDeletedReply(match);
  }

  if (intent.type === "snooze") {
    const item = await snoozeMostRecentReminder(
      supabase,
      userId,
      senderId,
      intent.minutes,
      options?.reminderProvider ?? "clawbot"
    );
    if (!item) return "没有找到最近可稍后提醒的任务。";
    return `已调整：${item.title}\n${intent.minutes} 分钟后再提醒你。`;
  }

  return "这个指令暂时还不支持。";
}
