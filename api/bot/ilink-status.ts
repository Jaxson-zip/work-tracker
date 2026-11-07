import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../_bot/authenticatedUser.js";
import { checkIlinkQrCode } from "../_bot/ilink.js";
import { requirePost, readJsonBody, sendJson } from "../_bot/http.js";
import { toPublicIlinkConnection, upsertIlinkConnection } from "../_bot/ilinkRepository.js";

type IlinkStatusPayload = {
  qrcodeId?: string;
};

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (!requirePost(request, response)) return;

  let payload: IlinkStatusPayload;
  try {
    payload = await readJsonBody<IlinkStatusPayload>(request);
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!payload.qrcodeId?.trim()) {
    sendJson(response, 400, { error: "Missing QR code id" });
    return;
  }

  const auth = await authenticateRequest(request, response);
  if (!auth) return;

  try {
    const qrStatus = await checkIlinkQrCode(payload.qrcodeId.trim());
    if (qrStatus.status !== "confirmed") {
      sendJson(response, 200, { status: qrStatus.status });
      return;
    }

    const connection = await upsertIlinkConnection(auth.supabase, auth.user.id, qrStatus.botToken, qrStatus.baseUrl);
    sendJson(response, 200, {
      status: "confirmed",
      connection: toPublicIlinkConnection(connection),
    });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Failed to check WeChat QR code" });
  }
}
