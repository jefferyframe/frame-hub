"use client";
import { useRouter, useSearchParams } from "next/navigation";
import type { MemberView } from "@/lib/crm/view";

/** Whose follow-ups to show: mine, everyone, unassigned, or one person (kept in the URL). */
export function WhoSelect({ team, who, meId }: { team: MemberView[]; who: string; meId: string | null }) {
  const router = useRouter();
  const sp = useSearchParams();
  return (
    <label className="f inline"><span>Showing</span>
      <select value={who} onChange={(e) => { const u = new URLSearchParams(sp.toString()); u.set("who", e.target.value); router.push(`/crm?${u}`); }}>
        {meId && <option value="me">My follow-ups</option>}
        <option value="all">Whole team</option>
        <option value="unassigned">Unassigned</option>
        {team.filter((m) => m.id !== meId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </label>
  );
}
