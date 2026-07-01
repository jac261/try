/* ---------------- tiny SVG charts ---------------- */
// Hand-rolled bar chart in HTML/CSS. (An SVG with preserveAspectRatio="none"
// stretches non-uniformly to fill the width, which distorts text labels.)
export function BarChart({ data, height }) {
  height = height || 150;
  const max = Math.max(1, ...data.map(d => d.planned));
  return (
    <div className="vchart" style={{ height }}>
      {data.map((d, i) => (
        <div className="vcol" key={i}>
          <div className="vplot">
            <div className="vtrack" style={{ height: (d.planned / max * 100) + '%' }} />
            <div className="vdone" style={{ height: (Math.min(d.done, d.planned) / max * 100) + '%', background: d.color || 'var(--accent)' }} />
          </div>
          <div className="vlabel">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

export function Donut({ segments, size }) {
  size = size || 150;
  const total = segments.reduce((a, b) => a + b.value, 0) || 1;
  const r = 60, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg viewBox="0 0 160 160" style={{ width: size, height: size }}>
      <g transform="rotate(-90 80 80)">
        {segments.map((s, i) => {
          const frac = s.value / total, len = frac * c;
          const el = <circle key={i} cx="80" cy="80" r={r} fill="none" stroke={s.color} strokeWidth="26"
            strokeDasharray={len + ' ' + (c - len)} strokeDashoffset={-off} />;
          off += len; return el;
        })}
      </g>
      <text x="80" y="76" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)">{Math.round(total)}</text>
      <text x="80" y="94" textAnchor="middle" fontSize="11" fill="var(--muted)">hrs total</text>
    </svg>
  );
}

// Sparkline: a small trend line where "better" always points up (so for pace
// metrics, where lower is better, the line is inverted).
export function Sparkline({ values, betterDown, color }) {
  const W = 120, H = 40;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const norm = v => (betterDown ? (max - v) : (v - min)) / range;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * (W - 6) + 3;
    const y = H - 5 - norm(v) * (H - 10);
    return [x, y];
  });
  const path = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: W, height: H, flex: 'none' }} preserveAspectRatio="none">
      <polyline points={path} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
    </svg>
  );
}

// Reconstruct each baseline's value over time from fitnessHistory + current value.
// history[i] holds the value that was active *before* history[i].date, so the value
// that became active at dates[i] is values[i] (current for the final point).
// Multi-series line/area chart (uniform-scaled SVG, no text → crisp at any width).
// series: [{ values:[], color, fill?, width? }]. Optional shaded `band` {lo, hi}.
export function TrendChart({ series, height, band }) {
  const H = height || 100, W = 320, pad = 8;
  const vals = series.flatMap(s => s.values).filter(v => v != null).concat(band ? [band.lo, band.hi] : []);
  const min = Math.min(...vals), max = Math.max(...vals), range = (max - min) || 1;
  const maxN = Math.max(...series.map(s => s.values.length));
  const X = i => (maxN <= 1 ? W / 2 : pad + (i / (maxN - 1)) * (W - 2 * pad));
  const Y = v => H - pad - ((v - min) / range) * (H - 2 * pad);
  const line = vs => vs.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  const area = vs => line(vs) + ' L' + X(vs.length - 1).toFixed(1) + ' ' + (H - pad) + ' L' + X(0).toFixed(1) + ' ' + (H - pad) + ' Z';
  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {band && <rect x={pad} y={Y(band.hi)} width={W - 2 * pad} height={Math.max(1, Y(band.lo) - Y(band.hi))} fill="var(--blue-soft)" rx="2" />}
      {series.map((s, i) => (
        <g key={i}>
          {s.fill && <path d={area(s.values)} fill={s.color} opacity="0.13" />}
          <path d={line(s.values)} fill="none" stroke={s.color} strokeWidth={s.width || 2.2} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={X(s.values.length - 1)} cy={Y(s.values[s.values.length - 1])} r="3" fill={s.color} />
        </g>
      ))}
    </svg>
  );
}

