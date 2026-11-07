import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildIlinkSendBody,
  checkIlinkQrCode,
  extractIlinkInboundMessages,
  getIlinkQrCode,
} from "../../api/_bot/ilink";

describe("iLink ClawBot client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a QR code for website scan binding", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      qrcode: "qr-token-1",
      qrcode_img_content: "data:image/png;base64,abc123",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const qr = await getIlinkQrCode();

    expect(qr).toEqual({
      qrcodeId: "qr-token-1",
      qrcodeImage: "data:image/png;base64,abc123",
      expiresInSeconds: 300,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("recognizes a confirmed QR status without exposing raw response names", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      status: 2,
      bot_token: "secret-token",
      baseurl: "https://ilink.example.test",
    })));

    const status = await checkIlinkQrCode("qr-token-1");

    expect(status).toEqual({
      status: "confirmed",
      botToken: "secret-token",
      baseUrl: "https://ilink.example.test",
    });
  });

  it("extracts text messages and context tokens from iLink updates", () => {
    const messages = extractIlinkInboundMessages({
      msgs: [
        {
          message_type: 2,
          from_user_id: "bot",
          context_token: "ignored",
          item_list: [{ type: 1, text_item: { text: "echo" } }],
        },
        {
          message_type: 1,
          from_user_id: "wechat-user",
          context_token: "ctx-1",
          item_list: [{ type: 1, text_item: { text: "任务列表" } }],
        },
        {
          message_type: 1,
          from_user_id: "voice-user",
          context_token: "ctx-2",
          item_list: [{ type: 3, voice_item: { text: "今天有什么任务" } }],
        },
      ],
    });

    expect(messages).toEqual([
      { fromUserId: "wechat-user", text: "任务列表", contextToken: "ctx-1" },
      { fromUserId: "voice-user", text: "今天有什么任务", contextToken: "ctx-2" },
    ]);
  });

  it("builds text replies with the latest context token", () => {
    const body = buildIlinkSendBody({
      toUserId: "wechat-user",
      text: "已记录：开会",
      contextToken: "ctx-1",
      clientId: "client-1",
    });

    expect(body).toEqual({
      msg: {
        from_user_id: "",
        to_user_id: "wechat-user",
        client_id: "client-1",
        message_type: 2,
        message_state: 2,
        context_token: "ctx-1",
        item_list: [{ type: 1, text_item: { text: "已记录：开会" } }],
      },
      base_info: { channel_version: "1.0.2" },
    });
  });
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}
