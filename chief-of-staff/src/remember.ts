import { useCallback, useState } from "react";

/**
 * Remembers which things are open (projects, sections) on this device, so a refresh doesn't expand
 * everything or fold it all away. Safe if storage is unavailable: it just starts closed each time.
 */
export function useOpenSet(key: string): [Set<string>, (id: string, open: boolean) => void] {
  const [set, setSet] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set<string>(); }
  });
  const toggle = useCallback((id: string, open: boolean) => {
    setSet((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id); else next.delete(id);
      try { localStorage.setItem(key, JSON.stringify([...next].slice(-200))); } catch { /* not remembered */ }
      return next;
    });
  }, [key]);
  return [set, toggle];
}

/** One remembered choice (e.g. the project open on the Projects page). */
export function useRemembered(key: string): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => { try { return localStorage.getItem(key); } catch { return null; } });
  const update = useCallback((v: string | null) => {
    setValue(v);
    try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch { /* not remembered */ }
  }, [key]);
  return [value, update];
}
