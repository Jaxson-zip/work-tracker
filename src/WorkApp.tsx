import { lazy, Suspense, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSession, isSupabaseConfigured, onAuthChange, signInWithPassword, signOut, signUpWithPassword, supabase } from "./supabase";
import { setStorageAccount } from "./storage";
import TeamWorkbench from "./team/TeamWorkbench";
import { demoEnabled, setDemoUser } from "./team/client";
import "./team/team.css";
const PersonalApp = lazy(() => import("./App"));
const demoPeople = [
  { id: "11111111-1111-4111-8111-111111111111", name: "林晓 · 所有者" },
  { id: "22222222-2222-4222-8222-222222222222", name: "陈晨 · 成员" },
  { id: "33333333-3333-4333-8333-333333333333", name: "周宁 · 管理员" },
];
const demoSession = (id: string) => ({ user: { id, email: "本地演示身份" } } as Session);

export default function WorkApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"team" | "personal">("team");
  const [recovering, setRecovering] = useState(() => window.location.hash.includes("type=recovery"));
  useEffect(() => {
    if (demoEnabled) { const id = demoPeople[0].id; setDemoUser(id); setStorageAccount(id); setSession(demoSession(id)); setReady(true); return; }
    let active = true;
    let changed = false;
    const apply = (next: Session | null) => {
      if (!active) return;
      setStorageAccount(next?.user.id ?? null);
      setSession(next); setReady(true);
    };
    const unsubscribe = onAuthChange(next => { changed = true; apply(next); });
    const recovery = supabase?.auth.onAuthStateChange(event => { if (event === "PASSWORD_RECOVERY") setRecovering(true); });
    getSession().then(next => { if (!changed) apply(next); }).catch(e => { if (active) { setError(String(e)); setReady(true); } });
    return () => { active = false; unsubscribe(); recovery?.data.subscription.unsubscribe(); };
  }, []);
  return <div className={`work-shell ${mode === "personal" ? "personal-shell" : ""}`}>
    <header className="work-topbar">
      <a className="work-brand" href="#" onClick={e => { e.preventDefault(); setMode("team"); }}><span className="brand-mark">进</span><strong>推进<span>工作事务台</span></strong></a>
      <nav aria-label="工作空间"><button type="button" className={mode === "team" ? "selected" : ""} onClick={() => setMode("team")}>团队事务</button><button type="button" className={mode === "personal" ? "selected" : ""} onClick={() => setMode("personal")}>个人待办</button></nav>
      <div className="account-chip"><span>{session?.user.email ?? "本地模式"}</span>{session && !demoEnabled && <button type="button" onClick={() => void signOut().catch(e => setError(e.message))}>退出</button>}</div>
    </header>
    {demoEnabled && <div className="demo-banner"><span><strong>本地演示</strong> · 隔离的演示身份与数据库，非正式登录。不会连接 Supabase 或发送飞书消息。</span><label>切换演示身份<select value={session?.user.id ?? demoPeople[0].id} onChange={e => { if (!window.confirm("切换演示身份会关闭未保存的编辑。继续？")) return; const id = e.target.value; setDemoUser(id); setStorageAccount(id); setSession(demoSession(id)); }}>{demoPeople.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label></div>}
    {error && <div className="work-banner error" role="alert">{error}<button type="button" onClick={() => setError("")}>关闭</button></div>}
    {!ready ? <div className="work-empty" role="status">正在恢复账号…</div> : recovering && session ? <AuthPanel session={session} recovery onDone={() => setRecovering(false)} /> : mode === "personal" ? <div className="personal-container"><Suspense fallback={<div className="work-empty">正在打开个人待办…</div>}><PersonalApp key={session?.user.id ?? "guest"} initialSession={demoEnabled ? null : session} /></Suspense></div> : session ? <TeamWorkbench key={session.user.id} session={session} /> : <AuthPanel />}
  </div>;
}

function AuthPanel({ session, recovery = false, onDone }: { session?: Session; recovery?: boolean; onDone?: () => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function run(action: "login" | "signup" | "reset" | "change") {
    setBusy(true); setMessage(""); setError("");
    try {
      if (!supabase) throw new Error("请先配置 Supabase。");
      if (action === "login") await signInWithPassword(email.trim(), password);
      if (action === "signup") { const next = await signUpWithPassword(email.trim(), password); if (!next) setMessage("注册已提交，请查收确认邮件后登录。"); }
      if (action === "reset") { const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin }); if (err) throw err; setMessage("重置请求已提交，请检查邮箱。"); }
      if (action === "change") { const { error: err } = await supabase.auth.updateUser({ password }); if (err) throw err; setMessage("密码已更新。"); setPassword(""); onDone?.(); }
    } catch (e) { setError(e instanceof Error ? e.message : "账号操作失败"); } finally { setBusy(false); }
  }
  return <main className="work-welcome">
    <section className="welcome-story"><p className="eyebrow">RECORD. ASSIGN. FOLLOW THROUGH.</p><h1>重要的事，<br />记下来，推进去。</h1><p>把日常记录变成明确的下一步。<br />每件任务有人负责，每次转交有迹可循。</p><ol className="welcome-steps"><li><b>01</b>随手记录事务与关键事项</li><li><b>02</b>明确负责人、期限与下一步</li><li><b>03</b>跟进、转交、验收，直到完成</li></ol><small>个人待办、日历、四象限和番茄钟可在顶部打开。</small></section>
    <section className="auth-panel"><p className="eyebrow">你的工作空间</p><h2>{recovery ? "设置新密码" : "登录，开始推进"}</h2><p className="secondary">{session?.user.email ?? "使用邮箱账号管理自己的团队与事务。"}</p>
      {!isSupabaseConfigured && <div className="setup-note"><strong>团队服务尚未连接</strong><p>复制 <code>.env.example</code> 为 <code>.env.local</code>，填入新项目的 Supabase URL 和公钥，并执行数据库迁移后重启。</p><p>个人待办现可本地使用。团队功能需要真实账号与数据库。</p></div>}
      <form onSubmit={e => { e.preventDefault(); void run(recovery ? "change" : "login"); }}>
        {!recovery && <label>邮箱<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>}
        <label>{recovery ? "新密码" : "密码"}<input type="password" autoComplete={recovery ? "new-password" : "current-password"} minLength={8} required value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 8 位" /></label>
        <button className="primary" disabled={busy || !isSupabaseConfigured}>{busy ? "正在处理…" : recovery ? "保存新密码" : "登录工作空间"}</button>
        {!recovery && <div className="auth-links"><button type="button" disabled={busy || !isSupabaseConfigured || !email || password.length < 8} onClick={() => void run("signup")}>注册账号</button><button type="button" disabled={busy || !isSupabaseConfigured || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} onClick={() => void run("reset")}>忘记密码</button></div>}
      </form>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    </section>
  </main>;
}
