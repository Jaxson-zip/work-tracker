import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../_bot/authenticatedUser.js";
import { requirePost, readJsonBody, sendJson } from "../_bot/http.js";
import {
  deleteIlinkConnection,
  getIlinkConnectionByUserId,
  toPublicIlinkConnection,
} from "../_bot/ilinkRepository.js";

type IlinkConnectionPayload = {
  action?: "status" | "disconnect";
};

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (!requirePost(request, response)) return;

  let payload: IlinkConnectionPayload = {};
  try {
    payload = await readJsonBody<IlinkConnectionPayload>(request);
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body" });
    return;
  }

  const auth = await authenticateRequest(request, response);
  if (!auth) return;

  try {
    if (payload.action === "disconnect") {
      await deleteIlinkConnection(auth.supabase, auth.user.id);
      sendJson(response, 200, { connection: toPublicIlinkConnection(null) });
      return;
    }

    const connection = await getIlinkConnectionByUserId(auth.supabase, auth.user.id);
    sendJson(response, 200, { connection: toPublicIlinkConnection(connection) });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Failed to read WeChat connection" });
  }
}
