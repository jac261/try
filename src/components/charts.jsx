/* ---------------- tiny SVG charts ---------------- */
import { useId } from 'react';

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
// series: [{ values:[], color, fill?, width? }]. Optional shaded `band` {lo, hi}
// and coloured background `zones` [{lo, hi, color}] (e.g. the Form training
// zones) — zones are clamped to the data range so open-ended ones (±Infinity)
// render as far as the data reaches without distorting the scale.
export function TrendChart({ series, height, band, zones, domain, axis }) {
  const uid = useId();
  const H = height || 100, W = 320, pad = 8;
  // `domain` extends the y-range beyond the data (union, never crop) — e.g. the
  // Form chart always frames every training zone in true proportion.
  const vals = series.flatMap(s => s.values).filter(v => v != null)
    .concat(band ? [band.lo, band.hi] : [])
    .concat(domain ? [domain.min, domain.max] : []);
  const min = Math.min(...vals), max = Math.max(...vals), range = (max - min) || 1;
  const maxN = Math.max(...series.map(s => s.values.length));
  const X = i => (maxN <= 1 ? W / 2 : pad + (i / (maxN - 1)) * (W - 2 * pad));
  const Y = v => H - pad - ((v - min) / range) * (H - 2 * pad);
  const line = vs => vs.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  const area = vs => line(vs) + ' L' + X(vs.length - 1).toFixed(1) + ' ' + (H - pad) + ' L' + X(0).toFixed(1) + ' ' + (H - pad) + ' Z';
  const zoneRects = (zones || [])
    .map(z => ({ ...z, lo: Math.max(z.lo, min), hi: Math.min(z.hi, max) }))
    .filter(z => z.hi > z.lo);
  // Optional numeric y-axis for charts without zones (whose boundaries already
  // act as the scale): a few "nice"-stepped gridlines with small figures.
  const ticks = (() => {
    if (!axis) return [];
    const rough = range / 3;
    const pow = Math.pow(10, Math.floor(Math.log10(rough || 1)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= rough) || 10 * pow;
    const out = [];
    for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
    return out;
  })();
  // Zone alpha (+ the active-zone brightening) feeds either a flat fill or a
  // subtle vertical gradient whose intensity grows toward the zone's extreme
  // (`grad: 'up' | 'down'`) — further from balanced, more saturated.
  const zoneAlpha = z => (z.alpha != null ? z.alpha : 0.14) + (z.active ? 0.08 : 0);
  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        {zoneRects.map((z, i) => (z.grad === 'up' || z.grad === 'down') ? (
          <linearGradient key={'g' + i} id={uid + 'z' + i} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={z.color} stopOpacity={zoneAlpha(z) * (z.grad === 'up' ? 1.45 : 0.5)} />
            <stop offset="1" stopColor={z.color} stopOpacity={zoneAlpha(z) * (z.grad === 'up' ? 0.5 : 1.45)} />
          </linearGradient>
        ) : null)}
      </defs>
      {zoneRects.map((z, i) => {
        const top = Y(z.hi), h = Math.max(1, Y(z.lo) - Y(z.hi));
        const graded = z.grad === 'up' || z.grad === 'down';
        // the zone's numeric floor, marked on the left axis (skip clamped ±Infinity
        // edges — only true boundaries between zones get a number)
        const loFinite = (zones.find(o => o.key === z.key) || {}).lo;
        return (
          <g key={'z' + i}>
            {graded
              ? <rect x={pad} y={top} width={W - 2 * pad} height={h} fill={'url(#' + uid + 'z' + i + ')'} />
              : <rect x={pad} y={top} width={W - 2 * pad} height={h} fill={z.color} opacity={zoneAlpha(z)} />}
            {Number.isFinite(loFinite) && loFinite > min && loFinite < max && (
              <g>
                <line x1={pad} x2={W - pad} y1={Y(loFinite)} y2={Y(loFinite)}
                  stroke="#8b95a7" strokeWidth="0.5" opacity="0.18" />
                <text x={pad + 3} y={Y(loFinite) + 2} fontSize="5.5" fontWeight="700"
                  fill="#8b95a7" opacity="0.9" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {(loFinite > 0 ? '+' : loFinite < 0 ? '−' : '') + Math.abs(loFinite)}</text>
              </g>
            )}
            {/* only the zone the data currently occupies carries its name — the
                rest stay as quiet colour context. Rendered even when the band is a
                thin sliver (y clamped inside the chart): it's the label that matters. */}
            {z.label && z.active && (() => {
              const fs = h >= 12 ? 7 : 5.8;
              const ty = Math.min(Math.max(top + h / 2 + fs * 0.38, fs + 1.5), H - 3);
              return (
                <text x={W - pad - 4} y={ty} textAnchor="end" fontSize={fs} fontWeight="700"
                  letterSpacing="0.6" fill={z.color} opacity="0.9">{z.label.toUpperCase()}</text>
              );
            })()}
          </g>
        );
      })}
      {ticks.map(t => (
        <g key={'t' + t}>
          <line x1={pad} x2={W - pad} y1={Y(t)} y2={Y(t)} stroke="#8b95a7" strokeWidth="0.5" opacity="0.14" />
          <text x={pad + 3} y={Y(t) + 2} fontSize="5.5" fontWeight="700" fill="#8b95a7"
            opacity="0.85" style={{ fontVariantNumeric: 'tabular-nums' }}>{t}</text>
        </g>
      ))}
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

