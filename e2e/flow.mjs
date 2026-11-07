// 浏览器端到端：在本地演示模式（真实 SQL + PGlite）里，走一遍前端 → 后端 → 测试的交接。
// 不连接任何外部服务，不发真实消息。用法：npm run e2e（需要本机装有 Chrome 或 Edge）
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 5176;
const BASE = `http://127.0.0.1:${PORT}`;
const TITLE = "端到端-跟进退款接口";
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
  return {
    row,
    group: (name) => page.getByRole("region", { name }),
    as: async (name) => {
      const select = page.getByLabel("切换演示身份");
      const value = await select.locator("option", { hasText: name }).getAttribute("value");
      await Promise.all([page.waitForResponse((response) => response.url().includes("/__demo/command")), select.selectOption(value)]);
      await page.locator(".new-task").waitFor();
    },
    click: (title, label) => row(title).getByRole("button", { name: label, exact: true }).click(),
    fill: async ({ person, note }) => {
      const dialog = page.locator("dialog[open]");
      if (person) await dialog.locator("select").selectOption({ label: person });
      await dialog.locator("textarea").fill(note);
      await dialog.locator('button:not([type="button"])').click();
      await dialog.waitFor({ state: "detached" });
    },
  };
}

async function writeAndHand(page, h) {
  await page.getByLabel("写一条待办").fill(`下周五${TITLE}`);
  await page.getByRole("button", { name: "记下" }).click();
  await h.group("我的待办").getByText(TITLE).waitFor();
  const row = await h.row(TITLE).innerText();
  ok(row.includes("到期") && !row.includes("下周五") && row.includes("自己写的"), "一句话写待办：日期自动识别，显示自己写的");

  await h.click(TITLE, "交给下一位");
  await h.fill({ person: "陈晨", note: "退款页面做完了，需要后端提供退款接口" });
  await h.row(TITLE).getByText("等陈晨接手").waitFor();
  ok((await h.group("我交出去的").innerText()).includes(TITLE), "交出去后显示等对方接手");
}

async function rejectAndRetry(page, h) {
  await h.as("陈晨");
  ok((await h.group("等我接手").innerText()).includes("退款页面做完了"), "接手人收到时能看到交接说明");
  await h.click(TITLE, "退回");
  await h.fill({ note: "字段还没定，请先确认退款状态枚举" });
  await h.as("林晓");
  await h.group("我的待办").getByText("字段还没定").waitFor();
  ok(true, "被退回后回到原来的人手上，并显示原因");
  await h.click(TITLE, "交给下一位");
  await h.fill({ person: "陈晨", note: "枚举已确认，见接口文档" });
  await h.row(TITLE).getByText("等陈晨接手").waitFor();
}

async function relayToDone(page, h) {
  await h.as("陈晨");
  await h.click(TITLE, "接手");
  await h.group("我的待办").getByText(TITLE).waitFor();
  ok((await h.row(TITLE).innerText()).includes("林晓 交来的"), "接手后到了自己手上，显示谁交来的");
  await h.click(TITLE, "交给下一位");
  await h.fill({ person: "周宁", note: "接口发到测试环境了，请测试" });

  await h.as("周宁");
  await h.click(TITLE, "接手");
  await h.group("我的待办").getByText(TITLE).waitFor();
  await h.click(TITLE, "完成");
  await h.group("我的待办").getByText(TITLE).waitFor({ state: "detached" });
  ok(true, "最后一个人完成");
}

async function everyoneSeesFlow(page, h) {
  const openDone = async () => {
    await page.locator("details summary", { hasText: "已完成" }).click();
    await h.row(TITLE).locator(".task-title").click();
    await page.locator(".timeline").waitFor();
  };
  await h.as("陈晨");
  await openDone();
  const chain = await page.getByLabel("交接链").innerText();
  ok(chain.replace(/\s/g, "") === "林晓→陈晨→周宁", "经手的人能看到交接链");
  const timeline = await page.locator(".timeline").innerText();
  ok(
    ["写了这条待办", "退回了", "字段还没定", "枚举已确认", "接手了", "接口发到测试环境了", "完成了"].every((text) =>
      timeline.includes(text),
    ),
    "点开能看到每一步和交接说明",
  );
  await page.getByRole("button", { name: "关闭" }).click();
  ok(!(await page.getByRole("navigation", { name: "查看范围" }).isVisible()), "普通成员没有全队视图");
  ok(!(await page.getByText("登录页改版").isVisible()), "普通成员看不到和自己无关的事");

  await h.as("林晓");
  await page.getByRole("button", { name: "全队" }).click();
  const team = await page.locator(".page").innerText();
  ok(team.includes("用户权限接口") && team.includes("陈晨 → 周宁"), "管理者能看到全队每件事走到了谁手上");
  ok((await page.locator(".task-row button.primary").count()) === 0, "全队视图只看不操作");
  ok((await h.row("订单列表接口联调").innerText()).includes("等你接手"), "全队视图每一行都写明现在在谁那");
  await h.row("订单列表接口联调").locator(".task-title").click();
  ok((await page.locator(".drawer").innerText()).includes("陈晨 交来的"), "等我接手的待办，显示的是正在交给我的人");
  await page.getByRole("button", { name: "关闭" }).click();
  await h.row("用户权限接口").locator(".task-title").click();
  ok((await page.locator(".timeline").innerText()).includes("请测试各角色的权限"), "管理者能点开和自己无关的事看流转");
  await page.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "我的" }).click();
  ok((await h.group("我交出去的").getByRole("button", { name: "交给下一位" }).count()) === 0, "交出去的事，列表里不再有交接按钮");
}

async function conflictAndTeam(browser, page, h) {
  const other = await browser.newPage();
  await other.goto(BASE);
  await other.locator(".new-task").waitFor();
  await h.click("登录页改版", "完成");
  await h.group("我的待办").getByText("登录页改版").waitFor({ state: "detached" });
  await helpers(other).click("登录页改版", "完成");
  await other.getByRole("alert").waitFor();
  const message = await other.getByRole("alert").innerText();
  ok(message.includes("别人刚改过") && !/conflict/i.test(message), "两个人同时操作时给中文提示，不露英文错误");
  await other.close();

  await page.getByRole("button", { name: "订单系统项目组" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("button", { name: "生成邀请码" }).click();
  await dialog.locator("code").first().waitFor();
  ok((await dialog.innerText()).includes("陈晨"), "团队弹窗能看成员、生成邀请码");
  await dialog.getByRole("button", { name: "关闭" }).click();
}

async function phone(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator(".new-task").waitFor();
  await page.locator(".task-title").first().click();
  await page.locator(".timeline").waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 0, "手机宽度下没有横向滚动");
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
  await page.locator(".new-task").waitFor({ timeout: 60000 });
  const h = helpers(page);
  await writeAndHand(page, h);
  await rejectAndRetry(page, h);
  await relayToDone(page, h);
  await everyoneSeesFlow(page, h);
  await conflictAndTeam(browser, page, h);
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
