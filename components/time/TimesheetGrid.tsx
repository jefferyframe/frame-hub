"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setCellAction } from "@/app/projects/cardActions";
import { CardLink } from "@/components/project/CardHost";

export interface GridRow { projectId: string; job: string; name: string; phase: string; cells: Record<string, number>; notes: Record<string, string> }
interface Proj { id: string; job: string; name: string; phases: string[]; current: string | null }

const h = (n: number) => (n ? (Math.round(n * 100) / 100).toString() : "");
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const parse = (s: string) => {
  const t = s.trim(); if (!t) return 0;
  const m = t.match(/^(\d{1,2}):([0-5]\d)$/); if (m) return Number(m[1]) + Number(m[2]) / 60;
  const n = Number(t); return Number.isFinite(n) ? n : NaN;
};

/** Week grid (projects × days) for fast entry. Each cell saves on blur. */
export function TimesheetGrid({ memberId, days, today, rows: initial, expected, weekExpected, projects }: {
  memberId: string; days: string[]; today: string; rows: GridRow[]; expected: Record<string, number>; weekExpected: number; projects: Proj[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pid, setPid] = useState(""), [phase, setPhase] = useState("");
  const proj = projects.find((p) => p.id === pid);
  const dayTotal = (d: string) => rows.reduce((s, r) => s + (r.cells[d] ?? 0), 0);
  const total = useMemo(() => rows.reduce((s, r) => s + Object.values(r.cells).reduce((a, b) => a + b, 0), 0), [rows]);

  async function save(r: GridRow, d: string, raw: string, input: HTMLInputElement) {
    const v = parse(raw);
    const before = r.cells[d] ?? 0;
    if (Number.isNaN(v) || v < 0) { setErr("Type hours like 1.5 or 1:30."); input.value = h(before); return; }
    const q = Math.round(v * 4) / 4;
    if (Math.abs(q - v) > 1e-9) { setErr("Use quarter-hour steps (0.25, 0.5, 0.75)."); input.value = h(before); return; }
    if (Math.abs(q - before) < 1e-9) { input.value = h(before); return; }
    const k = `${r.projectId}|${r.phase}|${d}`;
    setSaving(k); setErr(null);
    const res = await setCellAction({ member_id: memberId, project_id: r.projectId, phase: r.phase, work_date: d, hours: String(q) }).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
    setSaving(null);
    if (!res.ok) { setErr(res.error); input.value = h(before); return; }
    setRows((rs) => rs.map((x) => (x === r ? { ...x, cells: { ...x.cells, [d]: q } } : x)));
    input.value = h(q);
    router.refresh();
  }

  return (
    <div className="card tsheet">
      {err && <p className="notice bad" style={{ marginBottom: 10 }}>{err}</p>}
      <div className="tablewrap"><table className="tgrid">
        <thead><tr>
          <th className="tg-job">Job · phase</th>
          {days.map((d, i) => <th key={d} className={`tg-day${d === today ? " today" : ""}${expected[d] ? "" : " off"}`}>{DOW[i]}<span>{Number(d.slice(8))}</span></th>)}
          <th className="num">Total</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const rt = Object.values(r.cells).reduce((a, b) => a + b, 0);
            return (
              <tr key={`${r.projectId}|${r.phase}`}>
                <td className="tg-job"><CardLink id={r.projectId}><span className="mono">{r.job}</span> <span className="tg-name">{r.name}</span></CardLink><div className="small faint">{r.phase}</div></td>
                {days.map((d) => {
                  const k = `${r.projectId}|${r.phase}|${d}`;
                  return (
                    <td key={d} className={`tg-cell${d === today ? " today" : ""}${expected[d] ? "" : " off"}`} data-saving={saving === k}>
                      <input aria-label={`${r.job} ${r.phase} ${d}`} title={r.notes[d] ?? undefined} defaultValue={h(r.cells[d] ?? 0)} inputMode="decimal" placeholder="·"
                        onFocus={(e) => e.currentTarget.select()} onBlur={(e) => save(r, d, e.currentTarget.value, e.currentTarget)}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} />
                    </td>);
                })}
                <td className="num"><b>{h(rt) || "0"}</b></td>
              </tr>);
          })}
          {rows.length === 0 && <tr><td colSpan={9} className="empty">No jobs on this week yet. Add a row below, or get put on a job’s plan.</td></tr>}
        </tbody>
        <tfoot><tr>
          <td>Day total</td>
          {days.map((d) => { const t = dayTotal(d), e = expected[d]; return <td key={d} className={`tg-tot${e && d <= today && t < e - 0.001 ? " short" : ""}${d === today ? " today" : ""}`}>{h(t) || (e ? "0" : "")}{e ? <span className="faint">/{e}</span> : null}</td>; })}
          <td className="num"><b>{h(total) || "0"}</b><span className="faint">/{weekExpected}</span></td>
        </tr></tfoot>
      </table></div>
      <div className="row" style={{ marginTop: 12 }}>
        {adding ? (
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (!proj || !phase) return; if (!rows.some((r) => r.projectId === proj.id && r.phase === phase)) setRows([...rows, { projectId: proj.id, job: proj.job, name: proj.name, phase, cells: {}, notes: {} }]); setAdding(false); setPid(""); setPhase(""); }}>
            <select value={pid} onChange={(e) => { setPid(e.target.value); setPhase(projects.find((p) => p.id === e.target.value)?.current ?? projects.find((p) => p.id === e.target.value)?.phases[0] ?? ""); }} required style={{ width: "auto", maxWidth: 320 }}>
              <option value="">Job…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.job} · {p.name}</option>)}
            </select>
            <select value={phase} onChange={(e) => setPhase(e.target.value)} required style={{ width: "auto" }} disabled={!proj}>{(proj?.phases ?? []).map((x) => <option key={x}>{x}</option>)}</select>
            <button className="btn sm primary">Add row</button><button type="button" className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button>
          </form>
        ) : <button className="btn sm" onClick={() => setAdding(true)}>+ Add a job</button>}
        <span className="spacer" />
        <span className="small muted">Week total <b className={total < weekExpected - 0.001 ? "warnt" : ""}>{h(total) || "0"}</b> of {weekExpected} h expected</span>
      </div>
    </div>
  );
}
