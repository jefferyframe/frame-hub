"use client";
import { useEffect, useRef, useState } from "react";
import { searchRecordsAction } from "@/app/crm/actions";
import type { RecordKind, RecordRef } from "@/lib/crm/view";

const KIND: Record<RecordKind, string> = { opportunity: "Deal", contact: "Contact", company: "Company" };
type Hit = { kind: RecordKind; id: string; label: string; sub: string | null };

/** Search a deal, contact or company to attach a task or activity to. */
export function RecordPicker({ value, onChange, placeholder = "Search a deal, contact or company" }: { value: RecordRef | null; onChange: (r: RecordRef | null) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => { try { const r = await searchRecordsAction(q); if (n === seq.current) { setHits(r); setOpen(true); } } catch { /* ignore */ } }, 200);
    return () => clearTimeout(t);
  }, [q]);
  if (value) return (
    <div className="picked"><span className="pill accent">{KIND[value.kind]}</span><span className="picked-l">{value.label}</span><button type="button" className="btn sm ghost" onClick={() => onChange(null)} aria-label="Clear">✕</button></div>
  );
  return (
    <div className="picker">
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder={placeholder} aria-label="Who is this about?" />
      {open && hits.length > 0 && (
        <ul className="picker-list" role="listbox">
          {hits.map((h) => (
            <li key={h.kind + h.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ kind: h.kind, id: h.id, label: h.label }); setQ(""); setOpen(false); }}>
              <span className="pill">{KIND[h.kind]}</span> <b>{h.label}</b> {h.sub && <span className="faint small">{h.sub}</span>}
            </button></li>
          ))}
        </ul>
      )}
      {open && q.trim().length >= 2 && hits.length === 0 && <div className="picker-list empty small">No match</div>}
    </div>
  );
}
