---
name: todo-wechat
description: "Forward incoming WeChat messages to the Todo bot API and reply with the API result."
metadata: { "openclaw": { "events": ["message:received"] } }
---

# Todo WeChat Hook

This hook is installed on the server running OpenClaw. It listens for inbound
WeChat messages, forwards them to the local Todo bot API, and pushes the API
reply back to the same OpenClaw message event.

Required environment variables:

- `TODO_BOT_BASE_URL`: local Todo bot API URL, for example `http://127.0.0.1:8787`
- `TODO_BOT_SECRET`: shared bot webhook secret, same value as `BOT_WEBHOOK_SECRET` in Vercel

Optional environment variables:

- `TODO_BOT_ALLOWED_CHANNELS`: comma-separated channel ids, for example `openclaw-weixin`
- `TODO_BOT_TIMEOUT_MS`: request timeout in milliseconds, default `12000`
