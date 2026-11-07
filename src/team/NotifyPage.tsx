import { useState } from "react";
import type { OutboxEvent, TeamSnapshot, WorkContext } from "./types";

const statusText: Record<string, string> = {
  pending: "排队中",
  processing: "发送中",
  sent: "已发送",
  failed: "发送失败",
  cancelled: "已取消",
};

function errorHint({ last_error, status }: OutboxEvent): string | null {
  if (!last_error) return null;
  if (last_error.includes("No webhook")) return "这个团队还没有配置群机器人";
  return status === "failed" ? "多次发送都失败了，可以手动重发" : "这次发送失败，系统会自动重试";
}

function DeliveryRow({ event, ctx }: { event: OutboxEvent; ctx: WorkContext }) {
  const hint = errorHint(event);
  return (
    <div className="task-row">
      <div className="task-main">
        <p className="delivery-text">{event.message ?? "（无内容）"}</p>
        <div className="task-meta">
          <span className={`tag ${event.status === "failed" ? "tag-danger" : event.status === "sent" ? "tag-success" : ""}`}>
            {statusText[event.status] ?? event.status}
          </span>
          <span>
            {new Date(event.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
          {hint && <span>{hint}</span>}
        </div>
      </div>
      {event.status === "failed" && (
        <div className="task-actions">
          <button type="button" disabled={ctx.busy} onClick={() => void ctx.execute("retry_notification", { notificationId: event.id })}>
            重发
          </button>
        </div>
      )}
    </div>
  );
}

function FeishuBinding({ bound, ctx }: { bound: boolean; ctx: WorkContext }) {
  const [code, setCode] = useState("");
  return (
    <section className="panel">
      <h2>用飞书记事</h2>
      <p className="muted">
        {bound ? "已绑定。给机器人发“记录 …”或“待办 …”就能记下。" : "绑定后，给飞书机器人发“记录 …”或“待办 …”就能记下。"}
      </p>
      <div className="task-actions">
        <button
          type="button"
          disabled={ctx.busy}
          onClick={async () => {
            const result = await ctx.execute("create_feishu_binding", {});
            if (result.ok) setCode(String(result.data?.code ?? ""));
          }}
        >
          {bound ? "重新绑定" : "绑定飞书"}
        </button>
        {bound && (
          <button type="button" disabled={ctx.busy} onClick={() => void ctx.execute("disconnect_feishu", {})}>
            解除绑定
          </button>
        )}
      </div>
      {code && (
        <p className="callout">
          在飞书里给机器人发送：<code>绑定 {code}</code>（10 分钟内有效）
        </p>
      )}
    </section>
  );
}

// 没部署飞书机器人时不显示绑定入口，否则按钮点了也没有下文。
const feishuEnabled = import.meta.env.VITE_FEISHU_BOT === "1";

export default function NotifyPage({ data, ctx }: { data: TeamSnapshot; ctx: WorkContext }) {
  const manager = ctx.role !== "member";
  return (
    <>
      <header className="page-header">
        <h1>通知</h1>
        <p className="muted">转交、验收和每日待办摘要会发到团队群，并 @ 相关的人</p>
      </header>
      {manager ? (
        <section className="group">
          <div className="group-head">
            <h2>最近发送</h2>
          </div>
          {data.outbox.length === 0 ? (
            <div className="empty">
              <p>还没有通知。</p>
            </div>
          ) : (
            <div className="task-list">
              {data.outbox.map((event) => (
                <DeliveryRow key={event.id} event={event} ctx={ctx} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="empty">
          <p>发送记录只有管理员能看到。要被群消息 @ 到，请在“成员”里填手机号。</p>
        </div>
      )}
      {feishuEnabled && <FeishuBinding bound={data.feishu_bound} ctx={ctx} />}
    </>
  );
}
