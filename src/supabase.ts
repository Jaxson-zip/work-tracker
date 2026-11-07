import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const demoMode = import.meta.env.MODE === "demo";

export const isSupabaseConfigured = !demoMode && Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(supabaseUrl!, supabaseAnonKey!) : null;

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(callback: (session: Session | null) => void): () => void {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error("服务尚未配置");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

// 返回 false 表示 Supabase 要求先确认邮箱。
export async function signUpWithPassword(email: string, password: string, displayName: string): Promise<boolean> {
  if (!supabase) throw new Error("服务尚未配置");
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
  if (error) throw error;
  return Boolean(data.session);
}

export async function signOut(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
}
