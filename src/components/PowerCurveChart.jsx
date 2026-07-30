import * as T from '@/lib';

/* The power curve as a curve (Jon, 2026-07-30). It was a list of rows, which
 * carries every fact and shows none of the shape — and shape is the whole
 * point of a power curve: where you fall away, where you hold on.
 *
 * THE X AXIS IS LOGARITHMIC, and that is not cosmetic. Durations run 5 s to
 * 3600 s, nearly three orders of magnitude, so a linear axis crushes
 * everything under twenty minutes into the left edge — which is exactly where
 * the interesting shape lives. `charts.jsx`'s TrendChart spaces points by
 * even INDEX, which would be a decent approximation while all ten durations
 * are present (they are roughly log-spaced) and a lie the moment they are
 * not: powerCurve() keeps only the durations an athlete actually has, so a
 * rider with a 5 s, a 1 min and a 60 min best would see them evenly spaced
 * and read a straight decline that is not there.
 *
 * WHAT IT REFUSES TO DRAW. A previous curve is only drawn where the
 * comparison says the points are comparable: a different power meter reads
 * several per cent apart, which looks exactly like fitness, and two lines on
 * one chart is the strongest possible claim that they can be read against
 * each other. Incomparable points break the line rather than bridging it,
 * the same null-aware convention TrendChart uses for sparse series.
 *
 * Stale points render hollow, matching the spider's convention for a figure
 * that is real but no longer describes now.
 */
export function PowerCurveChart({ curve, previous, comparison, stale, ftpWatts, height = 150 }) {
  const pts = (curve && curve.points) || [];
  if (pts.length < 2) return null;                 // one point is not a curve

  const W = 320, H = height, padL = 4, padR = 4, padT = 10, padB = 22;
  const staleSet = new Set(stale || []);
  const byDur = new Map(pts.map(p => [p.durationSec, p]));

  // Log-x across the FULL duration range the model defines, not just the range
  // this athlete has, so two athletes' charts are comparable and a missing
  // long duration reads as missing rather than as the end of the axis.
  const D = T.CURVE_DURATIONS;
  const lo = Math.log10(D[0]), hi = Math.log10(D[D.length - 1]);
  const X = sec => padL + ((Math.log10(sec) - lo) / (hi - lo)) * (W - padL - padR);

  // Zero-based y: the drop from a sprint to an hour is the story, and a
  // cropped axis exaggerates it into a cliff.
  const wattVals = pts.map(p => p.watts).concat(ftpWatts ? [ftpWatts] : []);
  const top = Math.max(...wattVals) * 1.08;
  const Y = w => H - padB - (w / top) * (H - padT - padB);

  const path = ps => ps.map((p, i) => (i ? 'L' : 'M') + X(p.durationSec).toFixed(1) + ' ' + Y(p.watts).toFixed(1)).join(' ');

  /* The previous curve, drawn only through comparable points. Segments break
     where a point is incomparable or absent, so the line never implies a
     comparison the model refused to make. */
  const prevSegs = (() => {
    if (!previous || !previous.points || !comparison) return [];
    const status = new Map(comparison.rows.map(r => [r.durationSec, r.status]));
    const segs = [];
    let cur = [];
    D.forEach(d => {
      const q = previous.points.find(p => p.durationSec === d);
      const ok = q && byDur.has(d) && status.get(d) !== 'incomparable' && status.get(d) !== 'new';
      if (ok) cur.push(q);
      else { if (cur.length > 1) segs.push(cur); cur = []; }
    });
    if (cur.length > 1) segs.push(cur);
    return segs;
  })();

  const tick = sec => T.CURVE_LABELS[sec] || sec + 's';
  // Label a readable subset: every duration would collide at this width.
  const TICKS = [5, 60, 300, 1200, 3600].filter(d => d >= D[0] && d <= D[D.length - 1]);

  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', height, display: 'block' }}
      role="img" aria-label={'Power curve: ' + pts.map(p => tick(p.durationSec) + ' ' + p.watts + ' watts').join(', ')}>
      {/* threshold reference: where the curve crosses it is the reading */}
      {ftpWatts && (
        <>
          <line x1={padL} y1={Y(ftpWatts)} x2={W - padR} y2={Y(ftpWatts)}
            stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
          {/* Labelled at the LEFT, not the right. Rendered in a browser, a
              right-anchored label sat directly over the 20, 40 and 60 minute
              markers — the threshold-crossing region, which is the whole
              reason the reference line is drawn. At the left edge the curve is
              at its maximum, so the band beside the threshold is empty. */}
          <text x={padL} y={Y(ftpWatts) - 4} fontSize="8" fill="var(--muted)" textAnchor="start">
            threshold {ftpWatts} W
          </text>
        </>
      )}

      {/* the previous curve, behind, only where it may be compared */}
      {prevSegs.map((seg, i) => (
        <path key={'p' + i} d={path(seg)} fill="none" stroke="var(--muted)"
          strokeWidth="1.5" opacity="0.5" strokeLinejoin="round" />
      ))}

      {/* the current curve */}
      <path d={path(pts)} fill="none" stroke="var(--bike, var(--run))" strokeWidth="2" strokeLinejoin="round" />

      {pts.map(p => (
        <circle key={p.durationSec} cx={X(p.durationSec)} cy={Y(p.watts)} r="3"
          fill={staleSet.has(p.durationSec) ? 'var(--card)' : 'var(--bike, var(--run))'}
          stroke="var(--bike, var(--run))" strokeWidth="1.5" />
      ))}

      {TICKS.map(d => (
        <text key={d} x={X(d)} y={H - 6} fontSize="8" fill="var(--muted)"
          textAnchor={d === D[0] ? 'start' : d === D[D.length - 1] ? 'end' : 'middle'}>{tick(d)}</text>
      ))}
    </svg>
  );
}
