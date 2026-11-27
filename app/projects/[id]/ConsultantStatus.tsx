"use client";
import { useTransition } from "react";
import { consultantStatusAction } from "../actions";

export function ConsultantStatus({ id, discipline, phase, status, options }: { id: string; discipline: string; phase: string; status: string | null; options: string[] }) {
  const [p, start] = useTransition();
  return (
    <select value={status ?? ""} disabled={p} style={{ padding: "4px 8px", maxWidth: 150 }} onChange={(e) => { const v = e.target.value; start(() => consultantStatusAction(id, discipline, phase, v)); }}>
      <option value="">No status</option>{options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}
