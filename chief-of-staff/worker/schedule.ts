/** Schedule arithmetic in the user's time zone (research chats' weekly runs). */
import { localParts } from "./db";

export interface Schedule { kind: "hours" | "daily" | "weekly" | "monthly"; every_hours?: number; time?: string; weekdays?: number[]; day?: number }

/** The UTC instant for a local wall-clock time in tz. */
export function localToUtc(tz: string, ymd: string, hh: number, mm: number) {
  const target = Date.parse(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    guess += target - shown;
  }
  return new Date(guess);
}

/** Next time this schedule fires after `from`, in the user's time zone. */
export function nextRun(sched: Schedule, tz: string, from = new Date()): Date {
  if (sched.kind === "hours") return new Date(from.getTime() + Math.max(1, sched.every_hours ?? 6) * 3600_000);
  const [hh, mm] = (sched.time ?? "08:00").split(":").map((x) => Number(x) || 0);
  for (let d = 0; d < 400; d++) {
    const ymd = localParts(tz, new Date(from.getTime() + d * 86400_000)).date;
    const at = localToUtc(tz, ymd, hh, mm);
    if (at <= from) continue;
    const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    const dom = Number(ymd.slice(8, 10));
    if (sched.kind === "daily") return at;
    if (sched.kind === "weekly" && (sched.weekdays?.length ? sched.weekdays : [0]).includes(dow)) return at;
    if (sched.kind === "monthly" && dom === Math.min(28, Math.max(1, sched.day ?? 1))) return at;
  }
  return new Date(from.getTime() + 7 * 86400_000);
}
