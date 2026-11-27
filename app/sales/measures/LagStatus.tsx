"use client";
import { useTransition } from "react";
import { LAG_STATUSES } from "@/lib/calc/measures";
import { setLagStatusAction } from "../actions";

export function LagStatus({ id, status }: { id: string; status: string }) {
  const [p, start] = useTransition();
  return <select value={status} disabled={p} style={{ padding: "4px 8px", maxWidth: 150 }} onChange={(e) => { const v = e.target.value; start(() => setLagStatusAction(id, v)); }}>{LAG_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>;
}
