export const DEMO_ITEM_TITLES = [
  "点击输入框，创建任务",
  "用清单来管理任务",
  "日历：日程安排一目了然",
  "四象限：提升效率利器",
  "番茄专注：拯救拖延症",
  "习惯打卡：见证坚持与成长",
  "看板、时间线视图：可视化管理",
  "桌面便签：随时记录想法",
  "订阅日历：不再错过重要日程",
  "更多特色功能",
];

const demoItemTitleSet = new Set(DEMO_ITEM_TITLES);

export function isDemoItemTitle(title: string): boolean {
  return demoItemTitleSet.has(title);
}
