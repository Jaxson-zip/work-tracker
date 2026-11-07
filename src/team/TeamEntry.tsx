import { useState, type FormEvent } from "react";
import type { Execute } from "./types";

// 第一次进来还没有团队：填同事给的邀请码，或者新建一个。
export default function TeamEntry({ execute, busy }: { execute: Execute; busy: boolean }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  function join(event: FormEvent) {
    event.preventDefault();
    void execute("join_workspace", { code: code.trim() });
  }
  function create(event: FormEvent) {
    event.preventDefault();
    void execute("create_workspace", { name: name.trim() });
  }
  return (
    <main className="auth">
      <div className="auth-card">
        <h1>加入团队</h1>
        <form className="form-stack" onSubmit={join}>
          <label>
            同事给的邀请码
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="粘贴邀请码" />
          </label>
          <button className="primary" disabled={busy || !code.trim()}>
            加入
          </button>
        </form>
        <form className="form-stack entry-form" onSubmit={create}>
          <label>
            或者新建一个团队（你会成为管理者）
            <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="团队名称" />
          </label>
          <button disabled={busy || !name.trim()}>新建</button>
        </form>
      </div>
    </main>
  );
}
