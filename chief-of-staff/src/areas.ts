import { useEffect, useState } from "react";
import { api } from "./api";

export interface Area { key: string; label: string; icon: string; about: string }

const FALLBACK: Area[] = [
  { key: "coffee", label: "Coffee", icon: "☕", about: "" },
  { key: "yeshiva", label: "Yeshiva", icon: "📚", about: "" },
  { key: "personal", label: "Personal", icon: "🏠", about: "" },
];
let cache: Area[] = (() => { try { return JSON.parse(localStorage.getItem("cos.areas") || "null") || FALLBACK; } catch { return FALLBACK; } })();
const listeners = new Set<(a: Area[]) => void>();

export function setAreas(a: Area[]) {
  cache = a;
  try { localStorage.setItem("cos.areas", JSON.stringify(a)); } catch { /* fine */ }
  listeners.forEach((l) => l(a));
}
export const reloadAreas = () => api.areas().then(setAreas).catch(() => {});

/** The user's areas (Coffee, Yeshiva, Personal and any they added), kept in sync across screens. */
export function useAreas() {
  const [areas, set] = useState(cache);
  useEffect(() => { listeners.add(set); reloadAreas(); return () => { listeners.delete(set); }; }, []);
  return areas;
}
/** Lookups that read the current list (screens that call useAreas() re-render when it changes). */
export const iconOf = (key: string | null | undefined) => cache.find((a) => a.key === key)?.icon ?? "";
export const nameOf = (key: string | null | undefined) => { const a = cache.find((x) => x.key === key); return a ? `${a.icon} ${a.label}` : key ?? ""; };
export const areaIcon = (areas: Area[], key: string | null | undefined) => areas.find((a) => a.key === key)?.icon ?? "";
export const areaName = (areas: Area[], key: string | null | undefined) => {
  const a = areas.find((x) => x.key === key);
  return a ? `${a.icon} ${a.label}` : key ?? "";
};
