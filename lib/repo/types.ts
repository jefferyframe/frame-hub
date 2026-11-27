export interface Company { id: string; name: string; kind: string; phone: string | null; address: string | null; website: string | null; notes: string | null; qb_customer_id: string | null }
export interface Contact {
  id: string; company_id: string | null; first_name: string | null; last_name: string | null; full_name: string; title: string | null;
  email: string | null; phone: string | null; address: string | null; best_contact_method: string | null;
  is_past_client: boolean; past_client_since: string | null; linkedin_connected: string | null; card_sent: string | null; met_on: string | null; notes: string | null;
  company_name?: string | null;
}
export interface Opportunity {
  id: string; job_number: string | null; name: string; status: string; company_id: string | null; contact_id: string | null; contact_text: string | null;
  best_contact_method: string | null; project_type: string | null; project_detail: string | null; date_received: string | null; construction_start: string | null;
  date_presented: string | null; follow_up_1_date: string | null; follow_up_1_by: string | null; follow_up_1_result: string | null;
  follow_up_2_date: string | null; follow_up_2_by: string | null; follow_up_2_result: string | null;
  subs_cost: number | null; design_fee: number | null; total_bid_override: number | null; projected_arch_hours: number | null;
  proposal_id: string | null; closed_at: Date | null; created_at: Date; updated_at: Date;
  company_name?: string | null; contact_name?: string | null; project_id?: string | null; project_job_number?: string | null;
}
export interface Proposal {
  id: string; number: string; version: number; parent_id: string | null; is_current: boolean; status: string; title: string;
  company_id: string | null; contact_id: string | null; client: { name?: string; contact_name?: string; contact_title?: string; email?: string; phone?: string };
  project_name: string | null; address: string | null; project_type: string | null; building_type: string | null; delivery_type: string | null; construction_cost: number | null;
  fee_basis: "fixed" | "pct_construction" | "hourly_nte"; arch_fee: number | null; arch_target_pct: number | null;
  scope_text_raw: string | null; scope_text: string | null; phase_narrative: Record<string, string>; exclusions: string | null; terms: string | null;
  valid_until: string | null; public_token: string; approved_at: Date | null; approved_by: string | null; legacy_quote_id: string | null; precedents_used: unknown; sent_at: Date | null; viewed_at: Date | null; accepted_at: Date | null; declined_at: Date | null;
  accepted_by_name: string | null; opportunity_id: string | null; created_at: Date; updated_at: Date;
}
export interface ProposalItem {
  id: string; proposal_id: string; kind: "phase" | "consultant" | "additional_service" | "reimbursable" | "exclusion"; label: string; description: string | null;
  pct: number | null; amount: number | null; hours: number | null; included: boolean; optional: boolean; sort: number;
}
export interface Project {
  id: string; job_number: string; name: string; status: string; current_phase: string | null; lead: string | null; team: string | null;
  contract_date: string | null; company_id: string | null; client_text: string | null; client_contact: string | null; client_contact_2: string | null;
  contractor: string | null; contractor_contact: string | null; arch_fee: number | null; profit_pct: number; burden_rate: number;
  billing_notes: string | null; notes: string | null; opportunity_id: string | null; proposal_id: string | null;
  closeout_at: Date | null; archived_at: Date | null; created_at: Date; updated_at: Date;
}
export interface ProjectPhase { id: string; project_id: string; phase: string; sort: number; fee_pct: number | null; arch_fee: number | null; hours_pct: number | null; hours_assigned: number | null; target_date: string | null; status: string }
export interface ProjectConsultant { id: string; project_id: string; discipline: string; firm: string | null; phase: string; fee: number | null; status: string | null }
export interface TimeEntry { id: string; project_id: string; phase: string; week_label: string | null; week_ending: string | null; person: string | null; hours: number; notes: string | null }
export interface Task { id: string; title: string; due_on: string | null; done_at: Date | null; assignee: string | null; cadence: string | null; contact_id: string | null; opportunity_id: string | null; project_id: string | null; notes: string | null }
