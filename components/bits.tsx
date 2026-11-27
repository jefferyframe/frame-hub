import Link from "next/link";
import type { AuditRow } from "@/lib/repo/audit";
import { dateTime } from "@/lib/format";

const PROPOSAL_TONE: Record<string, string> = { draft: "", in_review: "warn", approved: "accent", sent: "accent", viewed: "accent", accepted: "ok", declined: "bad", superseded: "" };
const PROPOSAL_LABEL: Record<string, string> = { draft: "Draft", in_review: "In review", approved: "Approved", sent: "Sent", viewed: "Viewed", accepted: "Accepted", declined: "Declined", superseded: "Superseded" };
export const ProposalPill = ({ s }: { s: string }) => <span className={`pill ${PROPOSAL_TONE[s] ?? ""}`}>{PROPOSAL_LABEL[s] ?? s}</span>;

export function StatusPill({ s }: { s: string }) {
  const tone = s === "Sold" || s === "Project Completed" ? "ok" : s === "Rejected" ? "bad" : s.startsWith("Follow Up") && !s.endsWith("Completed") ? "warn" : s === "Presented" ? "accent" : "";
  return <span className={`pill ${tone}`}>{s}</span>;
}

const PROJECT_TONE: Record<string, string> = { active: "accent", on_hold: "warn", phase_complete: "", closeout: "ok", archived: "dark" };
const PROJECT_LABEL: Record<string, string> = { active: "Active", on_hold: "On hold", phase_complete: "Phase complete", closeout: "Closeout", archived: "Archived" };
export const ProjectPill = ({ s }: { s: string }) => <span className={`pill ${PROJECT_TONE[s] ?? ""}`}>{PROJECT_LABEL[s] ?? s}</span>;

export function Lineage({ chain, here }: {
  chain: { proposal: { id: string; number: string; version: number; status: string } | null; opportunity: { id: string; name: string; status: string } | null; project: { id: string; job_number: string; status: string } | null };
  here: "proposal" | "opportunity" | "project";
}) {
  return (
    <div className="chain">
      <div className={`link ${here === "proposal" ? "on" : ""}`}>
        <div className="label">Proposal</div>
        {chain.proposal ? <Link href={`/proposals/${chain.proposal.id}`}>{chain.proposal.number} v{chain.proposal.version}</Link> : <span className="faint">—</span>}
      </div>
      <div className={`link ${here === "opportunity" ? "on" : ""}`}>
        <div className="label">Opportunity</div>
        {chain.opportunity ? <Link href={`/sales/${chain.opportunity.id}`}>{chain.opportunity.status}</Link> : <span className="faint">—</span>}
      </div>
      <div className={`link ${here === "project" ? "on" : ""}`}>
        <div className="label">Project</div>
        {chain.project ? <Link href={`/projects/${chain.project.id}`}>Job {chain.project.job_number}</Link> : <span className="faint">—</span>}
      </div>
    </div>
  );
}

const HREF: Record<string, string> = { proposal: "/proposals/", opportunity: "/sales/", project: "/projects/" };
export function History({ rows, self }: { rows: AuditRow[]; self: string }) {
  if (!rows.length) return <p className="muted small">No history yet.</p>;
  return (
    <ul className="timeline">
      {rows.slice(0, 30).map((r) => {
        const other = r.entity_id === self ? (r.related_id ? { e: r.related_entity!, id: r.related_id } : null) : { e: r.entity, id: r.entity_id };
        return (
          <li key={r.id}>
            <div>{r.summary ?? r.action}{other && HREF[other.e] && <> · <Link href={HREF[other.e] + other.id}>open {other.e}</Link></>}</div>
            <div className="faint">{dateTime(r.at)} · {r.actor}</div>
          </li>
        );
      })}
    </ul>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="card kpi"><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="sub">{sub}</div>}</div>;
}
