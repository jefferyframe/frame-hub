import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/repo/settings";
import { STAGES, overallLikelihoods } from "@/lib/calc/sales";
import { quickbooks } from "@/lib/integrations/quickbooks";
import { authProvider } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { saveSettingsAction } from "./actions";
import { pct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function Settings() {
  const db = await getDb();
  const s = await getSettings(db);
  const ov = overallLikelihoods(s.stageLikelihood);
  const [runs] = await Promise.all([db.query<{ at: Date; source: string }>(`select at, source from import_runs order by at desc limit 1`)]);
  const qb = await quickbooks().connected();
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="pagehead"><div><h1>Settings</h1><p>Firm details used on proposals, and the numbers behind the pipeline and job-cost math.</p></div></div>
      <form action={saveSettingsAction} className="stack">
        <div className="card stack">
          <h2>Firm (proposal letterhead)</h2>
          <div className="fields">
            <label className="f"><span>Firm name</span><input name="firmName" defaultValue={s.firmName} /></label>
            <label className="f"><span>Phone</span><input name="firmPhone" defaultValue={s.firmPhone} /></label>
            <label className="f"><span>Address</span><textarea name="firmAddress" defaultValue={s.firmAddress} style={{ minHeight: 60 }} /></label>
            <label className="f"><span>Email</span><input name="firmEmail" defaultValue={s.firmEmail} /></label>
            <label className="f"><span>Proposals valid for (days)</span><input name="proposalValidDays" defaultValue={s.proposalValidDays} inputMode="numeric" /></label>
            <label className="f wide"><span>“Why Frame” (one per line)</span><textarea name="whyFrame" defaultValue={s.whyFrame.join("\n")} style={{ minHeight: 80 }} /></label>
            <label className="f wide"><span>Default terms</span><textarea name="defaultTerms" defaultValue={s.defaultTerms} /></label>
          </div>
        </div>
        <div className="card stack">
          <h2>Stage likelihood (Pipeline Tracking row 3)</h2>
          <p className="small muted">Overall likelihood for a stage = its likelihood × every later stage’s (row 4). Weighted pipeline = Σ overall × stage total (row 6).</p>
          <div className="fields">{STAGES.map((st) => (
            <label key={st.key} className="f"><span>{st.label} — overall {pct(ov[st.key])}</span><input name={`stage_${st.key}`} defaultValue={+(s.stageLikelihood[st.key] * 100).toFixed(2)} inputMode="decimal" /></label>
          ))}</div>
        </div>
        <div className="card stack">
          <h2>Job cost defaults (template E30 / E33)</h2>
          <div className="fields">
            <label className="f"><span>Profit percentage (cost share of fee, %)</span><input name="profitPct" defaultValue={+(s.profitPct * 100).toFixed(2)} inputMode="decimal" /></label>
            <label className="f"><span>Burden rate ($/hour)</span><input name="burdenRate" defaultValue={s.burdenRate} inputMode="decimal" /></label>
          </div>
          <p className="small muted">Expected profit = fee × (1 − profit %). Hours allowance = ⌊(fee − expected profit) ÷ burden rate⌋. New projects start with these; each job can override its own.</p>
        </div>
        <div><button className="btn primary">Save settings</button></div>
      </form>
      <div className="card stack">
        <h2>Connections</h2>
        <table className="small"><tbody>
          <tr><td>Sign-in</td><td>{authProvider().id === "dev" ? "Local stand-in user (Microsoft 365 / Google not connected yet)" : authProvider().id === "supabase" ? <>Email sign-in for approved team members (Microsoft 365 / Google later) · <form action="/auth/signout" method="post" style={{ display: "inline" }}><button className="btn small" type="submit">Sign out</button></form></> : authProvider().id}</td></tr>
          <tr><td>QuickBooks</td><td>{qb ? "Connected" : "Not connected — customer and invoice mapping is ready for it"}</td></tr>
          <tr><td>Claude scope drafting</td><td>{aiConfigured() ? "On" : "Off (set ANTHROPIC_API_KEY)"}</td></tr>
          <tr><td>Theme</td><td>styles/theme.css — one line switches between the design directions</td></tr>
          <tr><td>Last data import</td><td>{runs[0] ? new Date(runs[0].at).toLocaleString("en-US") : "never"}</td></tr>
        </tbody></table>
      </div>
    </div>
  );
}
