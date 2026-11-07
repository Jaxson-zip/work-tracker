# 飞书输入与通知

网页是主要工作入口。飞书提供两个可选通道：企业自建应用接收用户发给机器人的私聊文本；工作区群组的自定义机器人发送任务通知。两者是不同的机器人，输入回调不使用群机器人 webhook。

## 服务端配置

先在同一个 Supabase 项目执行 `supabase/migrations/202611060001_work_tracker.sql`，再部署 Node API。所有下列密钥仅放在部署平台的服务端环境中，不要加 `VITE_` 前缀，也不要提交到仓库。

| 环境变量 | 用途 |
| --- | --- |
| `VITE_SUPABASE_URL` | 现有服务端 Supabase 客户端使用的项目 URL；URL 本身不是密钥 |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端调用飞书接入及通知队列 RPC；绝不能发送到浏览器 |
| `FEISHU_ENCRYPT_KEY` | 飞书自建应用事件订阅的 Encrypt Key，必须配置 |
| `FEISHU_VERIFICATION_TOKEN` | 同一应用的 Verification Token，必须配置 |
| `FEISHU_TIME_ZONE` | 输入命令的 IANA 时区；优先于 `BOT_TIME_ZONE`，缺省为 `Asia/Shanghai` |
| `BOT_TIME_ZONE` | 未配置 `FEISHU_TIME_ZONE` 时使用的兼容设置 |
| `FEISHU_WORKSPACE_WEBHOOKS` | 工作区 UUID 到群机器人 URL、签名密钥的 JSON 映射 |
| `CRON_SECRET` | 调度 API 的独立随机 bearer 密钥；工作进程也需要同一值 |
| `FEISHU_DISPATCH_URL` | 仅工作进程需要；完整 HTTPS `/api/feishu/dispatch` 地址 |

通知映射示例只包含占位符：

```json
{
  "11111111-1111-4111-8111-111111111111": {
    "url": "https://open.feishu.cn/open-apis/bot/v2/hook/REPLACE_WITH_HOOK_ID",
    "secret": "REPLACE_WITH_BOT_SIGNING_SECRET"
  }
}
```

仅允许 `https://open.feishu.cn/open-apis/bot/v2/hook/<id>` 或 `https://open.larksuite.com/open-apis/bot/v2/hook/<id>`。不允许重定向、其他主机、额外路径、端口、用户名密码、查询参数或片段。每个配置项必须提供签名密钥。不要把 webhook 地址放在网页、任务正文或普通日志中。

## 接收事件

1. 在飞书开放平台创建企业自建应用，启用机器人能力。根据应用后台最新说明授予读取机器人私聊消息所需权限（通常为 `im:message.p2p_msg:readonly`），订阅 `im.message.receive_v1`，发布并使应用对测试成员可用。
2. 在事件与回调配置中启用加密，设置 Encrypt Key，并将 Encrypt Key 和 Verification Token 保存为上述服务端环境变量。
3. 将请求地址设为 `https://你的域名/api/feishu/events`。仅支持 POST。保留入口的 `bodyParser: false`，反向代理必须原样转发 HTTP 正文及三个 `X-Lark-*` 认证头。
4. URL 验证和正常事件均需签名、有效时间戳、加密信封及解密后 token。服务端检查原始正文 SHA-256 签名、前后 5 分钟时间窗，再进行 AES-256-CBC 解密与常量时间 token 比较。服务器时钟应同步。

支持的文本命令（前缀与内容间需要空白）：

```text
绑定 WT-网页生成的一次性绑定码
记录 今天与客户确认了交付范围
待办 明天9点 提交报告
任务 周五下午3点 跟进合同
```

登录网页并进入目标工作区，在设置中生成绑定码，再私聊机器人发送完整绑定命令。绑定码按原样传递，由数据库核验过期、单次使用和当前成员资格。网页刷新后查看绑定状态及新增内容；当前适配器不向私聊发送确认消息。

仅处理用户发给机器人的一对一文本消息。群消息、图片、其他事件及普通聊天会被安全忽略。任务默认优先级为 `normal`，负责人是绑定的网页用户。工作区和用户身份始终由签名事件的 `open_id` 与数据库绑定确定；正文中的用户或工作区字段只是文字。尚未绑定或成员已移除时，数据库忽略该消息并保存终态接收记录。重复 `message_id` 使用同一数据库接收键，不重复创建。

日期解析复用现有中文解析器。适配器先按配置时区计算墙上时间，再把该日历基准传给解析器，避免服务器 UTC 导致“今天／明天”偏移。仅持久化日期，不创建精确到分钟的闹钟；纯时间命令不会自动顺延到第二天。记录使用接收时的配置时区日期。输入正文上限为 10,000 字符，标题取前 160 字符。

## 群组通知和调度

为每个目标工作区创建群组自定义机器人，开启签名校验，将 webhook 和密钥填入映射。通知会发送到该工作区配置的群组；应确保群组成员有权查看该工作区任务。网页中的分配、进度变化及数据库到期扫描生成通知，不依赖浏览器是否打开。

`POST /api/feishu/dispatch` 仅接受 `Authorization: Bearer <CRON_SECRET>`。处理流程是扫描到期任务、领取最多 20 条带租约的通知、逐条发送、用领取 token 回写结果。只有 HTTP 成功且响应 JSON 的 `code` 严格为数字 `0` 才算发送成功。网络请求超时为 5 秒；函数部署需允许足够运行时间（入口声明最大 300 秒，受部署平台套餐限制）。

提供无编译依赖的 Node 24 单次工作进程。只需在工作进程的服务环境设置 `FEISHU_DISPATCH_URL` 和 `CRON_SECRET`，不需要 Supabase service key 或群机器人密钥：

```powershell
node G:\vibe-coding\work-tracker\server\feishu\notification-worker.mjs
```

在 Windows 任务计划程序中每分钟启动一次该命令，将“任务已运行时”的规则设为不启动新实例；或者用系统 cron 每分钟执行同一个脚本。不要将密钥放在命令行参数。也可以使用支持 POST 和保密请求头的服务器调度器直接调用 API。Vercel 原生 cron 发起 GET，不能直接指向此 POST 接口。工作进程只输出通用成功或失败提示，并以非零退出码报告调度或发送失败；不会打印 endpoint、密钥或远端响应正文。

数据库对领取设置 120 秒租约，并通过 `SKIP LOCKED` 避免并发重复领取。失败通知按照数据库退避时间重新进入待发送状态，最多 5 次尝试；超过上限标记为失败，需要管理员排查配置并处理队列。数据库扫描的“逾期／跟进日”使用数据库 `current_date`，应按团队业务日要求设置数据库时区；与输入解析时区保持一致。当前实现不提供失败队列的网页重试按钮。

发送采用至少一次语义：若飞书已接收消息但响应超时，或发送完成后数据库回写失败，重试可能产生重复群通知。任务数据与输入消息本身仍由数据库保证幂等。通知领取时重新检查成员与任务状态；已经送出的通知无法撤回。暂未配置映射时整个批次失败关闭；已配置的映射缺少某个工作区时，该条通知记录通用失败并按队列规则重试。

## 验证范围

自动测试使用加密签名样例和模拟的 Supabase RPC／fetch 边界，覆盖验签、重放时间窗、URL 验证、命令解析、工作区路由、签名推送和安全失败路径，测试不会调用真实飞书机器人。当前仓库未包含真实凭据，也未宣称已完成真实飞书连通验证。部署后应在隔离测试工作区完成绑定、创建任务、重复回调和群通知验收。

协议依据：[飞书回调说明](https://open.feishu.cn/document/event-subscription-guide/callback-subscription/receive-and-handle-callbacks)、[官方 SDK 验签源码](https://github.com/larksuite/node-sdk/blob/main/dispatcher/request-handle.ts)、[官方 SDK AES 源码](https://github.com/larksuite/node-sdk/blob/main/utils/aes-cipher.ts)、[自定义机器人签名说明](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot?lang=zh-CN)。适配器使用原生加密函数，以保留原始正文并强制启用全部验证，不引入 SDK 依赖。
