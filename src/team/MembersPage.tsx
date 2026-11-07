import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { membersByDepartment } from "./logic";
import { ActionDialog, type DialogConfig } from "./TaskActions";
import { roleLabels, type Member, type TeamSnapshot, type WorkContext } from "./types";

function ProfileForm({ data, ctx }: { data: TeamSnapshot; ctx: WorkContext }) {
  const me = data.members.find((member) => member.user_id === ctx.userId);
  const [name, setName] = useState(data.profile.display_name);
  const [mobile, setMobile] = useState(data.my_mobile);
  const [department, setDepartment] = useState(me?.department ?? "");
  const [password, setPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!(await ctx.execute("update_profile", { displayName: name.trim(), mobile: mobile.trim() })).ok) return;
    if (department.trim() !== me?.department) await ctx.execute("set_department", { userId: ctx.userId, department: department.trim() });
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    const result = await supabase!.auth.updateUser({ password });
    setPasswordMessage(result.error ? "密码修改失败，请换一个更长的密码" : "密码已修改");
    if (!result.error) setPassword("");
  }
  return (
    <section className="panel">
      <h2>我的资料</h2>
      <form className="form-stack" onSubmit={(event) => void save(event)}>
        <div className="field-row">
          <label>
            姓名
            <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            部门
            <input maxLength={40} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="例如：运营部" />
          </label>
        </div>
        <label>
          手机号（用于在群消息里 @ 你，同事看不到）
          <input type="tel" inputMode="numeric" maxLength={11} value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </label>
        <div>
          <button disabled={ctx.busy || !name.trim()}>保存</button>
        </div>
      </form>
      {supabase && (
        <form className="inline-form" onSubmit={(event) => void changePassword(event)}>
          <label>
            修改密码
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
            />
          </label>
          <button>修改</button>
          {passwordMessage && (
            <span className="muted" role="status">
              {passwordMessage}
            </span>
          )}
        </form>
      )}
    </section>
  );
}

function MemberRow({
  member,
  me,
  ctx,
  onTransfer,
}: {
  member: Member;
  me?: Member;
  ctx: WorkContext;
  onTransfer: (member: Member) => void;
}) {
  const isSelf = member.user_id === ctx.userId;
  const manager = ctx.role !== "member";
  const canRemove = manager && member.role !== "owner" && !isSelf && (me?.role === "owner" || member.role === "member");
  const [department, setDepartment] = useState(member.department);
  return (
    <div className="member-row">
      <span className="avatar" aria-hidden="true">
        {member.display_name.slice(0, 1)}
      </span>
      <div className="member-info">
        <strong>
          {member.display_name}
          {isSelf && <span className="muted">（我）</span>}
        </strong>
        <small>{roleLabels[member.role]}</small>
      </div>
      {manager && !isSelf && (
        <input
          className="member-department"
          aria-label={`${member.display_name}的部门`}
          placeholder="部门"
          maxLength={40}
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          onBlur={() => {
            if (department.trim() !== member.department)
              void ctx.execute("set_department", { userId: member.user_id, department: department.trim() });
          }}
        />
      )}
      {me?.role === "owner" && member.role !== "owner" && (
        <select
          aria-label={`${member.display_name}的角色`}
          disabled={ctx.busy}
          value={member.role}
          onChange={(e) => void ctx.execute("update_member", { userId: member.user_id, role: e.target.value })}
        >
          <option value="member">成员</option>
          <option value="admin">管理员</option>
        </select>
      )}
      {(manager || isSelf) && (
        <button type="button" disabled={ctx.busy} onClick={() => onTransfer(member)}>
          全部转出
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          className="danger"
          disabled={ctx.busy}
          onClick={() => {
            if (window.confirm(`把 ${member.display_name} 移出团队？需要先转交对方的未完成事项。`))
              void ctx.execute("update_member", { userId: member.user_id, role: null });
          }}
        >
          移除
        </button>
      )}
    </div>
  );
}

export default function MembersPage({ data, ctx }: { data: TeamSnapshot; ctx: WorkContext }) {
  const me = data.members.find((member) => member.user_id === ctx.userId);
  const manager = ctx.role !== "member";
  const [inviteRole, setInviteRole] = useState("member");
  const [dialog, setDialog] = useState<DialogConfig | null>(null);
  const invites = data.invites.filter((invite) => !invite.used_at && new Date(invite.expires_at) > new Date());

  function transferAll(member: Member) {
    setDialog({
      title: `把 ${member.display_name} 的未完成事项全部转出`,
      description: "用于休假、离职或调岗。对方可以一次全部接收，也可以逐件退回。",
      personLabel: "转给谁",
      excludeId: member.user_id,
      reasonLabel: "说明（需要注意什么）",
      reasonRequired: true,
      confirmLabel: "全部转出",
      onConfirm: async ({ reason, personId }) =>
        (await ctx.execute("transfer_all", { fromUserId: member.user_id, toUserId: personId, reason })).ok,
    });
  }

  return (
    <>
      <header className="page-header">
        <h1>成员</h1>
        <p className="muted">{data.members.length} 人</p>
      </header>
      <ProfileForm key={ctx.userId} data={data} ctx={ctx} />
      {membersByDepartment(data.members).map(({ department, members }) => (
        <section key={department} className="group">
          <div className="group-head">
            <h2>{department || "未分组"}</h2>
            <span className="count">{members.length}</span>
          </div>
          <div className="task-list">
            {members.map((member) => (
              <MemberRow key={`${member.user_id}:${member.department}`} member={member} me={me} ctx={ctx} onTransfer={transferAll} />
            ))}
          </div>
        </section>
      ))}
      {manager && (
        <section className="panel">
          <h2>邀请同事</h2>
          <p className="muted">把邀请码发给同事，对方注册登录后填写。单次有效，7 天过期。</p>
          <div className="inline-form">
            {me?.role === "owner" && (
              <label>
                角色
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="member">成员</option>
                  <option value="admin">管理员</option>
                </select>
              </label>
            )}
            <button className="primary" disabled={ctx.busy} onClick={() => void ctx.execute("invite", { role: inviteRole })}>
              生成邀请码
            </button>
          </div>
          {invites.map((invite) => (
            <p key={invite.id} className="invite">
              <code>{invite.code}</code>
              <span className="muted">
                {roleLabels[invite.role]} · {new Date(invite.expires_at).toLocaleDateString("zh-CN")} 过期
              </span>
            </p>
          ))}
        </section>
      )}
      {dialog && <ActionDialog config={dialog} members={ctx.members} busy={ctx.busy} onClose={() => setDialog(null)} />}
    </>
  );
}
