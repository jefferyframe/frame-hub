"use client";
import { useState } from "react";
import { saveMemberAction } from "@/app/crm/actions";
import { useRun, ToastProvider } from "./ui";

export interface TeamRow { id: string; name: string; email: string | null; role: string; active: boolean; has_feed: boolean; open_tasks: number }

function Row({ m }: { m: TeamRow }) {
  const { run, busy } = useRun();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: m.name, email: m.email ?? "", role: m.role, active: m.active });
  if (!edit) return (
    <tr data-off={!m.active}>
      <td><b>{m.name}</b>{!m.active && <span className="pill"> inactive</span>}</td>
      <td className="small">{m.email ?? <span className="faint">—</span>}</td>
      <td className="small hide-sm">{m.role}</td>
      <td className="small hide-sm">{m.has_feed ? <span className="pill ok">linked</span> : <span className="faint">—</span>}</td>
      <td className="num small">{m.open_tasks || ""}</td>
      <td><button className="btn sm ghost" onClick={() => setEdit(true)}>Edit</button></td>
    </tr>
  );
  return (
    <tr><td colSpan={6}>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await run("save", () => saveMemberAction({ id: m.id, name: f.name, email: f.email || null, role: f.role, active: f.active }), "Saved.")) setEdit(false); }}>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name" style={{ width: 160 }} required />
        <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" style={{ width: 230 }} />
        <input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Role" style={{ width: 130 }} />
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> active</label>
        <button className="btn sm primary" disabled={busy === "save"}>Save</button><button type="button" className="btn sm ghost" onClick={() => setEdit(false)}>Cancel</button>
      </form>
    </td></tr>
  );
}

function AddMember() {
  const { run, busy } = useRun();
  const [f, setF] = useState({ name: "", email: "", role: "Staff" });
  return (
    <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await run("add", () => saveMemberAction({ name: f.name, email: f.email || null, role: f.role }), `${f.name} added.`)) setF({ name: "", email: "", role: "Staff" }); }}>
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name (first name signs in)" style={{ flex: 1, minWidth: 160 }} required />
      <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" style={{ flex: 1, minWidth: 180 }} />
      <input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Role" style={{ width: 120 }} />
      <button className="btn" disabled={busy === "add" || !f.name.trim()}>Add person</button>
    </form>
  );
}

export function TeamSettings({ rows }: { rows: TeamRow[] }) {
  return (
    <ToastProvider>
      <div className="tablewrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th className="hide-sm">Role</th><th className="hide-sm">Calendar</th><th className="num">Open tasks</th><th /></tr></thead>
        <tbody>{rows.map((m) => <Row key={m.id} m={m} />)}</tbody>
      </table></div>
      <div style={{ marginTop: 12 }}><AddMember /></div>
    </ToastProvider>
  );
}
