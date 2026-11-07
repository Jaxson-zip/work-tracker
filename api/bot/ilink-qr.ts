import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../_bot/authenticatedUser.js";
import { getIlinkQrCode } from "../_bot/ilink.js";
import { requirePost, sendJson } from "../_bot/http.js";

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (!requirePost(request, response)) return;

  const auth = await authenticateRequest(request, response);
  if (!auth) return;

  try {
    sendJson(response, 200, await getIlinkQrCode());
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Failed to create WeChat QR code" });
  }
}
