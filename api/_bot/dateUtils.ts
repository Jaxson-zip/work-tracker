export function getToday(): string {
  return toDateKey(new Date());
}

export function addDays(dateValue: string, days: number): string {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function toDateKey(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function monthKey(date: Date): string {
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), 1)).slice(0, 7);
}

export function parseMonthKey(value: string): Date {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

export function shiftMonth(value: string, offset: number): string {
  const date = parseMonthKey(value);
  date.setMonth(date.getMonth() + offset);
  return monthKey(date);
}

export function shiftYear(value: string, offset: number): string {
  const date = parseMonthKey(value);
  date.setFullYear(date.getFullYear() + offset);
  return monthKey(date);
}
