import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { demoUsers, openDemoDatabase } from "../src/demo/database";

async function loadMigrations() {
  const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
  return Promise.all((await readdir(dir)).sort().map((file) => readFile(join(dir, file), "utf8")));
}

describe("演示版使用真实 SQL", () => {
  it("演示数据能跑通，身份互相隔离", async () => {
    const demo = await openDemoDatabase(new PGlite(), await loadMigrations());
    try {
      const [lin, chen, zhou] = demoUsers.map((user) => user.id);
      const manager = await demo.command(lin, "snapshot", {});
      expect(manager.members).toHaveLength(3);
      const member = await demo.command(chen, "snapshot", {});
      // 管理者能看到和自己无关的事，后端只能看到自己经手的
      expect(manager.tasks.map((t: any) => t.title)).toContain("用户权限接口");
      expect(member.tasks.map((t: any) => t.title)).not.toContain("登录页改版");
      const incoming = manager.tasks.find((t: any) => t.title === "订单列表接口联调");
      expect(incoming.pending_owner_id).toBe(lin);
      // 卡住的交接要看起来等了两天
      const stuck = manager.tasks.find((t: any) => t.title === "优惠券接口对接");
      expect(stuck.pending_owner_id).toBe(zhou);
      const sent = manager.activities.find((a: any) => a.task_id === stuck.id && a.action === "handoff");
      expect(Date.now() - Date.parse(sent.created_at)).toBeGreaterThan(47 * 3600000);
      await expect(demo.command(lin, "accept_task", { workspaceId: manager.workspaces[0].id, taskId: incoming.id })).resolves.toMatchObject(
        {
          owner_id: lin,
        },
      );
      await expect(demo.command("unknown-user", "snapshot", {})).rejects.toThrow(/Unknown demo identity/);
    } finally {
      await demo.close();
    }
  }, 60000);

  it("每一步入队的群消息能取出来看，取过不再出现", async () => {
    const demo = await openDemoDatabase(new PGlite(), await loadMigrations());
    try {
      const [lin, chen] = demoUsers.map((user) => user.id);
      // 初始数据产生的消息不算访问者的操作
      await expect(demo.takeMessages()).resolves.toEqual([]);
      const workspaceId = (await demo.command(lin, "snapshot", {})).workspaces[0].id;
      const own = await demo.command(lin, "create_task", { workspaceId, title: "只记给自己" });
      await expect(demo.takeMessages()).resolves.toEqual([]);

      const handed = await demo.command(lin, "handoff_task", {
        workspaceId,
        taskId: own.id,
        expectedVersion: own.version,
        toUserId: chen,
        note: "接口好了",
      });
      const [message, ...others] = await demo.takeMessages();
      expect(others).toEqual([]);
      expect(message.message).toContain("【待接手】林晓 把「只记给自己」交给 陈晨");
      expect(message.message).toContain("交接说明：接口好了");
      expect(message.mentions).toEqual(["陈晨"]);
      await expect(demo.takeMessages()).resolves.toEqual([]);

      // 操作失败时事务回滚，不会有消息
      await expect(
        demo.command(lin, "complete_task", { workspaceId, taskId: handed.id, expectedVersion: handed.version }),
      ).rejects.toThrow();
      await expect(demo.takeMessages()).resolves.toEqual([]);
    } finally {
      await demo.close();
    }
  }, 60000);
});
