import { describe, expect, it } from "vitest";
import { createDemoDatabase, demoUsers } from "../server/demo/database";

describe("本地演示使用真实 SQL", () => {
  it("演示数据能跑通，身份互相隔离", async () => {
    const demo = await createDemoDatabase();
    try {
      const [lin, chen] = demoUsers.map((user) => user.id);
      const manager = await demo.command(lin, "snapshot", {});
      expect(manager.members).toHaveLength(3);
      const member = await demo.command(chen, "snapshot", {});
      // 管理者能看到和自己无关的事，后端只能看到自己经手的
      expect(manager.tasks.map((t: any) => t.title)).toContain("用户权限接口");
      expect(member.tasks.map((t: any) => t.title)).not.toContain("登录页改版");
      const incoming = manager.tasks.find((t: any) => t.title === "订单列表接口联调");
      expect(incoming.pending_owner_id).toBe(lin);
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
});
