import { PROJECT_TYPES } from "@/lib/calc/sales";
import type { Opportunity } from "@/lib/repo/types";

/** The Pipeline Tracking sheet's columns as a form. */
export function OppFields({ o, ro }: { o?: Partial<Opportunity>; ro?: boolean }) {
  const t = (name: keyof Opportunity, label: string, type = "text", wide = false) => (
    <label className={`f ${wide ? "wide" : ""}`}><span>{label}</span><input name={name} type={type} defaultValue={(o?.[name] as string | number | null) ?? ""} disabled={ro} inputMode={type === "number" ? "decimal" : undefined} step={type === "number" ? "any" : undefined} /></label>
  );
  return (
    <div className="fields">
      {t("name", "Client name / project name", "text", true)}
      {t("job_number", "Job #")}
      {t("date_received", "Date lead received", "date")}
      {t("contact_text", "Contact person")}
      {t("best_contact_method", "Best contact method")}
      <label className="f"><span>Project type</span><select name="project_type" defaultValue={o?.project_type ?? ""} disabled={ro}><option value="">—</option>{PROJECT_TYPES.map((x) => <option key={x}>{x}</option>)}</select></label>
      {t("construction_start", "Customer construction start", "date")}
      <label className="f wide"><span>Project detail</span><textarea name="project_detail" defaultValue={o?.project_detail ?? ""} disabled={ro} style={{ minHeight: 70 }} /></label>
      {t("date_presented", "Date presented", "date")}
      <span />
      {t("follow_up_1_date", "First follow-up date", "date")}
      {t("follow_up_1_by", "By whom")}
      {t("follow_up_1_result", "Result", "text", true)}
      {t("follow_up_2_date", "Second follow-up date", "date")}
      {t("follow_up_2_by", "By whom")}
      {t("follow_up_2_result", "Result", "text", true)}
      {t("subs_cost", "Subs cost", "number")}
      {t("design_fee", "Design fee", "number")}
      {t("total_bid_override", "Total bid (only if not subs + design fee)", "number")}
      {t("projected_arch_hours", "Total projected arch hours", "number")}
    </div>
  );
}
