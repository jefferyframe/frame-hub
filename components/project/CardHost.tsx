"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CardData } from "@/lib/projectCard";
import { loadCardAction } from "@/app/projects/cardActions";
import { ProjectCard } from "./ProjectCard";

/** `?card=<project id>` on any page opens that project's card in a drawer (full screen on a phone). */
export function CardHost() {
  const sp = useSearchParams();
  const id = sp.get("card");
  const router = useRouter();
  const path = usePathname();
  const [data, setData] = useState<CardData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const close = useCallback(() => {
    const q = new URLSearchParams(sp.toString()); q.delete("card");
    router.replace(`${path}${q.size ? `?${q}` : ""}`, { scroll: false });
  }, [sp, path, router]);
  useEffect(() => {
    if (!id) { setData(null); setErr(null); return; }
    let live = true;
    setErr(null);
    loadCardAction(id).then((r) => { if (!live) return; if (r.ok && r.data) setData(r.data); else setErr(r.ok ? "Not found" : r.error); }).catch((e) => live && setErr(String(e?.message ?? e)));
    return () => { live = false; };
  }, [id]);
  useEffect(() => {
    if (!id) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [id, close]);
  if (!id) return null;
  return (
    <div className="drawer-wrap" role="dialog" aria-modal="true" aria-label="Project">
      <div className="drawer-scrim" onClick={close} />
      <div className="drawer">
        {data && data.id === id ? <ProjectCard data={data} onClose={close} />
          : err ? <div className="card" style={{ margin: 16 }}><p className="notice bad">{err}</p><button className="btn" onClick={close}>Close</button></div>
          : <div className="drawer-loading"><span className="spin" /> Opening…</div>}
      </div>
    </div>
  );
}

/** A link that opens a project card over the current page (keeps the page's filters). */
export function CardLink({ id, children, className, title }: { id: string; children: React.ReactNode; className?: string; title?: string }) {
  const sp = useSearchParams();
  const path = usePathname();
  const q = new URLSearchParams(sp.toString()); q.set("card", id);
  return <Link href={`${path}?${q}`} scroll={false} className={className} title={title}>{children}</Link>;
}
