// ─── GREMIER COFFEE — NOTIFICATIONS EDGE FUNCTION ────────────────────────────
// File location: supabase/functions/notifications/index.ts
//
// Deploy with:  npx supabase functions deploy notifications
// Cron calls (every 5 min for reminders):
//   { "type": "reminders" }
// Morning / afternoon crons:
//   { "type": "morning" }  /  { "type": "afternoon" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://ayuzmwpmhncxrugsyxmw.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const PUSHOVER_USER = Deno.env.get("PUSHOVER_USER_KEY") || "";
const PUSHOVER_TOKEN = Deno.env.get("PUSHOVER_API_TOKEN") || "";
const TIMEZONE = "Asia/Jerusalem";

const CONCENTRATE_LABELS: Record<string, string> = {
  classic: "Classic",
  houseBlend: "House Blend",
  colombia: "Colombia",
  decaf: "Decaf",
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function todayJerusalem(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function nowJerusalemMinutes(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE, hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  const m = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
  return h * 60 + m;
}

function formatTime(t: string): string {
  if (!t) return "";
  return t.includes("T") ? t.slice(11, 16) : t.slice(0, 5);
}

function timeStrToMins(t: string): number {
  if (!t) return -1;
  if (t.includes("T")) {
    const d = new Date(t);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE, hour: "numeric", minute: "numeric", hour12: false,
    }).formatToParts(d);
    const h = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
    const m = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
    return h * 60 + m;
  }
  const parts = t.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function isActiveJob(j: any): boolean {
  if (j.done) return false;
  // Only hide in-progress brew rows — never hide drain jobs
  if (j.type === "brew" && j.brew_started) return false;
  return true;
}

async function sendPushover(title: string, message: string, priority = 0) {
  await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: PUSHOVER_TOKEN,
      user: PUSHOVER_USER,
      title,
      message,
      priority,
    }),
  });
}

function jobDisplayName(j: any): string {
  if (j.type === "drain") {
    const label = CONCENTRATE_LABELS[j.product] || j.product || "concentrate";
    return `Drain ${label} (${j.kg || 3}kg)`;
  }
  return j.store_name || j.private_name || j.cb_name || j.label || j.type;
}

function typeIcon(type: string): string {
  if (type === "delivery") return "📦";
  if (type === "brew") return "☕";
  if (type === "drain") return "🧪";
  if (type === "bottling") return "🍶";
  if (type === "labeling") return "🏷";
  return "📋";
}

// ─── BUILD DAILY SUMMARY LINES (shared by morning + afternoon) ────────────────

function buildDailySummaryLines(jobs: any[], today: string): string[] {
  const active = (jobs || []).filter(isActiveJob);
  const todayJobs = active.filter((j) => j.date === today);
  const overdue = active.filter((j) => j.date < today);
  const lines: string[] = [];

  const deliveries = todayJobs.filter((j) => j.type === "delivery");
  const drains = [...overdue.filter((j) => j.type === "drain"), ...todayJobs.filter((j) => j.type === "drain")];
  const production = todayJobs.filter((j) => j.type !== "delivery" && j.type !== "drain");

  if (deliveries.length > 0) {
    lines.push(`📦 DELIVERIES (${deliveries.length})`);
    deliveries.forEach((j) => {
      const name = jobDisplayName(j);
      const time = j.time ? " @ " + formatTime(j.time) : "";
      lines.push(`• ${name}${time}`);
    });
  }

  if (drains.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`🧪 DRAINS DUE (${drains.length})`);
    drains.forEach((j) => {
      const overdueTag = j.date < today ? " ⚠ overdue" : "";
      const time = j.time ? " @ " + formatTime(j.time) : "";
      lines.push(`• ${jobDisplayName(j)}${time}${overdueTag}`);
    });
  }

  if (production.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`⚗ PRODUCTION (${production.length})`);
    production.forEach((j) => {
      const time = j.time ? " @ " + formatTime(j.time) : "";
      lines.push(`• ${j.label || j.type}${time}`);
    });
  }

  if (todayJobs.length === 0 && overdue.length === 0) {
    lines.push("Nothing scheduled for today.");
  }

  const overdueNonDrain = overdue.filter((j) => j.type !== "drain");
  if (overdueNonDrain.length > 0) {
    lines.push("");
    lines.push(`⚠ OVERDUE (${overdueNonDrain.length})`);
    overdueNonDrain.forEach((j) => lines.push(`• ${jobDisplayName(j)} (${j.date})`));
  }

  return lines;
}

// ─── NOTIFICATION HANDLERS ────────────────────────────────────────────────────

async function handleMorning(supabase: any) {
  const { data: jobs } = await supabase.from("jobs").select("*");
  const today = todayJerusalem();
  const lines = buildDailySummaryLines(jobs || [], today);
  const drainCount = (jobs || []).filter((j: any) => j.type === "drain" && isActiveJob(j) && j.date <= today).length;

  const dateLabel = new Date().toLocaleDateString("en-IL", {
    timeZone: TIMEZONE, weekday: "short", day: "numeric", month: "short",
  });

  const title = drainCount > 0
    ? `☕ Gremier — ${dateLabel} (${drainCount} drain${drainCount === 1 ? "" : "s"} due)`
    : `☕ Gremier — ${dateLabel}`;

  await sendPushover(title, lines.join("\n"), 0);
}

async function handleAfternoon(supabase: any) {
  const { data: jobs } = await supabase.from("jobs").select("*");
  const today = todayJerusalem();
  const lines = buildDailySummaryLines(jobs || [], today);
  const drainCount = (jobs || []).filter((j: any) => j.type === "drain" && isActiveJob(j) && j.date <= today).length;

  const title = drainCount > 0
    ? `📋 Afternoon Update (${drainCount} drain${drainCount === 1 ? "" : "s"} due)`
    : "📋 Afternoon Update";

  await sendPushover(title, lines.join("\n"), 0);
}

async function handleReminders(supabase: any) {
  const { data: jobs } = await supabase.from("jobs").select("*");
  const today = todayJerusalem();
  const nowMins = nowJerusalemMinutes();

  for (const j of (jobs || [])) {
    if (!isActiveJob(j)) continue;
    if (!j.time) continue;
    // Timed reminders only for today or overdue (not future dates)
    if (j.date > today) continue;

    const jobMins = timeStrToMins(j.time);
    if (jobMins < 0) continue;

    const minsUntil = j.date === today ? jobMins - nowMins : -999;

    const name = jobDisplayName(j);

    // ── 30-min-before reminder (today's timed jobs, including drain) ──
    if (j.date === today && minsUntil >= 25 && minsUntil <= 35) {
      const { data: existing } = await supabase
        .from("notifications_sent")
        .select("id")
        .eq("job_id", j.id)
        .eq("notif_type", "30min")
        .maybeSingle();

      if (!existing) {
        const icon = typeIcon(j.type);
        const typeLabel = j.type === "delivery" ? "Delivery"
          : j.type === "drain" ? "Drain"
          : j.type === "brew" ? "Brew"
          : j.type === "bottling" ? "Bottling"
          : j.type === "labeling" ? "Labeling"
          : "Job";

        await sendPushover(
          `${icon} ${typeLabel} in 30 min`,
          `${name} @ ${formatTime(j.time)}`,
          1,
        );

        await supabase.from("notifications_sent").insert({
          job_id: j.id,
          notif_type: "30min",
        });
      }
    }

    // ── Drain "do it now" — wider window so cron won't miss it ──
    if (j.type === "drain" && j.date === today && minsUntil >= -10 && minsUntil <= 5) {
      const { data: existing } = await supabase
        .from("notifications_sent")
        .select("id")
        .eq("job_id", j.id)
        .eq("notif_type", "drain_now")
        .maybeSingle();

      if (!existing) {
        await sendPushover("🧪 Drain Now!", `Time to drain: ${name} @ ${formatTime(j.time)}`, 2);
        await supabase.from("notifications_sent").insert({
          job_id: j.id,
          notif_type: "drain_now",
        });
      }
    }

    // ── Overdue drain — one-time alert if past due and not done ──
    if (j.type === "drain" && j.date < today) {
      const { data: existing } = await supabase
        .from("notifications_sent")
        .select("id")
        .eq("job_id", j.id)
        .eq("notif_type", "drain_overdue")
        .maybeSingle();

      if (!existing) {
        await sendPushover(
          "🧪 Overdue Drain!",
          `${name} was due ${j.date}${j.time ? " @ " + formatTime(j.time) : ""}`,
          1,
        );
        await supabase.from("notifications_sent").insert({
          job_id: j.id,
          notif_type: "drain_overdue",
        });
      }
    }
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }

  const type = body.type || "morning";

  try {
    if (type === "morning") await handleMorning(supabase);
    if (type === "afternoon") await handleAfternoon(supabase);
    if (type === "reminders") await handleReminders(supabase);

    return new Response(JSON.stringify({ ok: true, type }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
