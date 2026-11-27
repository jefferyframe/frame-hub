import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { Db } from "../db/types";
import { getProposal } from "../repo/proposals";
import { getSettings } from "../repo/settings";
import { libraryItems } from "../repo/library";
import { ProposalPdf, EngineerScopePdf } from "./ProposalPdf";

export const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "proposal";

export async function proposalPdf(db: Db, id: string) {
  const data = await getProposal(db, id);
  if (!data) return null;
  const [settings, library] = await Promise.all([getSettings(db), libraryItems(db)]);
  const buf = await renderToBuffer(React.createElement(ProposalPdf, { p: data.proposal, items: data.items, settings, library }) as never);
  return { buf, name: `${slug(data.proposal.project_name || data.proposal.title)}-${data.proposal.number}${data.proposal.version > 1 ? `-v${data.proposal.version}` : ""}.pdf`, proposal: data.proposal };
}

export async function engineerPdf(db: Db, id: string, discipline: string) {
  const data = await getProposal(db, id);
  if (!data) return null;
  const settings = await getSettings(db);
  const buf = await renderToBuffer(React.createElement(EngineerScopePdf, { p: data.proposal, discipline, settings }) as never);
  return { buf, name: `${slug(data.proposal.project_name || data.proposal.title)}-${slug(discipline)}-scope.pdf` };
}

export const pdfResponse = (buf: Buffer, name: string, inline = false) =>
  new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`, "Cache-Control": "private, no-store" } });
