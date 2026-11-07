export function dateKeyInBotTimeZone(date = new Date()): string {
  return dateKeyInTimeZone(date, getBotTimeZone());
}

export function getBotTimeZone(): string {
  return process.env.BOT_TIME_ZONE || "Asia/Shanghai";
}

export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) return date.toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}
