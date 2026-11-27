"use client";
import { useTransition } from "react";
import { PIPELINE_STATUSES } from "@/lib/calc/sales";
import { setOppStatusAction } from "./actions";

export function StatusSelect({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <select value={status} disabled={pending} aria-label="Status" style={{ minWidth: 150, padding: "4px 8px" }}
      onChange={(e) => { const v = e.target.value; start(() => setOppStatusAction(id, v)); }}>
      {PIPELINE_STATUSES.map((s) => <option key={s}>{s}</option>)}
    </select>
  );
}
