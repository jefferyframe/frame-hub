/* eslint-disable jsx-a11y/alt-text */
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Proposal, ProposalItem } from "../repo/types";
import type { FirmSettings } from "../repo/settings";
import { proposalDoc, teamLabel, NEXT_STEPS, THANKS, NAC_NOTICE } from "../proposalDoc";
import { DISCIPLINES } from "../calc/proposal";
import { money, date } from "../format";

/** PDF colours: PDF_ACCENT / PDF_INK env vars let the chosen design direction carry into the PDF. */
const ACCENT = process.env.PDF_ACCENT || "#2E5E73";
const INK = process.env.PDF_INK || "#1D1F22";
const SOFT = "#62666D", BORDER = "#E3E3DF", SHADE = "#F6F6F4";

const s = StyleSheet.create({
  page: { padding: 48, fontFamily: "Helvetica", fontSize: 10, color: INK, lineHeight: 1.5 },
  firm: { textAlign: "right", fontSize: 9, color: SOFT },
  firmName: { fontFamily: "Helvetica-Bold", color: INK },
  mark: { width: 34, height: 34, borderWidth: 2.5, borderColor: INK, alignItems: "center", justifyContent: "center", position: "absolute", top: 48, left: 48 },
  coverTitle: { fontSize: 34, color: ACCENT, fontFamily: "Helvetica-Bold", lineHeight: 1.1 },
  coverRule: { height: 3, backgroundColor: ACCENT, marginTop: 6, marginBottom: 18 },
  label: { fontSize: 8, color: SOFT, textTransform: "uppercase", letterSpacing: 1 },
  project: { fontSize: 18, fontFamily: "Helvetica-Bold", marginVertical: 4 },
  h1: { fontSize: 16, color: ACCENT, fontFamily: "Helvetica-Bold", borderBottomWidth: 1, borderBottomColor: ACCENT, paddingBottom: 4, marginBottom: 10, marginTop: 14 },
  h2: { fontSize: 11.5, color: ACCENT, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 3 },
  body: { marginBottom: 7 },
  why: { backgroundColor: INK, color: "#FFFFFF", borderRadius: 6, padding: 14, marginTop: 12 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: BORDER, paddingVertical: 5 },
  trTotal: { flexDirection: "row", paddingVertical: 6, backgroundColor: SHADE, fontFamily: "Helvetica-Bold" },
  tdL: { flex: 3, paddingHorizontal: 4 },
  tdV: { flex: 1, textAlign: "right", paddingHorizontal: 4 },
  meta: { flexDirection: "row", gap: 16, marginTop: 14, fontFamily: "Helvetica-Bold", fontSize: 9 },
  notice: { fontSize: 7.5, color: SOFT, marginTop: 26 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 8, color: SOFT, flexDirection: "row", justifyContent: "space-between" },
  sign: { flexDirection: "row", gap: 24, marginTop: 28 },
  signLine: { flex: 1, borderTopWidth: 0.75, borderTopColor: INK, paddingTop: 4, fontSize: 8, color: SOFT },
});

const Row = ({ l, v, total }: { l: string; v: string; total?: boolean }) => (
  <View style={total ? s.trTotal : s.tr} wrap={false}><Text style={s.tdL}>{l}</Text><Text style={s.tdV}>{v}</Text></View>
);
const Footer = ({ p }: { p: Proposal }) => (
  <View style={s.footer} fixed><Text>{p.project_name || p.title} · Proposal {p.number}{p.version > 1 ? ` v${p.version}` : ""}</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>
);

export function ProposalPdf({ p, items, settings, library }: { p: Proposal; items: ProposalItem[]; settings: FirmSettings; library: { kind: string; label: string; description: string | null }[] }) {
  const d = proposalDoc(p, items, settings, library);
  const when = date(p.sent_at ?? p.updated_at, { month: "long", day: "numeric", year: "numeric" });
  return (
    <Document title={`${p.project_name || p.title} — Fee Proposal`} author={settings.firmName}>
      <Page size="LETTER" style={s.page}>
        <View style={s.mark}><Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold" }}>F</Text></View>
        <View style={s.firm}>{d.firmLines.map((l, i) => <Text key={l} style={i === 0 ? s.firmName : undefined}>{l}</Text>)}</View>
        <View style={{ marginTop: 150 }}>
          <Text style={s.coverTitle}>FEE PROPOSAL</Text>
          <View style={s.coverRule} />
          <Text style={s.label}>Proposal Made For</Text>
          <Text style={s.project}>{p.project_name || p.title}</Text>
          {p.address ? <Text style={s.body}>{p.address}</Text> : null}
          {d.preparedFor ? <Text style={s.body}>Prepared for {d.preparedFor}</Text> : null}
          <View style={s.meta}><Text>Proposal {p.number}{p.version > 1 ? ` · v${p.version}` : ""}</Text><Text>Date: {when}</Text>{p.valid_until ? <Text>Valid until {date(p.valid_until, { month: "long", day: "numeric", year: "numeric" })}</Text> : null}</View>
        </View>
      </Page>
      <Page size="LETTER" style={s.page}>
        {d.paragraphs.length > 0 && <><Text style={s.h1}>Project Understanding</Text>{d.paragraphs.map((x, i) => <Text key={i} style={s.body}>{x}</Text>)}</>}
        {d.phases.length > 0 && <Text style={s.h1}>Scope of Services</Text>}
        {d.phases.map((ph) => <View key={ph.label} wrap={false}><Text style={s.h2}>{ph.label}</Text>{ph.narrative ? <Text style={s.body}>{ph.narrative}</Text> : null}</View>)}
        <Text style={s.h1}>Design Team</Text>
        <Text style={s.body}>Architecture: {settings.firmName}</Text>
        {d.engineers.length ? d.engineers.map((e) => <Text key={e.label} style={s.body}>{teamLabel(e.label)}{e.description ? ` — ${e.description}` : ""}</Text>)
          : <Text style={s.body}>Architecture only — no engineering consultants carried on this proposal.</Text>}
        <View style={s.why} wrap={false}><Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 4 }}>Why Frame</Text>{d.why.map((w) => <Text key={w}>•  {w}</Text>)}</View>
        <Footer p={p} />
      </Page>
      <Page size="LETTER" style={s.page}>
        <Text style={s.h1}>Professional Fees</Text>
        {d.feeRows.map((r) => <Row key={r.label} l={r.label} v={money(r.amount)} />)}
        {d.additional.map((r) => <Row key={r.label} l={r.label} v={r.amount !== null ? money(Number(r.amount)) : "Hourly"} />)}
        {d.reimb.map((r) => <Row key={r.label} l={`${r.label} (reimbursable)`} v={r.amount !== null ? money(Number(r.amount)) : "At cost"} />)}
        <Row total l={p.fee_basis === "hourly_nte" ? "Not-to-exceed total" : "Gross Contract Amount"} v={money(d.totals.total)} />
        {d.phases.length > 0 && <><Text style={s.h2}>Architecture Fee by Phase</Text>{d.phases.map((ph) => <Row key={ph.label} l={ph.label} v={money(ph.amount)} />)}<Row total l="Total" v={money(d.totals.phasesTotal)} /></>}
        {d.options.length > 0 && <><Text style={s.h2}>Optional Services</Text>{d.options.map((o) => <Row key={o.label} l={o.label} v={o.amount !== null ? money(Number(o.amount)) : "Hourly"} />)}</>}
        {d.exclusions.length > 0 && <><Text style={s.h2}>Exclusions</Text>{d.exclusions.map((x) => <Text key={x}>•  {x}</Text>)}</>}
        {p.terms ? <><Text style={s.h2}>Terms</Text><Text style={s.body}>{p.terms}</Text></> : null}
        <Text style={s.h1}>Next Steps</Text>
        <Text style={s.h2}>Accepting the fee proposal:</Text>
        <Text style={s.body}>{NEXT_STEPS}</Text>
        <Text style={s.body}>{THANKS}</Text>
        <View style={s.sign} wrap={false}><Text style={s.signLine}>Accepted by (name, title)</Text><Text style={s.signLine}>Signature</Text><Text style={s.signLine}>Date</Text></View>
        <Text style={s.notice}>{NAC_NOTICE}</Text>
        <Footer p={p} />
      </Page>
    </Document>
  );
}

/** Per-engineer scope sheet (old /api/engineer-scope-pdf): what Frame needs from that consultant. */
export function EngineerScopePdf({ p, discipline, settings }: { p: Proposal; discipline: string; settings: FirmSettings }) {
  const d = DISCIPLINES.find((x) => x.key === discipline || x.label === discipline);
  return (
    <Document title={`${p.project_name || p.title} — ${d?.label ?? discipline} scope`}>
      <Page size="LETTER" style={s.page}>
        <View style={s.firm}><Text style={s.firmName}>{settings.firmName}</Text>{settings.firmAddress.split("\n").map((l) => <Text key={l}>{l}</Text>)}<Text>{settings.firmPhone}</Text></View>
        <Text style={[s.coverTitle, { marginTop: 40, fontSize: 22 }]}>{teamLabel(d?.label ?? discipline).toUpperCase()} — REQUEST FOR FEE</Text>
        <View style={s.coverRule} />
        <Text style={s.label}>Project</Text>
        <Text style={s.project}>{p.project_name || p.title}</Text>
        {p.address ? <Text style={s.body}>{p.address}</Text> : null}
        {p.construction_cost ? <Text style={s.body}>Estimated construction cost: {money(p.construction_cost)}</Text> : null}
        <Text style={s.h1}>Project Understanding</Text>
        {(p.scope_text || p.scope_text_raw || "").split(/\n{2,}/).filter(Boolean).map((x, i) => <Text key={i} style={s.body}>{x}</Text>)}
        <Text style={s.h1}>Scope Requested</Text>
        <Text style={s.body}>{d?.note ?? "Engineering design and coordination with the architectural drawings through all phases."}</Text>
        {Object.entries(p.phase_narrative ?? {}).filter(([, v]) => v).map(([k, v]) => <View key={k} wrap={false}><Text style={s.h2}>{k}</Text><Text style={s.body}>{v}</Text></View>)}
        <Text style={s.h1}>Please Return</Text>
        <Text style={s.body}>A lump-sum fee broken out by phase (Schematic Design, Design Development, Construction Documents, Bidding & Permitting, Construction Administration), your hourly rates for additional services, and any exclusions.</Text>
        <Text style={s.notice}>Prepared {date(new Date(), { month: "long", day: "numeric", year: "numeric" })} · Proposal {p.number}</Text>
      </Page>
    </Document>
  );
}
