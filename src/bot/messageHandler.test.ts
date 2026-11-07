import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoItem } from "../../api/_bot/types";

const getSupabaseAdmin = vi.fn();
const bindProviderUser = vi.fn();
const fetchOpenTasks = vi.fn();
const getBotBinding = vi.fn();
const completeMostRecentReminder = vi.fn();
const createNoteFromIntent = vi.fn();
const createTaskFromIntent = vi.fn();
const markTaskDone = vi.fn();
const softDeleteOpenTasks = vi.fn();
const softDeleteTask = vi.fn();
const snoozeMostRecentReminder = vi.fn();

vi.mock("../../api/_bot/supabaseAdmin.js", () => ({
  getSupabaseAdmin,
}));

vi.mock("../../api/_bot/todoRepository.js", () => ({
  bindProviderUser,
  completeMostRecentReminder,
  createNoteFromIntent,
  createTaskFromIntent,
  fetchOpenTasks,
  getBotBinding,
  markTaskDone,
  softDeleteTask,
  softDeleteOpenTasks,
  snoozeMostRecentReminder,
}));

const { default: messageHandler } = await import("../../api/bot/message");

describe("bot message handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BOT_WEBHOOK_SECRET = "test-secret";
    getSupabaseAdmin.mockReturnValue({ client: "supabase" });
  });

  it("stays silent for unbound non-bind messages", async () => {
    getBotBinding.mockResolvedValue(null);

    const response = await invokeMessageHandler({ senderId: "wechat-user", text: "任务列表" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ reply: "" });
    expect(getBotBinding).toHaveBeenCalledWith({ client: "supabase" }, "wechat-user");
    expect(fetchOpenTasks).not.toHaveBeenCalled();
  });

  it("still replies to binding commands from unbound users", async () => {
    bindProviderUser.mockResolvedValue("invalid");

    const response = await invokeMessageHandler({ senderId: "wechat-user", text: "绑定 TD-0000000000" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ reply: "绑定码无效或已过期，请在网站重新生成。" });
    expect(bindProviderUser).toHaveBeenCalledWith({ client: "supabase" }, "wechat-user", "TD-0000000000");
    expect(getBotBinding).not.toHaveBeenCalled();
  });

  it("handles task commands for bound users", async () => {
    getBotBinding.mockResolvedValue({ provider: "clawbot", provider_user_id: "wechat-user", user_id: "todo-user" });
    fetchOpenTasks.mockResolvedValue([]);

    const response = await invokeMessageHandler({ senderId: "wechat-user", text: "任务列表" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ reply: "现在没有未完成任务。" });
    expect(fetchOpenTasks).toHaveBeenCalledWith({ client: "supabase" }, "todo-user", 20);
  });

  it("creates multiple scheduled tasks from one bound message", async () => {
    getBotBinding.mockResolvedValue({ provider: "clawbot", provider_user_id: "wechat-user", user_id: "todo-user" });
    createTaskFromIntent.mockImplementation(async (_supabase, _userId, intent) => ({
      title: intent.title,
      dueDate: intent.dueDate,
      reminderAt: intent.reminderAt,
      repeatRule: intent.repeatRule,
    }));

    const response = await invokeMessageHandler({
      senderId: "wechat-user",
      text: "周三下午3点客户demo、周五早9点的高铁提前1小时叫我、每周二晚8点私教课循环",
    });

    const body = response.body as { reply: string };
    expect(response.statusCode).toBe(200);
    expect(body.reply).toContain("收到，已经帮你排好");
    expect(body.reply).toContain("客户demo");
    expect(body.reply).toContain("高铁");
    expect(body.reply).toContain("私教课");
    expect(body.reply).toContain("每周");
    expect(createTaskFromIntent).toHaveBeenCalledTimes(3);
  });

  it("replies cleanly for shorthand time ranges", async () => {
    getBotBinding.mockResolvedValue({ provider: "clawbot", provider_user_id: "wechat-user", user_id: "todo-user" });
    createTaskFromIntent.mockImplementation(async (_supabase, _userId, intent) => ({
      title: intent.title,
      dueDate: intent.dueDate,
      reminderAt: intent.reminderAt,
      repeatRule: intent.repeatRule,
    }));

    const response = await invokeMessageHandler({ senderId: "wechat-user", text: "明天下午5.到7.打球" });
    const body = response.body as { reply: string };

    expect(body.reply).toContain("打球");
    expect(body.reply).not.toContain("到7");
    expect(body.reply).toContain("-");
    expect(createTaskFromIntent).toHaveBeenCalledWith(
      { client: "supabase" },
      "todo-user",
      expect.objectContaining({ title: "打球", endAt: expect.any(String) })
    );
  });

  it("creates notes from lightweight record commands", async () => {
    getBotBinding.mockResolvedValue({ provider: "clawbot", provider_user_id: "wechat-user", user_id: "todo-user" });
    createNoteFromIntent.mockResolvedValue({ title: "体重 66.7kg" });

    const response = await invokeMessageHandler({ senderId: "wechat-user", text: "记录一下，今天体重 66.7" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ reply: "好，已记下：体重 66.7kg。" });
    expect(createNoteFromIntent).toHaveBeenCalledWith(
      { client: "supabase" },
      "todo-user",
      expect.objectContaining({ type: "createNote", title: "体重 66.7kg" })
    );
    expect(createTaskFromIntent).not.toHaveBeenCalled();
  });

  it("marks the most recent reminder done for bare completion replies", async () => {
    getBotBinding.mockResolvedValue({ provider: "clawbot", provider_user_id: "wechat-user", user_id: "todo-user" });
    completeMostRecentReminder.mockResolvedValue({
      title: "打水",
      dueDate: "2026-06-05",
      reminderAt: "2026-06-05T07:46:21.000Z",
    });

    const response = await invokeMessageHandler({ senderId: "wechat-user", text: "完成" });
    const body = response.body as { reply: string };

    expect(response.statusCode).toBe(200);
    expect(body.reply).toContain("已完成：打水");
    expect(completeMostRecentReminder).toHaveBeenCalledWith(
      { client: "supabase" },
      "todo-user",
      "wechat-user",
      "clawbot"
    );
    expect(createTaskFromIntent).not.toHaveBeenCalled();
  });

  it("clears open tasks without creating a task", async () => {
    getBotBinding.mockResolvedValue({ provider: "clawbot", provider_user_id: "wechat-user", user_id: "todo-user" });
    softDeleteOpenTasks.mockResolvedValue(2);

    const response = await invokeMessageHandler({ senderId: "wechat-user", text: "清理所有任务" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ reply: "已清理 2 个未完成任务。" });
    expect(softDeleteOpenTasks).toHaveBeenCalledWith({ client: "supabase" }, "todo-user");
    expect(createTaskFromIntent).not.toHaveBeenCalled();
  });
});

async function invokeMessageHandler(body: Record<string, unknown>) {
  const response = createMockResponse();
  await messageHandler(
    {
      method: "POST",
      headers: { "x-bot-secret": "test-secret" },
      body,
    } as never,
    response as never
  );
  return response;
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}
