import type { Plugin } from "vite";
import { resolve } from "node:path";
import { createDemoDatabase } from "./database";
export function localDemoPlugin(): Plugin {
  return {
    name: "work-tracker-loopback-demo",
    apply: "serve",
    configureServer(server) {
      if (process.env.VITE_WORK_TRACKER_DEMO !== "1") return;
      const database = createDemoDatabase(resolve(process.cwd(), process.env.WORK_TRACKER_DEMO_DIR ?? ".demo-data"));
      server.httpServer?.once("close", () => {
        void database.then((db) => db.close());
      });
      server.middlewares.use("/__demo/command", async (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        const origin = req.headers.origin;
        if (
          req.method !== "POST" ||
          (origin && origin !== `http://${req.headers.host}`) ||
          !req.headers.host?.match(/^(127\.0\.0\.1|localhost):\d+$/)
        ) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: "Local demo access only" }));
          return;
        }
        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 32768) throw new Error("Request too large");
          }
          const payload = JSON.parse(body);
          if (
            typeof payload.userId !== "string" ||
            typeof payload.action !== "string" ||
            !payload.payload ||
            typeof payload.payload !== "object" ||
            Array.isArray(payload.payload)
          )
            throw new Error("Invalid request");
          const result = await (await database).command(payload.userId, payload.action, payload.payload);
          res.end(JSON.stringify(result));
        } catch (error) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Demo request failed" }));
        }
      });
    },
  };
}
