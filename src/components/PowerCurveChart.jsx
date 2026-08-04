import { useId } from 'react';
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
export function PowerCurveChart({ curve, previous, comparison, stale, ftpWatts, showDeltas, height = 190 }) {
  // Before the early return (the hook-order lesson). The curve harness
  // mounts a dozen of these on one page, so the area-fill gradient id must
  // be per-instance; useId's delimiters are stripped because url(#…) does
  // not reliably parse them across engines.
  const fillId = 'pcfill-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const pts = (curve && curve.points) || [];
  if (pts.length < 2) return null;                 // one point is not a curve

  // padL carries the watts axis now that the per-duration rows are gone and
  // the chart is the only place those numbers live.
  const W = 320, H = height, padL = 26, padR = 6, padT = 14, padB = 22;
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
  /* The expected-shape reference, drawn so a rider can SEE where they sit
     against their own threshold rather than read it as five percentages. Its
     watts join the axis domain below: a rider under shape at the short end
     would otherwise send the reference line off the top of the chart. */
  const shapePts = T.expectedShapeCurve(ftpWatts);
  const wattVals = pts.map(p => p.watts)
    .concat(shapePts.map(p => p.watts))
    .concat(ftpWatts ? [ftpWatts] : []);
  const top = Math.max(...wattVals) * 1.08;
  const Y = w => H - padB - (w / top) * (H - padT - padB);

  /* The watts axis. Rounded to a readable step rather than to the data, so the
     gridlines land on numbers a rider can actually hold in their head. Five
     intervals, so a ~950 W ceiling gives 0/200/400/600/800 rather than the
     0/250/500/750 a four-interval split would produce. */
  const niceStep = raw => {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  };
  const step = niceStep(top / 5);
  const yTicks = [];
  for (let w = 0; w <= top; w += step) yTicks.push(w);

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
      {/* The watts axis: gridline and value per step, zero included so the
          zero-based claim is visible rather than asserted. The unit sits on
          its own above the top tick: suffixing the tick ("800 W") pushed it
          past the left edge of the viewBox, measured, not guessed. */}
      {yTicks.map(w => (
        <g key={'y' + w}>
          <line x1={padL} y1={Y(w)} x2={W - padR} y2={Y(w)}
            stroke="var(--line)" strokeWidth="1" opacity={w === 0 ? 0.55 : 0.22} />
          <text x={padL - 5} y={Y(w) + 3} fontSize="8" fill="var(--muted)" textAnchor="end">{w}</text>
        </g>
      ))}
      <text x={padL - 5} y={Y(yTicks[yTicks.length - 1]) - 7} fontSize="8"
        fill="var(--muted)" textAnchor="end">W</text>

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

      {/* The expected shape at this threshold. Beneath the rider's own line
          and dashed, because it is a reference and not a result: every gap
          above it is a relative strength and every gap below a relative
          limiter, which is the whole read the profile puts into words. */}
      {shapePts.length > 1 && (
        /* var(--muted), not var(--line): the gridline colour is right for a
           gridline and disappears against the card for a line carrying
           meaning (measured on device, rgb(42,49,64) on this background).
           Dashed and full strength distinguishes it from the previous curve,
           which is solid and half strength. */
        <path d={path(shapePts)} fill="none" stroke="var(--muted)" strokeWidth="1.5"
          strokeDasharray="4 3" strokeLinejoin="round" opacity="0.85" />
      )}

      {/* the previous curve, behind, only where it may be compared */}
      {prevSegs.map((seg, i) => (
        <path key={'p' + i} d={path(seg)} fill="none" stroke="var(--muted)"
          strokeWidth="1.5" opacity="0.5" strokeLinejoin="round" />
      ))}

      {/* The current curve, in the design's chart voice: "you" is the one
          white line, the discipline is the tinted fill under it. The area
          fill closes down to the zero line, which the zero-based axis makes
          honest — the shaded area IS the watts. */}
      <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
        {/* var(--bike) resolves at the stop: the token lives on :root */}
        <stop offset="0%" style={{ stopColor: 'var(--bike)' }} stopOpacity="0.16" />
        <stop offset="100%" style={{ stopColor: 'var(--bike)' }} stopOpacity="0" />
      </linearGradient>
      <path d={path(pts)
        + ' L' + X(pts[pts.length - 1].durationSec).toFixed(1) + ' ' + Y(0).toFixed(1)
        + ' L' + X(pts[0].durationSec).toFixed(1) + ' ' + Y(0).toFixed(1) + ' Z'}
        fill={'url(#' + fillId + ')'} stroke="none" />
      <path d={path(pts)} fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />

      {/* Every duration's watts, on the chart. The rows that used to carry
          these numbers are gone, so the labels ALTERNATE above and below the
          line: on a log axis the long durations crowd together (40 and 60 min
          sit ~18px apart at this width), and a single band would collide
          exactly as the threshold label did before it moved. Alternating means
          neighbours never share a horizontal band.

          With showDeltas on, the same slots carry the change against the
          previous curve instead — the SAME slots, deliberately, so the
          collision-safety measured for watts holds for deltas by
          construction rather than needing a second measurement. Incomparable
          and new points show no delta at all: the line is already withheld
          for them, and a number would be the claim the withheld line refuses
          to make. */}
      {pts.map((p, i) => {
        const x = X(p.durationSec), y = Y(p.watts);
        const above = i % 2 === 0;
        const first = i === 0, last = i === pts.length - 1;
        const row = showDeltas && comparison
          ? comparison.rows.find(r => r.durationSec === p.durationSec) : null;
        const delta = row && row.deltaPct != null
          ? (row.deltaPct > 0 ? '+' : '') + row.deltaPct + '%' : null;
        return (
          <g key={p.durationSec}>
            <circle cx={x} cy={y} r="3"
              /* transparent for a stale point: it reads as hollow against
                 whatever is behind, which var(--card) stopped doing when the
                 pane went translucent. */
              fill={staleSet.has(p.durationSec) ? 'transparent' : '#fff'}
              stroke="#fff" strokeWidth="1.5">
              <title>{tick(p.durationSec) + ': ' + p.watts + ' W'
                + (ftpWatts ? ' (' + Math.round(p.watts / ftpWatts * 100) + '% of threshold)' : '')
                + (delta ? ', ' + delta + ' vs previous' : '')}</title>
            </circle>
            {(!showDeltas || delta) && (
              <text x={x} y={above ? y - 7 : y + 11} fontSize="8"
                fill={showDeltas || staleSet.has(p.durationSec) ? 'var(--muted)' : 'var(--ink)'}
                fontStyle={showDeltas ? 'italic' : undefined}
                textAnchor={first ? 'start' : last ? 'end' : 'middle'}>{showDeltas ? delta : p.watts}</text>
            )}
          </g>
        );
      })}

      {TICKS.map(d => (
        <text key={d} x={X(d)} y={H - 6} fontSize="8" fill="var(--muted)"
          textAnchor={d === D[0] ? 'start' : d === D[D.length - 1] ? 'end' : 'middle'}>{tick(d)}</text>
      ))}

      {/* Two lines need a key. Drawn top-right, where the curve has already
          fallen away, so it sits over empty chart rather than over the data. */}
      {shapePts.length > 1 && (
        <g>
          <line x1={W - padR - 62} y1={padT - 6} x2={W - padR - 52} y2={padT - 6}
            stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.85" />
          <text x={W - padR - 49} y={padT - 3.5} fontSize="7.5" fill="var(--muted)">expected shape</text>
        </g>
      )}
    </svg>
  );
}
