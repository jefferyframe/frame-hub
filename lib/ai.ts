import "server-only";
/**
 * "Polish with Claude" — port of the first tool's /api/draft-scope. Turns a rough scope outline
 * into proposal language (Frame's voice) grounded in excerpts from Frame's past proposals
 * (fee_precedents.notable_scope_language), and classifies building / delivery type.
 * Off unless ANTHROPIC_API_KEY is set on the server; the key is never sent to the browser.
 */
import type { Db } from "./db/types";
import { BUILDING_TYPES, DELIVERY_TYPES } from "./calc/proposal";

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

export interface ScopeDraft {
  building_type: string;
  delivery_type: string;
  polished_scope: string;
  phase_narrative: { sd: string; dd: string; cd: string; ca: string };
}

const DRAFT_TOOL = {
  name: "submit_draft",
  description: "Submit the polished proposal scope and phase narratives.",
  input_schema: {
    type: "object",
    properties: {
      building_type: { type: "string", description: `One of: ${BUILDING_TYPES.join(", ")}` },
      delivery_type: { type: "string", description: `One of: ${DELIVERY_TYPES.join(", ")}` },
      polished_scope: { type: "string", description: "2-4 polished paragraphs describing the project and Frame's understanding of it, in Frame's confident, partner-oriented voice. No placeholders." },
      phase_narrative: {
        type: "object",
        properties: {
          sd: { type: "string", description: "Schematic Design: 4-6 sentences, project-specific, not generic AIA boilerplate." },
          dd: { type: "string", description: "Design Development: 4-6 sentences, project-specific." },
          cd: { type: "string", description: "Construction Documents: 4-6 sentences, project-specific." },
          ca: { type: "string", description: "Construction Administration: 4-6 sentences, project-specific." },
        },
        required: ["sd", "dd", "cd", "ca"],
      },
    },
    required: ["building_type", "delivery_type", "polished_scope", "phase_narrative"],
  },
};

/** Same precedent selection as the original: up to 150 Frame proposals with scope language,
 *  prefer ones sharing a discipline (if at least 8), first 25. */
export async function precedentExcerpts(db: Db, disciplines: string[]): Promise<string[]> {
  const pool = await db.query<{ building_type: string | null; delivery_type: string | null; disciplines: string[] | null; notable_scope_language: string; notes: string | null }>(
    `select building_type, delivery_type, disciplines, notable_scope_language, notes from fee_precedents
     where is_frame_proposal and notable_scope_language is not null order by created_at desc limit 150`);
  const want = disciplines.map((d) => d.toLowerCase());
  const matched = pool.filter((p) => (p.disciplines ?? []).some((d) => want.some((w) => d.toLowerCase().includes(w))));
  const use = (matched.length >= 8 ? matched : pool).slice(0, 25);
  return use.map((p) => `- (${p.building_type ?? "?"} / ${p.delivery_type ?? "?"}, disciplines: ${(p.disciplines ?? []).join(", ")}) "${p.notable_scope_language}"${p.notes ? ` Detail: ${p.notes.slice(0, 400)}` : ""}`);
}

export async function draftScope(db: Db, input: { scope_text_raw: string; project_name: string; client_name: string; disciplines: string[] }): Promise<ScopeDraft> {
  if (!input.scope_text_raw.trim()) throw new Error("Add a scope outline first.");
  const excerpts = await precedentExcerpts(db, input.disciplines);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens: 3500,
      system:
        "You write fee-proposal language for Frame Architecture, Inc., an architecture firm in Reno, Nevada. " +
        "Write in Frame's confident, plain-spoken, partner-oriented voice: specific to this project, no filler, no placeholders, no generic AIA boilerplate. " +
        "Ground tone and phrasing in the excerpts from Frame's past proposals, but never copy project facts that don't apply.",
      tools: [DRAFT_TOOL],
      tool_choice: { type: "tool", name: "submit_draft" },
      messages: [{
        role: "user",
        content: `Project: ${input.project_name}\nClient: ${input.client_name}\nDisciplines: ${input.disciplines.join(", ") || "Architecture only"}\n\nRaw scope outline:\n${input.scope_text_raw}\n\nExcerpts from Frame's past proposals:\n${excerpts.join("\n")}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude request failed (${res.status}).`);
  const data = (await res.json()) as { content?: { type: string; name?: string; input?: ScopeDraft }[] };
  const tool = data.content?.find((c) => c.type === "tool_use" && c.name === "submit_draft");
  if (!tool?.input) throw new Error("Claude did not return a structured draft.");
  return tool.input;
}
