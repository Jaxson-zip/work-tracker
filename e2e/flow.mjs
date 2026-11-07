// 浏览器端到端：在本地演示模式（真实 SQL + PGlite）里，用三个身份走完整的转交流程。
// 不连接任何外部服务，不发真实消息。用法：npm run e2e（需要本机装有 Chrome 或 Edge）
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 5176;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "wt-e2e-"));
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  env: { ...process.env, VITE_WORK_TRACKER_DEMO: "1", WORK_TRACKER_DEMO_DIR: dir },
  stdio: "ignore",
  windowsHide: true,
});

let passed = 0;
function ok(condition, name) {
  if (!condition) throw new Error(`失败：${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function waitForServer() {
  for (let i = 0; i < 100; i += 1) {
    if (
      await fetch(BASE).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
    await new Promise((done) => setTimeout(done, 300));
  }
  throw new Error("开发服务器没有启动");
}

function helpers(page) {
  const row = (title) => page.locator(".task-row", { hasText: title });
  const group = (name) => page.getByRole("region", { name });
  return {
    row,
    group,
    as: async (name) => {
      await page.getByLabel("切换演示身份").selectOption({ label: name });
      await page.locator(".account .avatar", { hasText: name.slice(0, 1) }).waitFor();
      await page.locator(".nav button", { hasText: "我的事项" }).click();
      await page.getByRole("heading", { name: "我的事项" }).waitFor();
    },
    nav: (label) => page.locator(".nav button", { hasText: label }).click(),
    click: (title, label) => row(title).getByRole("button", { name: label, exact: true }).click(),
    confirm: async (fields) => {
      const dialog = page.locator("dialog[open]");
      if (fields.person) await dialog.locator("select").selectOption({ label: fields.person });
      if (fields.reason) await dialog.locator("textarea").fill(fields.reason);
      await dialog.locator('button:not([type="button"])').click();
      await dialog.waitFor({ state: "detached" });
    },
  };
}

async function recordAndHandoff(page, h) {
  const title = "端到端-下周五跟进投标文件";
  await page.getByLabel("记一件事").fill(title);
  await page.getByText("已从文字识别").waitFor();
  await page.getByRole("button", { name: "记下" }).click();
  const saved = h.row("端到端-跟进投标文件");
  await saved.waitFor();
  ok(/到期/.test(await saved.innerText()), "一句话记下，日期从文字里识别，标题去掉日期");

  await h.click("端到端-跟进投标文件", "转交");
  await h.confirm({ person: "陈晨", reason: "我要出差，请你接手" });
  await h.row("端到端-跟进投标文件").getByText("等陈晨接收").waitFor();
  ok((await h.group("等别人处理").innerText()).includes("端到端-跟进投标文件"), "转交后还在我这里，显示等对方接收");

  await page.getByRole("button", { name: "撤回转交" }).first().waitFor();
  ok(await h.row("端到端-跟进投标文件").getByRole("button", { name: "撤回转交" }).isVisible(), "接收前可以撤回");
}

async function rejectAndRetry(page, h) {
  await h.as("陈晨");
  ok((await h.group("等我接收").innerText()).includes("我要出差，请你接手"), "接收方看到说明");
  await h.click("端到端-跟进投标文件", "退回");
  await h.confirm({ reason: "这周排满了" });
  await h.as("林晓");
  await h.group("转交被退回").getByText("这周排满了").waitFor();
  ok(true, "退回后原负责人看到原因");
  await h.click("端到端-跟进投标文件", "转给别人");
  await h.confirm({ person: "陈晨", reason: "只需要周四前看一眼" });
  await h.row("端到端-跟进投标文件").getByText("等陈晨接收").waitFor();
}

async function acceptSubmitReview(page, h) {
  await h.as("陈晨");
  await h.click("端到端-跟进投标文件", "接收");
  await h.row("端到端-跟进投标文件").getByRole("button", { name: "提交验收" }).waitFor();
  ok(true, "接收后负责人变成接收方，别人交来的事要提交验收");
  await h.click("端到端-跟进投标文件", "提交验收");
  await h.row("端到端-跟进投标文件").getByText("等林晓验收").waitFor();

  await h.as("林晓");
  await h.click("端到端-跟进投标文件", "退回修改");
  await h.confirm({ reason: "还缺报价页" });
  await h.as("陈晨");
  await h.click("端到端-跟进投标文件", "提交验收");
  await h.row("端到端-跟进投标文件").getByText("等林晓验收").waitFor();
  await h.as("林晓");
  await h.click("端到端-跟进投标文件", "验收通过");
  await h.row("端到端-跟进投标文件").waitFor({ state: "hidden" });
  ok(true, "验收退回后可以重新提交，通过后收进最近完成");

  await page.locator("details summary", { hasText: "最近完成" }).click();
  await h.row("端到端-跟进投标文件").locator(".task-title").click();
  const timeline = await page.locator(".timeline").innerText();
  ok(
    ["发起转交", "退回了转交", "接收了转交", "还缺报价页"].every((text) => timeline.includes(text)),
    "详情里能看到完整经过",
  );
  await page.getByRole("button", { name: "关闭" }).click();
}

async function recordsAndBulkTransfer(page, h) {
  await h.nav("事务记录");
  await page.getByLabel("记录一件事").fill("端到端-客户要求改合同");
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await h.click("端到端-客户要求改合同", "生成待办");
  await h.confirm({ person: "周宁", reason: "和法务确认条款" });
  await h.row("端到端-客户要求改合同").getByRole("button", { name: "查看待办" }).waitFor();
  ok(true, "事务记录可以生成待办并指派");

  await h.nav("成员");
  await page.locator(".member-row", { hasText: "陈晨" }).getByRole("button", { name: "全部转出" }).click();
  await h.confirm({ person: "周宁", reason: "陈晨休假两周" });
  await h.as("周宁");
  const incoming = h.group("等我接收");
  ok((await incoming.innerText()).includes("筹备客户培训"), "休假交接：一个人的事项一次转出");
  await incoming.getByRole("button", { name: "全部接收" }).click();
  await incoming.waitFor({ state: "detached" });
  ok(await h.row("筹备客户培训").isVisible(), "全部接收后都到了接收方名下");
}

async function permissionsAndErrors(browser, page, h) {
  await h.as("陈晨");
  await h.nav("通知");
  ok(await page.getByText("发送记录只有管理员能看到").isVisible(), "普通成员看不到发送记录");
  await h.nav("全部事项");
  ok((await page.locator(".task-row button.primary").count()) === 0, "全部事项是总览，没有操作按钮");

  // 两个人同时操作：第二个人的旧版本被拒绝，看到中文提示。
  await h.as("林晓");
  const other = await browser.newPage();
  await other.goto(BASE);
  await other.getByRole("heading", { name: "我的事项" }).waitFor();
  await h.click("更新下季度产品路线图", "完成");
  await helpers(other).row("更新下季度产品路线图").getByRole("button", { name: "完成", exact: true }).click();
  await other.getByRole("alert").waitFor();
  const message = await other.getByRole("alert").innerText();
  ok(message.includes("别人刚改过") && !/conflict/i.test(message), "并发冲突给中文提示，不露英文错误");
  await other.close();
}

async function phone(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.getByRole("heading", { name: "我的事项" }).waitFor();
  for (const label of ["我的事项", "全部事项", "事务记录", "成员", "通知"]) {
    await page.locator(".nav button", { hasText: label }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 0, `手机宽度下「${label}」没有横向滚动`);
  }
  await context.close();
}

let browser;
let failed = false;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch({ channel: "msedge" }));
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(BASE);
  await page.getByRole("heading", { name: "我的事项" }).waitFor({ timeout: 60000 });
  const h = helpers(page);
  await recordAndHandoff(page, h);
  await rejectAndRetry(page, h);
  await acceptSubmitReview(page, h);
  await recordsAndBulkTransfer(page, h);
  await permissionsAndErrors(browser, page, h);
  await phone(browser);
  ok(errors.length === 0, `页面没有运行错误 ${errors.join(" | ")}`);
  console.log(`\n全部通过：${passed} 项`);
} catch (error) {
  failed = true;
  console.error(`\n${error.message}`);
} finally {
  await browser?.close();
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
  await new Promise((done) => setTimeout(done, 800));
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  process.exit(failed ? 1 : 0);
}
