/** Small dependency-free SVG charts. Colours come from the theme variables. */
import { compactMoney } from "@/lib/format";

export function Bars({ data, height = 200, format = compactMoney, overlay }: {
  data: { label: string; value: number; color?: string }[]; height?: number; format?: (n: number) => string;
  overlay?: { values: number[]; label: string };
}) {
  const w = 640, padL = 8, padB = 38, padT = 18;
  const max = Math.max(1, ...data.map((d) => d.value), ...(overlay?.values ?? []));
  const bw = (w - padL * 2) / Math.max(1, data.length);
  const y = (v: number) => padT + (height - padT - padB) * (1 - v / max);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${height}`} width="100%" role="img">
      <g className="grid">{[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1={0} x2={w} y1={y(max * t)} y2={y(max * t)} />)}</g>
      {data.map((d, i) => {
        const x = padL + i * bw + bw * 0.18, bwi = bw * 0.64;
        const o = overlay?.values[i];
        return (
          <g key={d.label}>
            <rect x={x} y={y(d.value)} width={bwi} height={Math.max(0, height - padB - y(d.value))} rx={3} fill={d.color ?? "var(--chart-1)"} opacity={overlay ? 0.35 : 1} />
            {o !== undefined && <rect x={x + bwi * 0.2} y={y(o)} width={bwi * 0.6} height={Math.max(0, height - padB - y(o))} rx={2} fill={d.color ?? "var(--chart-1)"} />}
            <text x={x + bwi / 2} y={y(Math.max(d.value, o ?? 0)) - 5} textAnchor="middle">{format(o ?? d.value)}</text>
            <text x={x + bwi / 2} y={height - padB + 16} textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal funnel; each step shows its count and the conversion from the step before. */
export function Funnel({ steps }: { steps: { label: string; value: number; rate?: number | null }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {steps.map((s, i) => (
        <div key={s.label} style={{ display: "grid", gridTemplateColumns: "130px 1fr 92px", gap: 10, alignItems: "center" }}>
          <span className="small">{s.label}</span>
          <div className="bar-track" style={{ height: 18 }}>
            <div className="bar-fill" style={{ width: `${(s.value / max) * 100}%`, background: `var(--stage-${Math.min(5, i + 1)})` }} />
          </div>
          <span className="num small">{s.value.toLocaleString()} {i > 0 && <span className="faint">{s.rate === null || s.rate === undefined ? "" : `· ${(s.rate * 100).toFixed(0)}%`}</span>}</span>
        </div>
      ))}
    </div>
  );
}

export function Lines({ labels, series, height = 200 }: { labels: string[]; series: { name: string; values: number[]; color: string }[]; height?: number }) {
  const w = 640, padL = 30, padB = 28, padT = 12, padR = 26;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => padL + ((w - padL - padR) * i) / n;
  const y = (v: number) => padT + (height - padT - padB) * (1 - v / max);
  const every = Math.ceil(labels.length / 8);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${height}`} width="100%" role="img">
      <g className="grid">{[0, 0.5, 1].map((t) => <line key={t} x1={padL} x2={w - padR} y1={y(max * t)} y2={y(max * t)} strokeDasharray="3 4" />)}</g>
      {[0, 0.5, 1].map((t) => <text key={t} x={padL - 6} y={y(max * t) + 4} textAnchor="end">{Math.round(max * t)}</text>)}
      {series.map((s) => (
        <g key={s.name}>
          <polyline fill="none" stroke={s.color} strokeWidth={2} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
          {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color} />)}
        </g>
      ))}
      {labels.map((l, i) => (i % every === 0 ? <text key={l + i} x={x(i)} y={height - 8} textAnchor="middle">{l}</text> : null))}
    </svg>
  );
}

export function Meter({ value, max, warnAt }: { value: number; max: number; warnAt?: number }) {
  const p = max > 0 ? Math.min(1.2, value / max) : 0;
  const color = p > 1 ? "var(--danger)" : warnAt !== undefined && p >= warnAt ? "var(--warning)" : "var(--chart-1)";
  return <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, p * 100)}%`, background: color }} /></div>;
}
