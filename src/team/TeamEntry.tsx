import { useState, type FormEvent } from "react";
import type { Execute } from "./types";

// 还没有团队时是整页入口；已有团队时嵌在页面顶部，用来加入或新建另一个。
export default function TeamEntry({
  execute,
  busy,
  embedded,
  onDone,
}: {
  execute: Execute;
  busy: boolean;
  embedded?: boolean;
  onDone?: () => void;
}) {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [code, setCode] = useState("");
  async function create(event: FormEvent) {
    event.preventDefault();
    if ((await execute("create_workspace", { name: name.trim(), department: department.trim() })).ok) onDone?.();
  }
  async function join(event: FormEvent) {
    event.preventDefault();
    if ((await execute("join_workspace", { code: code.trim(), department: department.trim() })).ok) onDone?.();
  }
  return (
    <div className={embedded ? "panel" : "auth"}>
      <div className={embedded ? undefined : "auth-card"}>
        {!embedded && <h1>加入或创建团队</h1>}
        <label>
          你的部门
          <input maxLength={40} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="例如：运营部" />
        </label>
        <form className="form-stack entry-form" onSubmit={(event) => void join(event)}>
          <label>
            同事给的邀请码
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="粘贴邀请码" />
          </label>
          <button className="primary" disabled={busy || !code.trim()}>
            加入团队
          </button>
        </form>
        <form className="form-stack entry-form" onSubmit={(event) => void create(event)}>
          <label>
            或者新建一个团队
            <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="团队名称" />
          </label>
          <button disabled={busy || !name.trim()}>新建团队</button>
        </form>
      </div>
    </div>
  );
}
