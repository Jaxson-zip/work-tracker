import { PGlite } from "@electric-sql/pglite";
import { openDemoDatabase } from "./database";

const files = import.meta.glob<string>("../../supabase/migrations/*.sql", { query: "?raw", import: "default", eager: true });

// 数据库放在内存里：每个访问者一份，互不影响，刷新就恢复。
let demo: ReturnType<typeof openDemoDatabase> | null = null;

export async function demoCommand(userId: string, action: string, payload: Record<string, unknown>) {
  demo ??= openDemoDatabase(
    new PGlite(),
    Object.keys(files)
      .sort()
      .map((path) => files[path]),
  );
  return (await demo).command(userId, action, payload);
}
