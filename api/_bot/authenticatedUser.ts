import type { User } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthorizationBearer, sendJson } from "./http.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

export type AuthenticatedRequest = {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  user: User;
};

export async function authenticateRequest(
  request: VercelRequest,
  response: VercelResponse
): Promise<AuthenticatedRequest | null> {
  const token = getAuthorizationBearer(request);
  if (!token) {
    sendJson(response, 401, { error: "Missing Authorization bearer token" });
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    sendJson(response, 401, { error: "Invalid user token" });
    return null;
  }

  return { supabase, user: data.user };
}
