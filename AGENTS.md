# 推进：工作约定

团队事项流转工具：记录事务、生成待办、转交给具体的人并由对方确认接收，通知发到企业微信或飞书群。

## 目录

- `src/team/`：页面。`logic.ts` 是分组和按钮规则，`client.ts` 负责调用和错误翻译。
- `supabase/migrations/`：表、权限和全部业务写入（`wt_command`）。
- `api/notify/`、`api/_notify/`：通知发送。`api/feishu/`、`api/_feishu/`：飞书机器人。
- `server/demo/`：本地演示（真实 SQL + PGlite）。`e2e/`：浏览器流程。

## 命令

`npm run demo`（本地演示）、`npm test`、`npm run e2e`、`npm run build`。

## 硬性规则

- 权限和状态流转只写在 SQL 的 `wt_command` 里。原因：只靠前端藏按钮挡不住直接调接口。`logic.ts` 的按钮规则要和 SQL 保持一致，改一边就要对照另一边。
- 转交在接收前不改变负责人。原因：通知可能没被看到，没人确认就不算交出去了。
- 写业务数据和通知入队在同一个事务里，发送放在事务之外。原因：网络失败不能让业务写入回滚，也不能丢通知。
- 数据库错误不直接展示，先在 `client.ts` 转成中文。新增 `raise exception` 时要补上对应文案。
- 密钥只放服务端环境变量，不加 `VITE_` 前缀，只提交 `.env.example`。测试不调用真实 Webhook。
- 界面上没有点了没反应的按钮：没权限或没部署的功能就不显示。
- 文件不超过 400 行。函数尽量不超过 50 行，页面组件超长时优先拆出子组件。
- 修 bug 要补能复现它的测试。

## 界面

精致工具风格，用 `styles.css` 里的令牌，不写死颜色。首页回答“现在该先做什么”，不加指标卡片和说明文字。动效只用 transform 和 opacity，时长不超过 200ms，并遵守 `prefers-reduced-motion`。改完要在 1280 和 390 宽度、浅色和深色下看截图。

## 完成标准

`npm run build`、`npm test`、`npm run e2e` 都通过，并且实际看过页面。推送、部署、发真实群消息要先得到确认。
