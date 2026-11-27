"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { seedScheduleAction } from "@/app/projects/cardActions";

/** Fill in plans (lead + team on the current phase) for active jobs that have none. */
export function SeedButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="row" style={{ gap: 8 }}>
      {msg && <span className="small">{msg}</span>}
      <button className="btn sm" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await seedScheduleAction();
        setBusy(false);
        setMsg(r.ok ? `Planned ${r.data?.seeded ?? 0} job${r.data?.seeded === 1 ? "" : "s"} from the Job List lead/team.` : r.error);
        router.refresh();
      }}>Plan them from the Job List</button>
    </span>
  );
}
