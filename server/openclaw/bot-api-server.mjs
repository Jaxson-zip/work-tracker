import http from "node:http";
import messageHandler from "./api-runtime/bot/message.js";
import remindersHandler from "./api-runtime/bot/reminders.js";

if (!process.env.BOT_WEBHOOK_SECRET && process.env.TODO_BOT_SECRET) {
  process.env.BOT_WEBHOOK_SECRET = process.env.TODO_BOT_SECRET;
}

const host = process.env.TODO_LOCAL_API_HOST || "127.0.0.1";
const configuredPort = Number(process.env.TODO_LOCAL_API_PORT || 8787);
const port = Number.isFinite(configuredPort) ? configuredPort : 8787;

const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url || "/", `http://${host}:${port}`).pathname;

    if (request.method === "GET" && pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (pathname === "/api/bot/message") {
      await invokeVercelHandler(messageHandler, request, response);
      return;
    }

    if (pathname === "/api/bot/reminders") {
      await invokeVercelHandler(remindersHandler, request, response);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error("[todo-bot-api] request failed", error);
    if (!response.headersSent) sendJson(response, 500, { error: "Local bot API failed" });
    else response.end();
  }
});

server.listen(port, host, () => {
  console.log(`[todo-bot-api] listening on http://${host}:${port}`);
});

async function invokeVercelHandler(handler, request, response) {
  const bodyText = await readBody(request);
  const vercelRequest = {
    method: request.method,
    headers: request.headers,
    body: bodyText || {},
  };
  const vercelResponse = createVercelResponse(response);
  await handler(vercelRequest, vercelResponse);
}

function createVercelResponse(response) {
  return {
    statusCode: 200,
    status(statusCode) {
      this.statusCode = statusCode;
      response.statusCode = statusCode;
      return this;
    },
    setHeader(name, value) {
      response.setHeader(name, value);
      return this;
    },
    json(payload) {
      sendJson(response, this.statusCode, payload);
      return this;
    },
  };
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
