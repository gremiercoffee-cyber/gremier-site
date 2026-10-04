"""
Chief of Staff desktop bridge for WhatsApp (Windows).

IN  - Watches WhatsApp Desktop's notifications in Windows' notification history and forwards
      only the ones free local rules judge actionable. Nothing else leaves this computer.
OUT - Picks up WhatsApp messages the user approved (tapped Send) and has Claude Code send them
      through WhatsApp Web in Chrome, then reports the result.

Standard library only. Config: bridge/config.json (see config.example.json). Log: bridge/bridge.log.
"""
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
if sys.stdout:  # pythonw has no console; the regular console is cp1252 and chokes on emoji
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
CONFIG = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
API = CONFIG["api_base"].rstrip("/")
KEY = CONFIG["bridge_key"]
MY_NAMES = [n.lower() for n in CONFIG.get("my_names", [])]
IGNORE_CHATS = {c.lower() for c in CONFIG.get("ignore_chats", [])}
ALWAYS_FROM = {c.lower() for c in CONFIG.get("always_forward_from", [])}
# The Chrome add-on (whatsapp-addon/) reads WhatsApp now; notification watching is a fallback.
WATCH_NOTIFICATIONS = CONFIG.get("watch_notifications", False)

DB = Path(os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db"))
STATE = HERE / "state.json"
POLL_IN_S, POLL_OUT_S = 3, 15

# Free, local "is this actionable?" rules. English + Hebrew.
ASKS = re.compile(
    r"\?|"
    r"\b(can you|could you|would you|will you|please|pls|plz|let me know|lmk|send( me)?|need|asap|urgent|"
    r"when (can|will|are|is)|what time|how much|price|invoice|order|deliver|pick ?up|call me|remind|"
    r"don'?t forget|tomorrow|today|tonight|by (mon|tue|wed|thu|fri|sun|sat|tomorrow|tonight|\d))\b|"
    r"(אפשר|תוכל|תוכלי|תשלח|תשלחי|צריך|צריכה|דחוף|מתי|כמה|מחיר|חשבונית|הזמנה|משלוח|תתקשר|תתקשרי|תזכיר|"
    r"אל תשכח|מחר|היום|הערב|בבקשה|תעדכן|תעדכני)",
    re.IGNORECASE,
)
NOISE = re.compile(r"^(📷|🎥|🎤|🎵|📄|📍|👤)|^(photo|video|sticker|gif|audio|voice message|missed (voice|video) call)\b|"
                   r"reacted |this message was deleted|הודעה זו נמחקה", re.IGNORECASE)


def log(msg: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    with open(HERE / "bridge.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def api(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"x-bridge-key": KEY, "content-type": "application/json", "user-agent": "ChiefOfStaffBridge/1.0 (Windows)"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        return {"last_id": 0}


def save_state(s: dict) -> None:
    STATE.write_text(json.dumps(s), encoding="utf-8")


# ---- Incoming ---------------------------------------------------------------
def read_whatsapp_toasts(after_id: int):
    """New WhatsApp toasts from Windows' notification history: (id, [text lines])."""
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)
    try:
        rows = con.execute(
            """SELECT n.Id, n.Payload FROM Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId
               WHERE h.PrimaryId LIKE '%WhatsApp%' AND n.Type = 'toast' AND n.Id > ? ORDER BY n.Id""",
            (after_id,),
        ).fetchall()
    finally:
        con.close()
    out = []
    for nid, payload in rows:
        try:
            xml = payload.decode("utf-8") if isinstance(payload, bytes) else payload
            texts = [t.text.strip() for t in ET.fromstring(xml).iter("text") if t.text and t.text.strip()]
        except Exception:
            texts = []
        out.append((nid, texts))
    return out


def judge(texts: list[str]):
    """Returns (chat, sender, message) if worth forwarding, else None. Pure local rules."""
    if len(texts) < 2:
        return None
    chat, body = texts[0], " ".join(texts[1:])
    sender, msg = chat, body
    group = False
    m = re.match(r"^(.{1,40}?):\s(.+)$", body, re.S)  # group toasts read "Sender: message"
    if m:
        group, sender, msg = True, m.group(1), m.group(2)
    if chat.lower() in IGNORE_CHATS or NOISE.search(msg):
        return None
    if chat.lower() in ALWAYS_FROM or sender.lower() in ALWAYS_FROM:
        return chat, sender, msg
    mentioned = "@" in msg or any(n in msg.lower() for n in MY_NAMES)
    if group and not mentioned:
        return None
    return (chat, sender, msg) if ASKS.search(msg) or mentioned else None


def poll_incoming(state: dict) -> None:
    for nid, texts in read_whatsapp_toasts(state.get("last_id", 0)):
        state["last_id"] = max(state.get("last_id", 0), nid)
        hit = judge(texts)
        if not hit:
            continue
        chat, sender, msg = hit
        try:
            r = api("POST", "/api/bridge/incoming", {"chat": chat, "sender": sender, "text": msg,
                                                      "at": datetime.now(timezone.utc).isoformat()})
            log(f"IN  {sender}: {'filed' if r.get('filed') else r.get('reason')}")
        except Exception as e:
            log(f"IN  forward failed: {e}")
    save_state(state)


# ---- Outgoing ---------------------------------------------------------------
CLAUDE = shutil.which("claude.cmd") or shutil.which("claude")

PROMPT = """You are sending ONE WhatsApp message that the user already approved by tapping Send in their Chief of Staff app.
Use only the Chrome browser tools.

1. Open a NEW tab at https://web.whatsapp.com. If it shows a QR code / asks to link a device, stop: the final line is RESULT: NOT_SENT: WhatsApp Web isn't signed in.
2. In the chat search box, search for exactly: {recipient}
3. If there is no matching chat, or more than one chat could be this person, do NOT send. Final line: RESULT: NOT_SENT: <what you saw>.
4. Otherwise open that chat, click the message box and type exactly the text between the markers, with no changes.
   For a line break press Shift+Enter (Enter alone sends).
<<<MESSAGE
{text}
MESSAGE>>>
5. Press Enter once to send. Check the message now appears in the chat as sent.
6. Close the tab you opened.

Your final line must be exactly "RESULT: SENT" or "RESULT: NOT_SENT: <reason>"."""


def send_via_claude(recipient: str, text: str):
    if not CLAUDE:
        return False, "Claude Code isn't installed on this computer."
    cmd = [CLAUDE, "-p", PROMPT.format(recipient=recipient, text=text), "--chrome",
           "--allowedTools", "mcp__claude-in-chrome__*", "--output-format", "text"]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=360,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    except subprocess.TimeoutExpired:
        return False, "Timed out. Check WhatsApp before resending."
    last = next((l for l in reversed(out.strip().splitlines()) if l.startswith("RESULT:")), "")
    if last.strip() == "RESULT: SENT":
        return True, ""
    return False, last.replace("RESULT: NOT_SENT:", "").strip() or "Claude Code didn't confirm the send."


def poll_outgoing() -> None:
    for job in api("GET", "/api/bridge/outbox") or []:
        log(f"OUT sending to {job['recipient']}")
        ok, detail = send_via_claude(job["recipient"], job["text"])
        log(f"OUT {job['recipient']}: {'sent' if ok else 'not sent: ' + detail}")
        api("POST", f"/api/bridge/outbox/{job['id']}", {"ok": ok, "detail": detail})


def main() -> None:
    state = load_state()
    if "last_id" not in state or state.get("first_run", True):
        # Don't replay old notifications on first start.
        existing = read_whatsapp_toasts(0)
        state = {"last_id": max([i for i, _ in existing], default=0), "first_run": False}
        save_state(state)
    log(f"Bridge started. Sending approved WhatsApps{"; watching notifications" if WATCH_NOTIFICATIONS else ""}. API {API}")
    last_out = 0.0
    while True:
        if WATCH_NOTIFICATIONS:
            try:
                poll_incoming(state)
            except Exception as e:
                log(f"IN  error: {e}")
        if time.time() - last_out >= POLL_OUT_S:
            last_out = time.time()
            try:
                poll_outgoing()
            except Exception as e:
                log(f"OUT error: {e}")
        time.sleep(POLL_IN_S)


if __name__ == "__main__":
    if "--test" in sys.argv:
        for t in sys.argv[sys.argv.index("--test") + 1:]:
            print(t, "->", judge(t.split("|")))
    else:
        main()
