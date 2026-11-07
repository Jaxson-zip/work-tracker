import { describe, expect, it } from "vitest";
import { createDemoDatabase, demoUsers } from "../server/demo/database";
describe("explicit local demo using real team SQL", () => {
  it("keeps demo identities separate and persists a full owned-task workflow", async () => {
    const demo = await createDemoDatabase();
    try {
      const snapshot = await demo.command(demoUsers[0].id, "snapshot", {});
      expect(snapshot.members).toHaveLength(3);
      const workspaceId = snapshot.workspaces[0].id;
      const task = await demo.command(demoUsers[0].id, "create_task", { workspaceId, title: "演示闭环", ownerId: demoUsers[1].id });
      expect(task.pending_owner_id).toBe(demoUsers[1].id);
      await expect(demo.command(demoUsers[1].id, "accept_transfer", { workspaceId, taskId: task.id })).resolves.toMatchObject({
        owner_id: demoUsers[1].id,
        status: "in_progress",
      });
      await expect(demo.command("unknown-user", "snapshot", {})).rejects.toThrow(/Unknown demo identity/);
    } finally {
      await demo.close();
    }
  }, 60000);
});
