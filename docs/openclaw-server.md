# 微信机器人服务器部署流程

这份文档是项目的完整上线流程：网站继续放在 Vercel，数据继续放在
Supabase，微信通道放在一台云服务器上。你的个人电脑不需要一直开着。

## 先看结论

现在有两条微信通道：

- 推荐：网站同步面板 `扫码连接`，每个 Todo 用户自己扫码授权 iLink/ClawBot。
- 备用：服务器登录一个专门微信号，OpenClaw hook 收消息，网站用绑定码关联账号。

推荐扫码模式必须准备这些东西：

- 一台长期在线的云服务器，Ubuntu 或阿里云 Alibaba Cloud Linux 都可以。
- Vercel 生产环境变量，尤其是 `SUPABASE_SERVICE_ROLE_KEY` 和 `BOT_WEBHOOK_SECRET`。
- Supabase 数据库执行最新版 `supabase-schema.sql`。
- 服务器上的 `/etc/todo-openclaw.env`，里面放 Supabase 服务密钥。
- systemd timer：`todo-ilink-poller.timer` 每 15 秒拉取 iLink 消息，`todo-ilink-reminders.timer` 每 5 秒扫描到期提醒。

备用 OpenClaw 绑定码模式还需要：

- 一个专门微信号，用来扫码登录机器人微信。
- 服务器上的本地 Todo API 服务：`todo-openclaw-api.service`。
- OpenClaw 微信插件扫码成功，并且 `openclaw-weixin/default` 账号保持在线。
- OpenClaw inbound hook：收到微信消息后调用服务器本机 Todo API。
- systemd timer：每分钟扫描一次到期提醒，再通过 OpenClaw 发微信。
- 网站账号和微信账号之间的绑定码。

不需要这些东西：

- 不需要把你电脑开着。
- 推荐扫码模式不需要公众号，也不需要专门机器人微信号。
- 不需要给 OpenClaw 暴露公网端口。
- 不需要 `CLAWBOT_SEND_MESSAGE_URL`；扫码模式由 `server/openclaw/ilink-worker.mjs` 发，备用 OpenClaw 模式由 `server/openclaw/reminder-worker.mjs` 发。

## 为什么不建议主微信

主微信不是技术上不能用，而是不建议。

- OpenClaw 微信插件不是微信公众号官方 API，长期自动化可能触发微信风控。
- 服务器会保存微信登录态。服务器出问题时，专门微信号的损失更小。
- 机器人可能误回复、误发提醒，专门微信号更容易隔离。
- 演示时专门微信号更干净，后续换号也简单。

## 架构

```text
推荐扫码模式：
网站同步面板扫码
  -> api/bot/ilink-qr / api/bot/ilink-status
  -> Supabase bot_ilink_connections

systemd 每 15 秒
  -> server/openclaw/ilink-worker.mjs
  -> iLink getupdates / sendmessage
  -> Supabase memo_items / bot_ilink_connections / bot_reminder_events
  -> 微信回复

systemd 每 5 秒
  -> server/openclaw/ilink-worker.mjs (TODO_ILINK_REMINDERS_ONLY=1)
  -> Supabase 查询到期 reminder_at
  -> iLink sendmessage
  -> 微信提醒

备用 OpenClaw 绑定码模式：
微信消息
  -> 云服务器 OpenClaw 微信插件
  -> ~/.openclaw/hooks/todo-wechat
  -> http://127.0.0.1:8787/api/bot/message
  -> Supabase memo_items / bot_bindings
  -> hook 把 API reply 回发微信

systemd 每分钟
  -> server/openclaw/reminder-worker.mjs
  -> Supabase 查询到期 reminder_at
  -> openclaw message send
  -> 微信提醒
```

Vercel 仍然保留：它负责网站本身、登录、同步面板、扫码连接 API 和“生成绑定码”备用入口。

## 项目里已经准备好的文件

- `api/bot/message.ts`: 微信文本指令入口。
- `api/bot/binding-code.ts`: 网站登录后生成微信绑定码。
- `api/bot/ilink-qr.ts`: 网站登录后生成 iLink 扫码二维码。
- `api/bot/ilink-status.ts`: 轮询扫码状态，成功后保存 iLink 授权。
- `api/bot/ilink-connection.ts`: 读取或断开当前账号的 iLink 连接。
- `server/openclaw/ilink-worker.mjs`: 扫描 iLink 消息和 iLink 到期提醒，支持 reminders-only 模式。
- `server/openclaw/bot-api-server.mjs`: 服务器本地 Todo API，复用 `api/bot/*` 处理逻辑。
- `server/openclaw/todo-wechat-hook/`: OpenClaw 收消息 hook。
- `server/openclaw/reminder-worker.mjs`: 服务器提醒扫描和发送脚本。
- `server/openclaw/systemd/`: 本地 API service 和每分钟提醒 timer 模板。
- `server/openclaw/todo-openclaw.env.example`: 服务器环境变量模板。

## 阶段 0: 本地项目状态检查

在本地项目里确认最新代码已经推上 GitHub：

```powershell
git status --short --branch
git log -1 --oneline
```

生产站确认能打开：

```powershell
Invoke-WebRequest -UseBasicParsing https://todo-theta-mauve-75.vercel.app
```

## 阶段 1: Supabase 准备

在 Supabase SQL Editor 里执行项目根目录的 `supabase-schema.sql`。

它会创建或补齐：

- `memo_items.reminder_at`
- `bot_bindings`
- `bot_binding_codes`
- `bot_reminder_events`
- `bot_ilink_connections`
- `consume_bot_binding_code` RPC
- 提醒扫描和绑定查询索引

还需要从 Supabase 控制台拿两个值：

- Project URL：形如 `https://xxxx.supabase.co`
- Service role key：只给 Vercel/server 用，不放浏览器、不截图、不提交。

## 阶段 2: Vercel 环境变量

Vercel 项目需要这些生产环境变量：

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
BOT_WEBHOOK_SECRET=choose-a-long-random-secret
BOT_TIME_ZONE=Asia/Shanghai
```

服务器版不需要在 Vercel 配：

```env
CLAWBOT_SEND_MESSAGE_URL=
CLAWBOT_SEND_MESSAGE_TOKEN=
```

配完后重新部署一次生产环境：

```powershell
npx.cmd vercel deploy --prod --yes
```

验证 API 没带密钥时必须返回 `401`：

```powershell
try {
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://todo-theta-mauve-75.vercel.app/api/bot/message" `
    -ContentType "application/json" `
    -Body '{"senderId":"health","text":"任务列表"}'
} catch {
  $_.Exception.Response.StatusCode.value__
}
```

## 阶段 3: 云服务器基础环境

服务器只需要出站访问互联网，入站只开 SSH 就行。Ubuntu 22.04/24.04 和阿里云
Alibaba Cloud Linux 都可以。

```bash
sudo apt update
sudo apt install -y ca-certificates curl git build-essential
```

如果是阿里云 Alibaba Cloud Linux，用：

```bash
dnf install -y ca-certificates curl git tar gzip xz
```

OpenClaw 官方要求 Node 24，或 Node 22.19+。不要只用 Ubuntu 默认
`apt install nodejs`，很多镜像里的版本太旧。推荐用官方安装脚本：

```bash
curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
```

确认命令存在：

```bash
node -v
npm -v
openclaw --version
command -v node
command -v openclaw
```

如果 `openclaw` 不在 PATH，把全局 npm bin 加进 shell：

```bash
export PATH="$(npm prefix -g)/bin:$PATH"
```

## 阶段 4: 拉项目代码

```bash
sudo mkdir -p /opt
cd /opt
sudo git clone https://github.com/Jaxson-zip/to_do.git
sudo chown -R "$USER":"$USER" /opt/to_do
cd /opt/to_do
npm ci
npm run build
npm run bot:build-api-runtime
```

如果以后更新代码：

```bash
cd /opt/to_do
git pull
npm ci
npm run build
npm run bot:build-api-runtime
```

## 阶段 5: 创建服务器环境变量

```bash
sudo cp /opt/to_do/server/openclaw/todo-openclaw.env.example /etc/todo-openclaw.env
sudo nano /etc/todo-openclaw.env
sudo chmod 600 /etc/todo-openclaw.env
```

至少填这些：

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
BOT_TIME_ZONE=Asia/Shanghai
TODO_BOT_BASE_URL=http://127.0.0.1:8787
TODO_BOT_SECRET=use-the-same-value-as-vercel-BOT_WEBHOOK_SECRET
TODO_BOT_ALLOWED_CHANNELS=openclaw-weixin
TODO_LOCAL_API_HOST=127.0.0.1
TODO_LOCAL_API_PORT=8787
OPENCLAW_CHANNEL=openclaw-weixin
OPENCLAW_ACCOUNT=default
OPENCLAW_BIN=/path/from-command-v-openclaw
TODO_REMINDER_LIMIT=50
TODO_REMINDER_DRY_RUN=0
TODO_ILINK_CONNECTION_LIMIT=50
TODO_ILINK_REMINDER_LIMIT=50
TODO_ILINK_DRY_RUN=0
```

`OPENCLAW_BIN` 用这个命令查：

```bash
command -v openclaw
```

`TODO_BOT_SECRET` 是给 OpenClaw hook 用的服务器变量，值必须和 Vercel 的
`BOT_WEBHOOK_SECRET` 一样。本地 Todo API 启动时会把它映射成 handler 需要的
`BOT_WEBHOOK_SECRET`。

如果 `command -v node` 不是 `/usr/bin/node`，后面安装 timer 前要改对应 service
里的 `ExecStart`，例如 `todo-ilink-poller.service`、`todo-ilink-reminders.service`
或 `todo-openclaw-reminders.service`。

## 阶段 5.5: 安装推荐的 iLink 扫码轮询器

这一步对应网站同步面板的 `扫码连接`，不需要在服务器登录专门微信号。

```bash
cd /opt/to_do
npm run bot:build-api-runtime
sudo cp /opt/to_do/server/openclaw/systemd/todo-ilink-poller.service /etc/systemd/system/
sudo cp /opt/to_do/server/openclaw/systemd/todo-ilink-poller.timer /etc/systemd/system/
sudo cp /opt/to_do/server/openclaw/systemd/todo-ilink-reminders.service /etc/systemd/system/
sudo cp /opt/to_do/server/openclaw/systemd/todo-ilink-reminders.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now todo-ilink-poller.timer
sudo systemctl enable --now todo-ilink-reminders.timer
```

检查 timer：

```bash
systemctl list-timers '*todo-ilink*'
journalctl -u todo-ilink-poller.service -n 80 --no-pager
journalctl -u todo-ilink-reminders.service -n 80 --no-pager
```

手动 dry run：

```bash
cd /opt/to_do
sudo bash -lc '
  set -a
  . /etc/todo-openclaw.env
  set +a
  export TODO_ILINK_DRY_RUN=1
  cd /opt/to_do
  node server/openclaw/ilink-worker.mjs
'
```

单独测试提醒扫描：

```bash
cd /opt/to_do
sudo bash -lc '
  set -a
  . /etc/todo-openclaw.env
  set +a
  export TODO_ILINK_DRY_RUN=1
  export TODO_ILINK_REMINDERS_ONLY=1
  cd /opt/to_do
  node server/openclaw/ilink-worker.mjs
'
```

## 阶段 6: 启动本地 Todo API 服务

这一步只给备用 OpenClaw 绑定码模式使用，让 OpenClaw hook 调用本机 API，不经过 Vercel：

```bash
cd /opt/to_do
npm run bot:build-api-runtime
sudo cp /opt/to_do/server/openclaw/systemd/todo-openclaw-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now todo-openclaw-api.service
```

检查服务：

```bash
systemctl status todo-openclaw-api.service --no-pager
curl -sS http://127.0.0.1:8787/healthz
```

期望看到：

```json
{"ok":true}
```

如果 `command -v node` 不是 `/usr/bin/node`，先编辑 service 里的 `ExecStart`：

```bash
sudo nano /etc/systemd/system/todo-openclaw-api.service
```

## 阶段 7: 安装微信插件并扫码

```bash
npx -y @tencent-weixin/openclaw-weixin-cli@latest install
openclaw plugins list
```

配置本地 gateway。这里的 `loopback` 表示不对公网开放 OpenClaw 端口。

```bash
openclaw config set gateway.mode local
openclaw config set gateway.bind loopback
openclaw config set gateway.auth.mode token
openclaw config set gateway.auth.token "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
openclaw config validate
```

安装并启动 gateway：

```bash
openclaw gateway install --force
openclaw gateway start
openclaw gateway status
```

扫码登录专门微信号：

```bash
openclaw channels login --channel openclaw-weixin --account default --verbose
openclaw channels status --deep
```

期望看到 `openclaw-weixin ... running`。

## 阶段 8: 安装并启用 Todo hook

安装 hook 文件：

```bash
mkdir -p ~/.openclaw/hooks/todo-wechat
cp -r /opt/to_do/server/openclaw/todo-wechat-hook/* ~/.openclaw/hooks/todo-wechat/
ls -la ~/.openclaw/hooks/todo-wechat/
```

目录里必须有：

```text
HOOK.md
handler.ts
```

让 OpenClaw 发现并启用这个 hook：

```bash
openclaw hooks enable todo-wechat
openclaw hooks list --verbose
openclaw hooks info todo-wechat
```

`todo-wechat` 需要读 `/etc/todo-openclaw.env` 里的变量。先确认 OpenClaw
gateway 是系统级服务还是用户级服务：

```bash
systemctl list-units '*openclaw*' --all
systemctl --user list-units '*openclaw*' --all
```

如果是用户级服务：

```bash
systemctl --user edit <openclaw-service-name>
```

填入：

```ini
[Service]
EnvironmentFile=/etc/todo-openclaw.env
```

然后重启：

```bash
systemctl --user daemon-reload
systemctl --user restart <openclaw-service-name>
openclaw gateway status
```

如果是系统级服务：

```bash
sudo systemctl edit <openclaw-service-name>
```

填入同样内容：

```ini
[Service]
EnvironmentFile=/etc/todo-openclaw.env
```

然后重启：

```bash
sudo systemctl daemon-reload
sudo systemctl restart <openclaw-service-name>
openclaw gateway status
```

如果你暂时不确定服务名，也可以先手动带环境启动测试：

```bash
set -a
. /etc/todo-openclaw.env
set +a
openclaw gateway restart
openclaw hooks check
```

## 阶段 9: 安装提醒定时器

复制 systemd timer：

```bash
sudo cp /opt/to_do/server/openclaw/systemd/todo-openclaw-reminders.service /etc/systemd/system/
sudo cp /opt/to_do/server/openclaw/systemd/todo-openclaw-reminders.timer /etc/systemd/system/
```

如果 `command -v node` 不是 `/usr/bin/node`，先编辑 service：

```bash
sudo nano /etc/systemd/system/todo-openclaw-reminders.service
```

启用 timer：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now todo-openclaw-reminders.timer
```

检查：

```bash
systemctl list-timers '*todo-openclaw*'
journalctl -u todo-openclaw-reminders.service -n 80 --no-pager
```

手动 dry run，不真正发微信：

```bash
cd /opt/to_do
sudo bash -lc '
  set -a
  . /etc/todo-openclaw.env
  set +a
  export TODO_REMINDER_DRY_RUN=1
  cd /opt/to_do
  node server/openclaw/reminder-worker.mjs
'
```

如果 dry run 输出类似下面，说明脚本和 Supabase 通了：

```json
{"checked":0,"sent":0,"skipped":0,"failed":0,"details":[]}
```

## 阶段 10: 绑定网站账号和微信账号

1. 打开网站并登录。
2. 打开同步面板。
3. 点击 `生成绑定码`。
4. 在专门微信号聊天里发送生成的指令，例如：

```text
绑定 TD-1234567890
```

绑定成功后，这个微信会话的 sender id 会写进 `bot_bindings`。后续微信消息会写到同一个 Supabase 用户名下。
未绑定微信会话的普通消息会静默，只有 `绑定 TD-xxxxxx` 这类绑定指令会收到回复。

## 阶段 11: 端到端测试

在微信里发：

```text
任务列表
今天有什么
明天上午10点交作业，提前30分钟提醒
完成 交作业
```

在网站里同步，看任务是否出现。

再测提醒：

1. 在微信发一个几分钟后提醒的任务。
2. 看 timer 日志：

```bash
journalctl -u todo-openclaw-reminders.service -f
```

3. 到点后微信应该收到提醒。

## 常见问题

### Hook 没有触发

```bash
openclaw hooks list --verbose
openclaw hooks info todo-wechat
openclaw hooks check
openclaw gateway status
```

确认：

- `~/.openclaw/hooks/todo-wechat/HOOK.md` 存在。
- `~/.openclaw/hooks/todo-wechat/handler.ts` 存在。
- 已执行 `openclaw hooks enable todo-wechat`。
- gateway 重启后能读到 `/etc/todo-openclaw.env`。

### 微信插件没在线

```bash
openclaw channels status --deep
openclaw gateway status
```

如果显示没登录，重新扫码：

```bash
openclaw channels login --channel openclaw-weixin --account default --verbose
```

### 提醒没有发

先看日志：

```bash
journalctl -u todo-openclaw-reminders.service -n 120 --no-pager
```

常见原因：

- 没有绑定微信，`bot_bindings` 为空。
- 任务没有 `reminder_at`。
- timer 没启动。
- `OPENCLAW_BIN` 路径不对。
- `SUPABASE_SERVICE_ROLE_KEY` 没填或填错。

### API 返回 401

`TODO_BOT_SECRET` 必须和 Vercel 的 `BOT_WEBHOOK_SECRET` 完全一致。OpenClaw hook
请求本地 API 时会把这个值放在 `x-bot-secret` 请求头里。

### API 返回 500

先看本地 API 日志：

```bash
journalctl -u todo-openclaw-api.service -n 120 --no-pager
```

常见是 `/etc/todo-openclaw.env` 没有 `SUPABASE_SERVICE_ROLE_KEY`，或者 Supabase
还没执行最新版 SQL。

### 本地 API 没起来

```bash
systemctl status todo-openclaw-api.service --no-pager
curl -sS http://127.0.0.1:8787/healthz
journalctl -u todo-openclaw-api.service -n 120 --no-pager
```

确认：

- 已执行 `npm run bot:build-api-runtime`。
- `/opt/to_do/server/openclaw/api-runtime/bot/message.js` 存在。
- `/etc/todo-openclaw.env` 存在并且权限是 `600`。
- `todo-openclaw-api.service` 里的 `ExecStart` 指向正确的 `node`。

## 更新流程

代码更新后在服务器执行：

```bash
cd /opt/to_do
git pull
npm ci
npm run build
npm run bot:build-api-runtime
cp -r server/openclaw/todo-wechat-hook/* ~/.openclaw/hooks/todo-wechat/
openclaw hooks enable todo-wechat
openclaw gateway restart
sudo systemctl restart todo-openclaw-api.service
sudo systemctl restart todo-openclaw-reminders.timer
```

如果改了 systemd service 或 timer：

```bash
sudo cp server/openclaw/systemd/todo-openclaw-api.service /etc/systemd/system/
sudo cp server/openclaw/systemd/todo-openclaw-reminders.service /etc/systemd/system/
sudo cp server/openclaw/systemd/todo-openclaw-reminders.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart todo-openclaw-api.service
sudo systemctl restart todo-openclaw-reminders.timer
```

## 官方参考

- OpenClaw 安装要求和安装脚本：https://docs.openclaw.ai/install
- OpenClaw personal assistant 安全建议：https://docs.openclaw.ai/start/openclaw
- OpenClaw hooks 结构、`message:received`、`event.messages`：https://docs.openclaw.ai/automation/hooks
- OpenClaw `message send` 命令：https://docs.openclaw.ai/cli/message
