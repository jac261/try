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
/* `marks` and `ribbon` are the season's additions, and both default off so the
   five charts already using this render byte-identically.
     marks:  vertical markers at a FRACTIONAL index — {i, label, color, dot,
             value} — because today and race day fall mid-week on a weekly
             series and the line saying "exactly here" must not round to Monday.
     ribbon: spans under the plot, {from, to, color, label} in the same index
             space, so the phase bars line up with the data instead of
             approximating it. It reserves its own height below the plot.
   A series may also carry `dash` (a projection, drawn as one) and `noDot`
   (its endpoint belongs to a mark, not to the line). */
export function TrendChart({ series, height, band, zones, domain, axis, bars, refLines, marks, ribbon }) {
  const uid = useId();
  series = series || [];
  const ribH = ribbon && ribbon.length ? 22 : 0;
  const H = height || 100, W = 320, pad = 8;
  // `domain` extends the y-range beyond the data (union, never crop) — e.g. the
  // Form chart always frames every training zone in true proportion.
  const vals = series.flatMap(s => s.values).filter(v => v != null)
    .concat(bars ? bars.map(b => b.v).concat([0]) : [])
    .concat(refLines ? refLines.map(l => l.v) : [])
    .concat(band ? [band.lo, band.hi] : [])
    .concat(domain ? [domain.min, domain.max] : []);
  const min = Math.min(...vals), max = Math.max(...vals), range = (max - min) || 1;
  const maxN = Math.max(1, ...series.map(s => s.values.length));
  const X = i => (maxN <= 1 ? W / 2 : pad + (i / (maxN - 1)) * (W - 2 * pad));
  // The ribbon takes its band off the BOTTOM of the box; with no ribbon both
  // of these are exactly what they were, so nothing else moves by a pixel.
  const PB = H - ribH - pad;
  const Y = v => PB - ((v - min) / range) * (H - ribH - 2 * pad);
  // Null-aware: a null value breaks the path instead of feeding NaN into
  // the SVG. Sparse series (weekly body-mass means) render their gaps as
  // gaps rather than smoothly bridging silence (design panel 2026-07-21).
  const line = vs => {
    let out = '', pen = false;
    vs.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      out += (pen ? ' L' : ' M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
      pen = true;
    });
    return out.trim();
  };
  /* A fill closes down to the baseline under ONE contiguous run of points.
     The old rule was "no nulls at all", which is the same thing for a full
     series but silently dropped the fill from a series that is a PREFIX of
     the x-axis — the season chart's done half, which ends where the
     measurements do and is null the rest of the way. Two runs with a gap
     between them still draw no area: there is no honest single shape for
     "here, then not, then here again". */
  const area = vs => {
    const first = vs.findIndex(v => v != null);
    if (first < 0) return null;
    let last = first;
    while (last + 1 < vs.length && vs[last + 1] != null) last++;
    if (vs.slice(last + 1).some(v => v != null)) return null; // a gap, not a run
    return line(vs) + ' L' + X(last).toFixed(1) + ' ' + PB + ' L' + X(first).toFixed(1) + ' ' + PB + ' Z';
  };
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
                <text x={pad + 14} y={Y(loFinite) + 2} textAnchor="end" fontSize="5.5" fontWeight="700"
                  fill="#8b95a7" opacity="0.9" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {loFinite !== 0 && <tspan dy="-0.05em">{loFinite > 0 ? '+' : '−'}</tspan>}{loFinite !== 0 && <tspan dy="0.05em">{Math.abs(loFinite)}</tspan>}{loFinite === 0 && '0'}</text>
              </g>
            )}
          </g>
        );
      })}
      {ticks.map(t => (
        <g key={'t' + t}>
          <line x1={pad} x2={W - pad} y1={Y(t)} y2={Y(t)} stroke="#8b95a7" strokeWidth="0.5" opacity="0.14" />
          <text x={pad + 14} y={Y(t) + 2} textAnchor="end" fontSize="5.5" fontWeight="700"
            fill="#8b95a7" opacity="0.85" style={{ fontVariantNumeric: 'tabular-nums' }}>{t}</text>
        </g>
      ))}
      {band && <rect x={pad} y={Y(band.hi)} width={W - 2 * pad} height={Math.max(1, Y(band.lo) - Y(band.hi))} fill="var(--blue-soft)" rx="2" />}
      {/* histogram mode: one bar per reading, growing from the zero baseline —
          for discrete rates (e.g. weekly ramp) where a line implies false
          continuity. Each bar wears its own colour (usually its zone's). */}
      {bars && (() => {
        const slot = (W - 2 * pad - 16) / bars.length;
        const bw = Math.min(26, slot * 0.62);
        return (
          <g>
            <line x1={pad} x2={W - pad} y1={Y(0)} y2={Y(0)} stroke="#8b95a7" strokeWidth="0.6" opacity="0.35" />
            {bars.map((b, i) => {
              const x = pad + 16 + i * slot + (slot - bw) / 2;
              const y0 = Y(0), y1 = Y(b.v);
              return (
                <g key={'b' + i}>
                  <rect x={x} y={Math.min(y0, y1)} width={bw} height={Math.max(1.5, Math.abs(y0 - y1))}
                    fill={b.color} opacity="0.85" rx="1.5" />
                  {b.label && <text x={x + bw / 2} y={H - ribH - 1.5} textAnchor="middle" fontSize="5.5"
                    fill="#8b95a7" opacity="0.8">{b.label}</text>}
                </g>
              );
            })}
          </g>
        );
      })()}
      {/* dashed threshold lines with small figures — a lighter-weight scale than
          full zone bands when the bars already carry the zone colours */}
      {(refLines || []).map((l, i) => (
        <g key={'r' + i}>
          <line x1={pad + 16} x2={W - pad} y1={Y(l.v)} y2={Y(l.v)} stroke={l.color || '#8b95a7'}
            strokeWidth="0.7" strokeDasharray="3 3" opacity="0.5" />
          <text x={pad + 14} y={Y(l.v) + 2} textAnchor="end" fontSize="5.5" fontWeight="700"
            fill={l.color || '#8b95a7'} opacity="0.9" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {l.v !== 0 && <tspan dy="-0.05em">{l.v > 0 ? '+' : '−'}</tspan>}{l.v !== 0 && <tspan dy="0.05em">{Math.abs(l.v)}</tspan>}{l.v === 0 && '0'}</text>
        </g>
      ))}
      {series.map((s, i) => (
        <g key={i}>
          {s.fill && <path d={area(s.values)} fill={s.color} opacity="0.13" />}
          {/* one solid colour for the whole line — the form line is coloured by
              the zone its CURRENT value sits in (Jon, 2026-07-17), passed as
              s.color from the caller, not per segment */}
          {/* dash: a projection is drawn as one. The athlete should be able to
              tell what has happened from what is still a plan without reading
              a legend. */}
          <path d={line(s.values)} fill="none" stroke={s.color} strokeWidth={s.width || 2.2}
            strokeDasharray={s.dash || undefined} strokeLinecap="round" strokeLinejoin="round" />
          {(() => {
            // the endpoint dot sits on the last REAL point: trailing nulls in
            // a sparse series otherwise paint it at NaN (gauntlet 2026-07-21)
            if (s.noDot) return null;
            let li = s.values.length - 1;
            while (li >= 0 && s.values[li] == null) li--;
            return li >= 0 ? <circle cx={X(li)} cy={Y(s.values[li])} r="3" fill={s.color} /> : null;
          })()}
        </g>
      ))}
      {/* the occupied zone's name renders ABOVE the data lines, with a card-colour
          halo (paint-order stroke) so a line crossing it can't strike it through */}
      {zoneRects.filter(z => z.label && z.active).map((z, i) => {
        const top = Y(z.hi), h = Math.max(1, Y(z.lo) - Y(z.hi));
        const fs = h >= 12 ? 7 : 5.8;
        const ty = Math.min(Math.max(top + h / 2 + fs * 0.38, fs + 1.5), H - ribH - 3);
        return (
          <text key={'zl' + i} x={W - pad - 4} y={ty} textAnchor="end" fontSize={fs}
            fontWeight="700" letterSpacing="0.6" fill={z.color}>
            {z.label.toUpperCase()}</text>
        );
      })}
      {/* Vertical markers, above the lines so a crossing line cannot hide the
          one thing on the chart that says where you are. */}
      {(marks || []).map((m, i) => {
        const x = X(m.i);
        const c = m.color || '#ffffff';
        return (
          <g key={'m' + i}>
            <line x1={x} x2={x} y1={pad + (m.label ? 6 : 0)} y2={PB} stroke={c}
              strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />
            {m.value != null && <>
              <circle cx={x} cy={Y(m.value)} r={m.big ? 4 : 3} fill={c} />
              {m.big && <circle cx={x} cy={Y(m.value)} r="7" fill="none" stroke={c} strokeWidth="1.4" opacity="0.4" />}
            </>}
            {/* Two collisions to dodge, both seen rather than guessed. Kept
                clear of the axis gutter, because a marker in the season's
                first week lands exactly on the y-axis numbers. And dropped
                below the plot when the line is high there, because otherwise
                the label is printed straight through its own marker. */}
            {m.label && (() => {
              const high = m.value != null && Y(m.value) < pad + 14;
              return <text x={Math.min(Math.max(x, pad + (axis ? 30 : 12)), W - pad - 12)}
                y={high ? PB - 3 : pad + 2}
                textAnchor="middle" fontSize="6" fontWeight="800" letterSpacing="0.7" fill={c}>
                {m.label}</text>;
            })()}
          </g>
        );
      })}
      {/* The phase ribbon, in the band reserved below the plot. Spans are in
          the data's own index space, so a block boundary sits exactly under
          the week it starts. */}
      {ribH > 0 && (
        <g>
          {ribbon.map((r, i) => {
            // A span covers its weeks' full width, so it reaches half a step
            // past the first and last point rather than stopping on their
            // centres. Both ends are clamped BEFORE the width is taken: clamp
            // one and compute the width from the unclamped value and the first
            // span overruns the second by exactly the amount it was clipped.
            const half = maxN > 1 ? (W - 2 * pad) / (maxN - 1) / 2 : 0;
            const x0 = Math.max(pad - 4, X(Math.max(0, r.from)) - half);
            const x1 = Math.min(W - pad + 4, X(Math.min(maxN - 1, r.to)) + half);
            const w = Math.max(2, x1 - x0);
            return (
              <g key={'rb' + i}>
                <rect x={x0} y={H - ribH + 2} width={w} height="7" rx="3.5" fill={r.color} opacity="0.55" />
                {w > 22 && <text x={x0 + w / 2} y={H - 1.5} textAnchor="middle" fontSize="6"
                  fontWeight="700" fill="#98a3b5">{r.label}</text>}
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}

