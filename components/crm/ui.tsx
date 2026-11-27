"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export const TZ = "America/Los_Angeles";
type Msg = { text: string; err?: boolean; href?: string };
const ToastCtx = createContext<(text: string, o?: { err?: boolean; href?: string }) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<Msg | null>(null);
  const notify = useCallback((text: string, o?: { err?: boolean; href?: string }) => setMsg({ text, ...o }), []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), msg.err ? 6000 : 3200); return () => clearTimeout(t); }, [msg]);
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className={`toast${msg?.err ? " err" : ""}`} data-show={!!msg} role="status" aria-live="polite">
        {msg?.text}{msg?.href && <> · <a href={msg.href}>Open</a></>}
      </div>
    </ToastCtx.Provider>
  );
}

/** Run a server action that returns {ok|error}; toast the outcome; refresh the page data. */
export function useRun() {
  const notify = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<{ ok: true; data?: T } | { ok: false; error: string }>, okText?: string | ((d: T | undefined) => string), href?: (d: T | undefined) => string | undefined) => {
    setBusy(key);
    try {
      const r = await fn();
      if (!r.ok) { notify(r.error, { err: true }); return null; }
      if (okText) notify(typeof okText === "function" ? okText(r.data) : okText, { href: href?.(r.data) });
      router.refresh();
      return r;
    } catch (e) {
      notify((e as Error).message || "Something went wrong.", { err: true });
      return null;
    } finally { setBusy(null); }
  }, [notify, router]);
  return { run, busy };
}

/** "YYYY-MM-DD" today (+days) on the firm's clock. */
export const dayKey = (days = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + days * 86400000));
export const nowTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
export const shortDay = (day: string | null) => (day ? new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : "No date");
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
export const localDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
export const localTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
export const whenLabel = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const money = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
