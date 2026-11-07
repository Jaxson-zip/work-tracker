import { useEffect, useRef, useState, type FormEvent } from "react";
import { isManager } from "./logic";
import type { Member, TeamSnapshot, WorkContext } from "./types";

function MemberRow({ member, ctx }: { member: Member; ctx: WorkContext }) {
  const isSelf = member.user_id === ctx.userId;
  const removable = isManager(ctx.role) && !isSelf && member.role !== "owner" && (ctx.role === "owner" || member.role === "member");
  function remove() {
    if (window.confirm(`把 ${member.display_name} 移出团队？`)) void ctx.execute("update_member", { userId: member.user_id, role: null });
  }
  return (
    <li className="member-row">
      <span className="member-name">
        {member.display_name}
        {isSelf ? "（我）" : ""}
      </span>
      {member.role === "owner" && <span className="muted">创建者</span>}
      {ctx.role === "owner" && member.role !== "owner" && (
        <label className="inline-field">
          <input
            type="checkbox"
            disabled={ctx.busy}
            checked={member.role === "admin"}
            onChange={(e) => void ctx.execute("update_member", { userId: member.user_id, role: e.target.checked ? "admin" : "member" })}
          />
          管理者
        </label>
      )}
      {ctx.role !== "owner" && member.role === "admin" && <span className="muted">管理者</span>}
      {removable && (
        <button type="button" className="danger" disabled={ctx.busy} onClick={remove}>
          移除
        </button>
      )}
    </li>
  );
}

function ProfileForm({ data, ctx }: { data: TeamSnapshot; ctx: WorkContext }) {
  const [name, setName] = useState(data.profile.display_name);
  const [mobile, setMobile] = useState(data.my_mobile);
  function save(event: FormEvent) {
    event.preventDefault();
    void ctx.execute("update_profile", { displayName: name.trim(), mobile: mobile.trim() });
  }
  return (
    <form className="form-stack" onSubmit={save}>
      <label>
        我的姓名
        <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        手机号（群消息 @ 你时用，同事看不到）
        <input type="tel" inputMode="numeric" maxLength={11} value={mobile} onChange={(e) => setMobile(e.target.value)} />
      </label>
      <div>
        <button disabled={ctx.busy || !name.trim()}>保存</button>
      </div>
    </form>
  );
}

// 团队设置只有这一个弹窗：不常用，不占页面。
export default function TeamDialog({
  data,
  ctx,
  notice,
  error,
  onClose,
}: {
  data: TeamSnapshot;
  ctx: WorkContext;
  notice: string;
  error: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const manager = isManager(ctx.role);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <div className="dialog-head">
        <h2>{data.workspaces[0]?.name}</h2>
        <button type="button" className="link" onClick={onClose}>
          关闭
        </button>
      </div>
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <ProfileForm data={data} ctx={ctx} />
      <h3>成员</h3>
      <ul className="member-list">
        {data.members.map((member) => (
          <MemberRow key={member.user_id} member={member} ctx={ctx} />
        ))}
      </ul>
      {manager && (
        <>
          <h3>邀请同事</h3>
          <p className="muted dialog-hint">把邀请码发给同事，对方注册后填写。每个码用一次，7 天内有效。</p>
          {data.invites.map((invite) => (
            <p key={invite.id}>
              <code>{invite.code}</code>
            </p>
          ))}
          <div>
            <button type="button" disabled={ctx.busy} onClick={() => void ctx.execute("invite", {})}>
              生成邀请码
            </button>
          </div>
        </>
      )}
      {manager && data.failed_notifications > 0 && (
        <>
          <h3>群通知</h3>
          <p className="text-danger">有 {data.failed_notifications} 条消息发送失败，请检查群机器人配置。</p>
          <div>
            <button type="button" disabled={ctx.busy} onClick={() => void ctx.execute("retry_notifications", {})}>
              重新发送
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
