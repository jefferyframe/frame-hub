import type { Proposal, ProposalItem } from "@/lib/repo/types";
import type { FirmSettings } from "@/lib/repo/settings";
import { proposalDoc, teamLabel, NEXT_STEPS, THANKS, NAC_NOTICE } from "@/lib/proposalDoc";
import { money, date } from "@/lib/format";

/** The client-facing proposal as a web page (preview + client link). Matches the PDF section for section. */
export function ProposalDocument({ p, items, settings, library, footer }: { p: Proposal; items: ProposalItem[]; settings: FirmSettings; library: { kind: string; label: string; description: string | null }[]; footer?: React.ReactNode }) {
  const d = proposalDoc(p, items, settings, library);
  return (
    <article className="pdoc">
      <section className="pdoc-cover">
        <div className="pdoc-firm">{d.firmLines.map((l) => <div key={l}>{l}</div>)}</div>
        <div className="pdoc-mark">F</div>
        <h1>Fee Proposal</h1>
        <div className="label">Proposal made for</div>
        <div className="pdoc-project">{p.project_name || p.title}</div>
        {p.address && <div className="muted">{p.address}</div>}
        {d.preparedFor && <p>Prepared for {d.preparedFor}</p>}
        <div className="pdoc-meta"><span>Proposal {p.number}{p.version > 1 ? ` · v${p.version}` : ""}</span><span>Date {date(p.sent_at ?? p.updated_at, { month: "long", day: "numeric", year: "numeric" })}</span>{p.valid_until && <span>Valid until {date(p.valid_until, { month: "long", day: "numeric", year: "numeric" })}</span>}</div>
      </section>

      {d.paragraphs.length > 0 && <section><h2>Project Understanding</h2>{d.paragraphs.map((x, i) => <p key={i}>{x}</p>)}</section>}

      {d.phases.length > 0 && <section><h2>Scope of Services</h2>{d.phases.map((ph) => <div key={ph.label} className="pdoc-phase"><h3>{ph.label}</h3>{ph.narrative && <p>{ph.narrative}</p>}</div>)}</section>}

      <section>
        <h2>Design Team</h2>
        <ul className="pdoc-team"><li>Architecture: {settings.firmName}</li>{d.engineers.map((e) => <li key={e.label}>{teamLabel(e.label)}{e.description ? ` — ${e.description}` : ""}</li>)}</ul>
        {d.engineers.length === 0 && <p className="muted">Architecture only — no engineering consultants carried on this proposal.</p>}
        <div className="pdoc-why"><b>Why Frame</b><ul>{d.why.map((w) => <li key={w}>{w}</li>)}</ul></div>
      </section>

      <section>
        <h2>Professional Fees</h2>
        <table className="pdoc-table"><tbody>
          {d.feeRows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{money(r.amount)}</td></tr>)}
          {d.additional.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{r.amount !== null ? money(Number(r.amount)) : "Hourly"}</td></tr>)}
          {d.reimb.map((r) => <tr key={r.label}><td>{r.label} <span className="faint">(reimbursable)</span></td><td className="num">{r.amount !== null ? money(Number(r.amount)) : "At cost"}</td></tr>)}
        </tbody><tfoot><tr><td>{p.fee_basis === "hourly_nte" ? "Not-to-exceed total" : "Gross Contract Amount"}</td><td className="num">{money(d.totals.total)}</td></tr></tfoot></table>
        {d.phases.length > 0 && <>
          <h3>Architecture Fee by Phase</h3>
          <table className="pdoc-table"><tbody>{d.phases.map((ph) => <tr key={ph.label}><td>{ph.label}</td><td className="num">{money(ph.amount)}</td></tr>)}</tbody>
            <tfoot><tr><td>Total</td><td className="num">{money(d.totals.phasesTotal)}</td></tr></tfoot></table>
        </>}
        {d.options.length > 0 && <>
          <h3>Optional Services</h3>
          <table className="pdoc-table"><tbody>{d.options.map((o) => <tr key={o.label}><td>{o.label}</td><td className="num">{o.amount !== null ? money(Number(o.amount)) : "Hourly"}</td></tr>)}</tbody></table>
        </>}
      </section>

      {d.exclusions.length > 0 && <section><h2>Exclusions</h2><ul>{d.exclusions.map((x) => <li key={x}>{x}</li>)}</ul></section>}
      {p.terms && <section><h2>Terms</h2>{p.terms.split(/\n+/).map((x, i) => <p key={i}>{x}</p>)}</section>}
      <section><h2>Next Steps</h2><h3>Accepting the fee proposal</h3><p>{NEXT_STEPS}</p><p>{THANKS}</p>{footer}</section>
      <p className="pdoc-notice">{NAC_NOTICE}</p>
    </article>
  );
}
