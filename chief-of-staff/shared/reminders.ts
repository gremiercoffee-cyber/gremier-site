export interface RecurringReminder {
  id: string; title: string; notes: string; link: string; days: number[]; time: string;
  timezone: string; category: string | null; active: number;
}
export function localDate(at: Date, timezone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function followingMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}
export function monthlySlots(rule: Pick<RecurringReminder, 'days' | 'time' | 'timezone'>, month: string) {
  const [year, mon] = month.split('-').map(Number);
  const maxDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return [...new Set(rule.days.map(d => Math.min(d, maxDay)))].sort((a, b) => a - b).map(day => {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const target = Date.parse(`${date}T${rule.time}:00Z`);
    let guess = target;
    for (let i = 0; i < 4; i++) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: rule.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess)).map(x => [x.type, x.value]));
      const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
      guess += target - shown;
    }
    return new Date(guess).toISOString();
  });
}
