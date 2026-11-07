// 浏览器端到端：在本地演示模式（真实 SQL + PGlite）里，走一遍前端 → 后端 → 测试的交接。
// 不连接任何外部服务，不发真实消息。测的就是要发布的演示构建。
// 用法：npm run e2e（需要本机装有 Chrome 或 Edge）；E2E_URL=线上地址 node e2e/flow.mjs 可以直接测线上。
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const PORT = 5176;
const BASE = process.env.E2E_URL ?? `http://127.0.0.1:${PORT}`;
const TITLE = "端到端-跟进退款接口";
const server = process.env.E2E_URL
  ? null
  : spawn(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "preview", "--outDir", "dist-demo", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );

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
  const row = (title) => page.locator(".task-row, .incoming-card", { hasText: title });
  const flow = page.locator(".pane-flow");
  return {
    row,
    flow,
    preview: page.getByRole("status", { name: "群消息预览" }),
    group: (name) => page.getByRole("region", { name }),
    as: async (name) => {
      const button = page.getByRole("group", { name: "切换演示身份" }).getByRole("button", { name });
      await button.click();
      // 新身份的数据读回来之后，按钮才以选中状态重新出现。
      await page.locator('[aria-label="切换演示身份"] button[aria-pressed="true"]', { hasText: name }).waitFor();
    },
    open: (title) => row(title).locator(".task-main, .incoming-open").first().click(),
    press: (label) => flow.getByRole("button", { name: label, exact: true }).click(),
    send: async ({ person, note }) => {
      const form = page.locator(".flow-form");
      if (person) await form.getByRole("group").getByRole("button", { name: person }).click();
      await form.locator("textarea").fill(note);
      await form.locator('button:not([type="button"])').click();
      await form.waitFor({ state: "detached" });
    },
  };
}

async function writeAndHand(page, h) {
  await page.getByLabel("写一条待办").fill(`下周五${TITLE}`);
  await page.locator(".new-task-due").waitFor();
  await page.getByRole("button", { name: "不要日期" }).click();
  await page.locator(".new-task-due").waitFor({ state: "detached" });
  ok(true, "日期识别错了可以不要");
  await page.getByLabel("写一条待办").fill(`下周五${TITLE} `);
  await page.locator(".new-task-due").waitFor();
  await page.getByRole("button", { name: "记下" }).click();
  await h.group("我手上").getByText(TITLE).waitFor();
  const row = await h.row(TITLE).innerText();
  ok(row.includes("到期") && !row.includes("下周五") && row.includes("自己写的"), "一句话写待办：日期自动识别，显示自己写的");
  ok((await h.flow.locator("h1").innerText()) === TITLE, "写完右边直接显示这一条的流转");
  ok((await h.row(TITLE).getByRole("button").count()) === 0, "我手上的行里不放按钮，操作都在右边");
  ok((await h.preview.count()) === 0, "只记给自己的事不发群消息");

  await h.press("做完了，交给下一位");
  await h.send({ person: "陈晨", note: "退款页面做完了，需要后端提供退款接口" });
  await h.row(TITLE).getByText("等陈晨接手").waitFor();
  ok((await h.group("我交出去的").innerText()).includes(TITLE), "交出去后显示等对方接手");
  ok((await h.flow.getByLabel("交接链").innerText()).includes("等接手"), "交接链上标出等接手的人");
  ok((await page.locator(".notice").innerText()).includes("已交给陈晨"), "交出去后有确认提示");
  ok((await h.flow.locator(".flow-source").innerText()).includes("自己写的"), "自己写的事交出去后，来源还是自己写的");
  const sent = await h.preview.innerText();
  ok(
    sent.includes("【待接手】林晓") && sent.includes("退款页面做完了") && sent.includes("@陈晨"),
    "交接后能看到发到群里的消息，并 @ 接手人",
  );
  await h.preview.getByRole("button", { name: "知道了" }).click();
  ok((await h.preview.count()) === 0, "群消息预览可以关掉");
}

async function rejectAndRetry(page, h) {
  await h.as("陈晨");
  ok((await h.group("等我接手").innerText()).includes("退款页面做完了"), "接手人收到时能看到交接说明");
  await h.row(TITLE).getByRole("button", { name: "退回", exact: true }).click();
  await h.send({ note: "字段还没定，请先确认退款状态枚举" });
  const rejected = await h.preview.innerText();
  ok(
    rejected.includes("【被退回】陈晨") && rejected.includes("字段还没定") && rejected.includes("@林晓"),
    "退回的原因也发到群里，并 @ 原来的人",
  );
  await h.as("林晓");
  ok((await h.preview.count()) === 0, "切换身份后不留上一个人的群消息预览");
  await h.group("我手上").getByText("字段还没定").waitFor();
  ok(true, "被退回后回到原来的人手上，并显示原因");
  await h.open(TITLE);
  await h.press("做完了，交给下一位");
  await h.send({ person: "陈晨", note: "枚举已确认，见接口文档" });
  await h.row(TITLE).getByText("等陈晨接手").waitFor();
}

async function relayToDone(page, h) {
  await h.as("陈晨");
  await h.row(TITLE).getByRole("button", { name: "接手", exact: true }).click();
  await h.group("我手上").getByText(TITLE).waitFor();
  ok((await h.row(TITLE).innerText()).includes("林晓 交来的"), "接手后到了自己手上，显示谁交来的");
  ok((await h.preview.innerText()).includes("【已接手】陈晨"), "接手的消息发到群里，交出去的人知道对方收到了");
  await h.open(TITLE);
  await h.press("做完了，交给下一位");
  await h.send({ person: "周宁", note: "接口发到测试环境了，请测试" });

  await h.as("周宁");
  await h.open(TITLE);
  await h.press("接手");
  await h.group("我手上").getByText(TITLE).waitFor();
  await h.press("到此结束");
  await h.group("我手上").getByText(TITLE).waitFor({ state: "detached" });
  ok(await h.group("已完成").getByText(TITLE).isVisible(), "最后一个人结束，刚结束的事在已完成里能看到");
}

async function everyoneSeesFlow(page, h) {
  await h.as("陈晨");
  await page.getByRole("button", { name: /已完成/ }).click();
  await h.open(TITLE);
  await h.flow.locator(".timeline").waitFor();
  const names = await h.flow.locator(".chain-name").allInnerTexts();
  ok(names.join(">") === "林晓>陈晨（你）>周宁", "经手的人能看到交接链");
  const timeline = await h.flow.locator(".timeline").innerText();
  ok(
    ["写了这条待办", "退回了", "字段还没定", "枚举已确认", "接手了", "接口发到测试环境了", "完成了"].every((text) =>
      timeline.includes(text),
    ),
    "点开能看到每一步和交接说明",
  );
  ok(!(await page.getByRole("navigation", { name: "查看范围" }).isVisible()), "普通成员没有全队视图");
  ok(!(await page.getByText("登录页改版").isVisible()), "普通成员看不到和自己无关的事");

  await h.as("林晓");
  await h.open("订单列表接口联调");
  ok((await h.flow.innerText()).includes("陈晨 交来的"), "等我接手的待办，显示的是正在交给我的人");
  await page.getByRole("button", { name: "全队" }).click();
  ok((await page.locator(".incoming-card").count()) === 0, "全队视图没有接手按钮，只看流转");
  ok((await h.group("交接中，等人接手").innerText()).includes("陈晨 → 林晓"), "全队先列卡在交接路上的");
  ok((await h.group("周宁手上").innerText()).includes("用户权限接口"), "全队按人看各自手上的事");
  await h.open("用户权限接口");
  ok((await h.flow.locator(".timeline").innerText()).includes("请测试各角色的权限"), "管理者能点开和自己无关的事看流转");
  ok((await h.flow.innerText()).includes("只看流转"), "别人手上的事，管理者默认只看");
  await h.flow.getByRole("button", { name: "代为交接" }).click();
  await h.flow.locator(".flow-form").waitFor();
  await h.flow.getByRole("button", { name: "取消" }).click();
  ok(true, "成员要离开时，管理者还能代为交接");
  await page.getByRole("button", { name: "我的" }).click();
}

async function editAndTeam(page, h) {
  await h.open("整理下周发布清单");
  await h.flow.getByRole("button", { name: "修改", exact: true }).click();
  const form = page.locator(".flow-form");
  await form.locator('input[type="date"]').fill("2030-01-15");
  await form.locator("input").first().fill("整理发布清单");
  await form.locator('button:not([type="button"])').click();
  await form.waitFor({ state: "detached" });
  await h.group("我手上").getByText("整理发布清单").waitFor();
  const history = await h.flow.locator(".timeline").innerText();
  ok(history.includes("把标题改成「整理发布清单」") && history.includes("2030-01-15"), "能改标题和日期，修改也留在流转里");

  await page.getByRole("button", { name: "全队" }).click();
  ok((await h.group("交接中，等人接手").innerText()).includes("等了 2 天"), "管理者能看到交接已经等了多久");
  await page.getByRole("button", { name: "我的" }).click();

  await page.getByRole("button", { name: /订单系统项目组/ }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("button", { name: "生成邀请码" }).click();
  await dialog.locator("code").first().waitFor();
  ok((await dialog.innerText()).includes("陈晨"), "团队弹窗能看成员、生成邀请码");
  page.once("dialog", (confirm) => void confirm.accept());
  await dialog.locator(".member-row", { hasText: "陈晨" }).getByRole("button", { name: "移除" }).click();
  await dialog.getByRole("alert").waitFor();
  ok((await dialog.getByRole("alert").innerText()).includes("交给别人"), "成员手上还有事时不能移除，提示显示在弹窗里");
  await dialog.getByRole("button", { name: "关闭" }).click();
}

async function acceptFromCard(page, h) {
  await h.open("整理下周发布清单");
  await h.row("订单列表接口联调").getByRole("button", { name: "接手", exact: true }).click();
  await h.group("我手上").getByText("订单列表接口联调").waitFor();
  ok((await h.flow.locator("h1").innerText()) === "订单列表接口联调", "从卡片接手后，右边切到刚接手的这一条");
}

async function slowNetwork(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/*.wasm", async (route) => {
    await new Promise((done) => setTimeout(done, 10000));
    await route.continue();
  });
  await page.goto(BASE);
  await page.getByText("网络有点慢").waitFor({ timeout: 20000 });
  ok(true, "网络慢时如实提示还在下载，不让人以为打不开");
  await page.locator(".new-task").waitFor({ timeout: 60000 });
  ok(true, "慢网络下等一会儿也能正常打开");
  await context.close();
}

async function phone(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator(".new-task").waitFor();
  const h = helpers(page);
  ok(!(await h.flow.isVisible()), "手机上先看列表，流转不占地方");
  await h.open("整理下周发布清单");
  await h.flow.locator(".timeline").waitFor();
  ok(!(await page.locator(".new-task").isVisible()), "手机上点开后只看这一条的流转");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 0, "手机宽度下没有横向滚动");
  await page.getByRole("button", { name: "← 返回" }).click();
  await page.locator(".new-task").waitFor();
  ok(true, "手机上能返回列表");
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
  ok((await page.locator(".demo-hint").count()) === 1, "演示版提示只出现一次");
  await writeAndHand(page, h);
  await rejectAndRetry(page, h);
  await relayToDone(page, h);
  await everyoneSeesFlow(page, h);
  await editAndTeam(page, h);
  await page.reload();
  await page.locator(".new-task").waitFor({ timeout: 60000 });
  ok(await page.getByText("整理下周发布清单").isVisible(), "演示版刷新后恢复初始数据");
  await acceptFromCard(page, h);
  await slowNetwork(browser);
  await phone(browser);
  ok(errors.length === 0, `页面没有运行错误 ${errors.join(" | ")}`);
  console.log(`\n全部通过：${passed} 项`);
} catch (error) {
  failed = true;
  console.error(`\n${error.message}`);
} finally {
  await browser?.close();
  if (server && process.platform === "win32") spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server?.kill();
  process.exit(failed ? 1 : 0);
}
