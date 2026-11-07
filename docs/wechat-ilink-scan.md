# WeChat iLink Scan Binding

This is the website-scan binding mode. It is different from the older binding-code flow:

- The website shows a WeChat QR code after the user logs in.
- The user scans it in WeChat and authorizes the WeChat ClawBot/iLink channel.
- The server stores that user's `bot_token`, `base_url`, polling cursor, and reply context in Supabase.
- The server polls iLink every few seconds, turns incoming WeChat text into Todo commands, and sends replies through iLink.
- A separate fast reminder timer scans due reminders every few seconds, so short reminders do not wait for message polling.
- Due reminders are sent through the same iLink connection when the user has a fresh reply context.

No shared robot WeChat account is required for this mode. Each logged-in Todo user authorizes their own WeChat iLink connection from the sync panel.

## User Flow

1. Open the Todo website and log in.
2. In the sync panel, click `扫码连接`.
3. Scan the QR code with WeChat and confirm.
4. Send a message to the WeChat ClawBot entry, for example `任务列表`.
5. The server records the latest reply context, so proactive reminders can be sent back later.

The old `绑定码备用` flow remains available for a manually configured ClawBot-compatible webhook.

## Commands

Supported text examples:

```text
任务列表
今天有什么
明天10点提醒我交作业，提前30分钟提醒
完成 交作业
删除 交作业
稍后10分钟提醒
```

## Required Supabase Schema

Run the current `supabase-schema.sql` in Supabase SQL Editor. For iLink it adds:

- `bot_ilink_connections`: stores per-user iLink credentials and polling state.
- `bot_reminder_events.provider = 'ilink'`: tracks iLink reminders separately from the old `clawbot` provider.

`bot_ilink_connections` has RLS enabled and no authenticated-user policy. Frontend code only calls server APIs that return a sanitized connection status.

## Required Server Timer

Build the API runtime first:

```bash
cd /opt/to_do
npm ci
npm run build
npm run bot:build-api-runtime
```

Install the iLink poller:

```bash
sudo cp /opt/to_do/server/openclaw/systemd/todo-ilink-poller.service /etc/systemd/system/
sudo cp /opt/to_do/server/openclaw/systemd/todo-ilink-poller.timer /etc/systemd/system/
sudo cp /opt/to_do/server/openclaw/systemd/todo-ilink-reminders.service /etc/systemd/system/
sudo cp /opt/to_do/server/openclaw/systemd/todo-ilink-reminders.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now todo-ilink-poller.timer
sudo systemctl enable --now todo-ilink-reminders.timer
```

Check it:

```bash
systemctl list-timers '*todo-ilink*'
journalctl -u todo-ilink-poller.service -n 80 --no-pager
journalctl -u todo-ilink-reminders.service -n 80 --no-pager
```

The poller reads `/etc/todo-openclaw.env` and needs:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
BOT_TIME_ZONE=Asia/Shanghai
TODO_ILINK_CONNECTION_LIMIT=50
TODO_ILINK_REMINDER_LIMIT=50
TODO_ILINK_DRY_RUN=0
```

## Notes

- The iLink API can only send replies when it has a current `context_token`. The server refreshes it whenever the user sends a message.
- If reminders stop sending, send any message such as `任务列表` to refresh the reply context.
- The website never exposes `bot_token`; it only shows connection status.
