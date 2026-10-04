import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Conversation } from "../../shared/types";
import { api } from "../api";
import { timeAgo } from "./ui";

const REVEAL = 148;      // width of the Archive + Delete buttons
const AUTO_ARCHIVE = 220; // a long swipe archives straight away

/**
 * Conversations in the menu, with clean-up: swipe left for Archive / Delete, long swipe to archive,
 * or Select to archive or delete several at once. Archived ones are kept (and searchable).
 */
export default function ConversationList({ conversations, activeId, onOpen, onChanged }: {
  conversations: Conversation[]; activeId: string | null; onOpen: (id: string) => void; onChanged: () => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<Conversation[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (showArchived) api.conversations(true).then(setArchived).catch(() => {}); }, [showArchived, conversations]);

  const run = async (ids: string[], action: "archive" | "restore" | "delete") => {
    if (!ids.length) return;
    if (action === "delete" && !window.confirm(ids.length === 1 ? "Delete this conversation for good?" : `Delete ${ids.length} conversations for good?`)) return;
    setBusy(true);
    try {
      await api.conversationsBulk(ids, action);
      setPicked(new Set());
      setSelecting(false);
      onChanged();
      if (showArchived) setArchived(await api.conversations(true));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center justify-between px-5 pt-5 pb-1.5">
        <p className="text-[11px] font-medium text-muted uppercase tracking-[0.14em]">Conversations</p>
        {conversations.length > 0 && (
          <button onClick={() => { setSelecting((v) => !v); setPicked(new Set()); }} className="text-xs text-accent">
            {selecting ? "Cancel" : "Select"}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {conversations.length === 0 && <p className="px-3 py-2 text-sm text-muted">Nothing yet. Just start talking.</p>}
        {conversations.map((c) => (
          <SwipeRow key={c.id} disabled={selecting}
            onArchive={() => run([c.id], "archive")} onDelete={() => run([c.id], "delete")}>
            <button onClick={() => (selecting ? toggle(c.id) : onOpen(c.id))}
              className={`w-full text-left rounded-xl px-3 py-2.5 flex items-center gap-3 ${c.id === activeId && !selecting ? "bg-sunken" : "bg-surface hover:bg-sunken"}`}>
              {selecting && (
                <span className={`h-5 w-5 shrink-0 rounded-full border-2 grid place-items-center ${picked.has(c.id) ? "bg-accent border-accent" : "border-line"}`}>
                  {picked.has(c.id) && <svg viewBox="0 0 16 16" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3.5 8.5l3 3 6-7" /></svg>}
                </span>
              )}
              <span className="min-w-0">
                <span className="block text-[15px] truncate">{c.title || "New conversation"}</span>
                <span className="block text-xs text-muted">{timeAgo(c.last_message_at)}</span>
              </span>
            </button>
          </SwipeRow>
        ))}

        <button onClick={() => setShowArchived((v) => !v)} className="w-full text-left px-3 pt-4 pb-1 text-xs text-muted">
          {showArchived ? "▾" : "▸"} Archived
        </button>
        {showArchived && (archived.length === 0 ? <p className="px-3 py-1 text-xs text-muted">Nothing archived.</p> : archived.map((c) => (
          <div key={c.id} className="flex items-center gap-2 px-3 py-2">
            <button onClick={() => onOpen(c.id)} className="flex-1 min-w-0 text-left">
              <span className="block text-sm truncate text-muted">{c.title || "Conversation"}</span>
            </button>
            <button onClick={() => run([c.id], "restore")} className="text-xs text-accent">Restore</button>
            <button onClick={() => run([c.id], "delete")} className="text-xs text-danger">Delete</button>
          </div>
        )))}
      </div>

      {selecting && (
        <div className="flex gap-2 px-3 py-2 border-t border-line">
          <button disabled={!picked.size || busy} onClick={() => run([...picked], "archive")}
            className="flex-1 rounded-full bg-sunken py-2.5 text-sm font-medium disabled:opacity-40">Archive{picked.size ? ` (${picked.size})` : ""}</button>
          <button disabled={!picked.size || busy} onClick={() => run([...picked], "delete")}
            className="flex-1 rounded-full bg-danger text-white py-2.5 text-sm font-medium disabled:opacity-40">Delete{picked.size ? ` (${picked.size})` : ""}</button>
        </div>
      )}
    </div>
  );
}

/** Swipe left to reveal Archive / Delete; swipe far to archive at once. */
function SwipeRow({ children, onArchive, onDelete, disabled }: {
  children: ReactNode; onArchive: () => void; onDelete: () => void; disabled?: boolean;
}) {
  const [x, setX] = useState(0);
  const start = useRef<{ x: number; y: number; base: number; horizontal: boolean | null } | null>(null);
  const moved = useRef(false);

  useEffect(() => { if (disabled) setX(0); }, [disabled]);

  const down = (e: React.PointerEvent) => {
    if (disabled) return;
    start.current = { x: e.clientX, y: e.clientY, base: x, horizontal: null };
    moved.current = false;
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.horizontal === null && Math.abs(dx) + Math.abs(dy) > 8) s.horizontal = Math.abs(dx) > Math.abs(dy);
    if (!s.horizontal) return;
    moved.current = true;
    setX(Math.min(0, Math.max(-AUTO_ARCHIVE - 40, s.base + dx)));
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s?.horizontal) return;
    if (x <= -AUTO_ARCHIVE) { setX(0); onArchive(); return; }
    setX(x < -REVEAL / 2 ? -REVEAL : 0);
  };

  return (
    <div className="relative overflow-hidden rounded-xl select-none touch-pan-y">
      <div className={`absolute inset-y-0 right-0 flex ${x < 0 ? "" : "invisible"}`}>
        <button onClick={() => { setX(0); onArchive(); }} className="w-[74px] bg-accent text-accent-ink text-xs font-medium">Archive</button>
        <button onClick={() => { setX(0); onDelete(); }} className="w-[74px] bg-danger text-white text-xs font-medium">Delete</button>
      </div>
      <div
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClickCapture={(e) => { if (moved.current || x !== 0) { e.stopPropagation(); e.preventDefault(); if (!moved.current) setX(0); } moved.current = false; }}
        style={{ transform: `translateX(${x}px)`, transition: start.current ? "none" : "transform .2s ease" }}
        className="relative bg-surface">
        {children}
      </div>
    </div>
  );
}
