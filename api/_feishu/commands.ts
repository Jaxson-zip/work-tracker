import { parseTaskInput } from '../_bot/taskInputParser.js';
import { FeishuError, type FeishuEnv } from './types.js';

// The shared parser uses local Date getters. Give it a synthetic local wall clock
// built from the configured IANA zone; only its calendar dueDate is persisted.
function wallClock(now: Date, timeZone: string): Date {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch { throw new FeishuError(503, 'Invalid Feishu time zone configuration'); }
  const part = (name: string) => Number(parts.find(p => p.type === name)?.value);
  return new Date(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
}

export function parseFeishuCommand(text: string, now: Date, env: FeishuEnv): Record<string, unknown> | null {
  const match = text.trim().match(/^(绑定|记录|待办|任务)\s+([\s\S]+)$/);
  if (!match) return null;
  const [, action, input] = match;
  const body = input.trim();
  if (body.length > 10000) throw new FeishuError(400, 'Command too long');
  if (action === '绑定') return /^WT-\S+$/.test(body) ? { action: 'bind', code: body } : null;
  const base = wallClock(now, env.FEISHU_TIME_ZONE || env.BOT_TIME_ZONE || 'Asia/Shanghai');
  if (action === '记录') {
    const date = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    return { action: 'record', title: body.slice(0, 160), body, occurredOn: date, important: false };
  }
  const parsed = parseTaskInput(body, base, { rollPastTime: false });
  return { action: 'task', title: parsed.title.slice(0, 160), body, dueDate: parsed.dueDate, nextAction: '', followUpDate: null, priority: 'normal' };
}
