import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 和正式环境运行同一份迁移。auth 模式是 Supabase 提供的，这里只补测试需要的最小部分。
export async function createTestDatabase(users: string[]) {
  const db = new PGlite();
  await db.exec(`create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;`);
  for (let i = 0; i < users.length; i++)
    await db.query("insert into auth.users(id,email) values ($1, $2)", [users[i], `user${i}@example.test`]);
  const dir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
  for (const file of (await readdir(dir)).sort()) await db.exec(await readFile(join(dir, file), "utf8"));
  return db;
}
