import { useState, type FormEvent } from "react";
import { isSupabaseConfigured, signInWithPassword, signUpWithPassword, supabase } from "../supabase";

type Mode = "login" | "signup" | "reset";

function authErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/Invalid login credentials/i.test(message)) return "邮箱或密码不正确";
  if (/already registered/i.test(message)) return "这个邮箱已经注册过了，请直接登录";
  if (/Email not confirmed/i.test(message)) return "邮箱还没有确认，请先查收确认邮件";
  if (/rate limit|too many/i.test(message)) return "操作太频繁，请稍后再试";
  if (/Password should/i.test(message)) return "密码强度不够，请换一个更长的密码";
  return "操作失败，请稍后再试";
}

export default function AuthPage({ recovery = false, onDone }: { recovery?: boolean; onDone?: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (recovery) {
        const result = await supabase!.auth.updateUser({ password });
        if (result.error) throw result.error;
        onDone?.();
      } else if (mode === "login") {
        await signInWithPassword(email.trim(), password);
      } else if (mode === "signup") {
        const signedIn = await signUpWithPassword(email.trim(), password, name.trim());
        if (!signedIn) setMessage("注册成功，请查收确认邮件后登录。");
      } else {
        const result = await supabase!.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (result.error) throw result.error;
        setMessage("重置邮件已发送，请查收。");
      }
    } catch (cause) {
      setError(authErrorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const title = recovery ? "设置新密码" : mode === "login" ? "登录" : mode === "signup" ? "注册账号" : "找回密码";
  const submitLabel = recovery ? "保存新密码" : mode === "login" ? "登录" : mode === "signup" ? "注册并开始" : "发送重置邮件";

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand brand-large">
          <span className="brand-mark" aria-hidden="true">
            进
          </span>
          <span>推进</span>
        </div>
        <p className="auth-tagline">重要的事记下来，交接有人接，到期不漏。</p>
        <h1>{title}</h1>
        {!isSupabaseConfigured && (
          <p className="form-error" role="alert">
            服务尚未配置，暂时无法登录。
          </p>
        )}
        <form onSubmit={(event) => void submit(event)} className="form-stack">
          {mode === "signup" && !recovery && (
            <label>
              姓名
              <input
                required
                maxLength={40}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="同事看到的名字"
              />
            </label>
          )}
          {!recovery && (
            <label>
              邮箱
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
          )}
          {mode !== "reset" && (
            <label>
              {recovery ? "新密码" : "密码"}
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === "login" && !recovery ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
              />
            </label>
          )}
          <button className="primary full" disabled={busy || !isSupabaseConfigured}>
            {busy ? "请稍候…" : submitLabel}
          </button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="form-success" role="status">
            {message}
          </p>
        )}
        {!recovery && (
          <div className="auth-links">
            {mode === "login" ? (
              <>
                <button type="button" className="link" onClick={() => setMode("signup")}>
                  注册账号
                </button>
                <button type="button" className="link" onClick={() => setMode("reset")}>
                  忘记密码
                </button>
              </>
            ) : (
              <button type="button" className="link" onClick={() => setMode("login")}>
                返回登录
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
