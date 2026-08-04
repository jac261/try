import * as T from '@/lib';

/* The durability shape, drawn (Durability.dc.html).
 *
 * The doc calls these "three shapes for one question", and they are three
 * READINGS rather than three chart types: each is a row of bars along the
 * sport's own axis with a second number annotating each bar. So this is one
 * component with per-sport accessors, not three charts — a bike bar is watts
 * against kJ, a run bar is pace against heart rate, a swim bar is pace
 * against stroke count.
 *
 * Bars rather than lines on purpose. A bucket is a STRETCH of the session
 * ("the work between 1 000 and 2 000 kJ"), and a line between bucket centres
 * would draw a continuity through ground that was never sampled that way.
 *
 * Pace bars are inverted — longer means faster — because a bar that grows as
 * you slow down reads as improvement at a glance. The doc labels this on the
 * card and so does the legend here.
 */

const BAR_W = 320, BAR_H = 96, PAD_X = 6, GAP = 8, LABEL_H = 26;

/* Axis ticks. Only the last one carries the unit, and a thousands value
   carries it as the SCALED unit — "21 km", not the "21k m" a naive suffix
   produces, which is the kind of label that reads as a typo. */
function axisTick(v, s, p, unit) {
  const last = p === s.points[s.points.length - 1];
  const big = v >= 1000;
  const n = big ? Math.round(v / 100) / 10 : v;
  if (!last) return String(n) + (big && unit === 'kJ' ? 'k' : '');
  if (unit === 'kJ') return n + (big ? 'k' : '') + ' kJ';
  return n + (big ? ' km' : ' m');
}

// Each sport's reading of its own shape. `primary` is the bar, `secondary`
// the number above it, `axis` the label beneath.
const READING = {
  bike: {
    tint: 'var(--bike)',
    // the bar is the held share of the opening power, which is what makes a
    // fade legible without knowing the rider's numbers
    primary: (p, s) => p.watts / s.points[0].watts,
    barLabel: p => p.watts + ' w',
    /* The doc prints 100% / 94% / 88% above its columns, and building this
       showed why: a 12% fade across a 70px plot is eight pixels, which the
       eye cannot resolve. Cropping the axis would make it legible by
       exaggerating it — the cliff the power curve's own comment warns
       against — so the bar keeps its honest zero base and the percentage
       carries the precision. */
    secondary: (p, s) => s.holdPct[s.points.indexOf(p)] + '%',
    axisLabel: (p, s) => axisTick(p.kJ, s, p, 'kJ'),
    legend: 'power held, against work done',
  },
  run: {
    tint: 'var(--run)',
    // inverted: the fastest bucket is the tallest bar
    primary: (p, s) => Math.min(...s.points.map(q => q.pace)) / p.pace,
    barLabel: p => T.fmtPace(p.pace),
    secondary: p => p.hr + ' bpm',
    axisLabel: (p, s) => axisTick(p.metres, s, p, 'm'),
    legend: 'pace (longer = faster), with heart rate',
  },
  swim: {
    tint: 'var(--swim)',
    primary: (p, s) => Math.min(...s.points.map(q => q.pace100)) / p.pace100,
    barLabel: p => T.swimPaceLabel(p.pace100, { length: 100, unit: 'meters' }),
    secondary: p => p.strokesPerLength + '/len',
    axisLabel: (p, s) => axisTick(p.metres, s, p, 'm'),
    legend: 'pace (longer = faster), with strokes per length',
  },
};

export function DurabilityShape({ shape }) {
  if (!shape || !shape.points || shape.points.length < 2) return null;
  const r = READING[shape.sport];
  if (!r) return null;

  const n = shape.points.length;
  const w = (BAR_W - PAD_X * 2 - GAP * (n - 1)) / n;
  const top = LABEL_H;
  const plot = BAR_H - LABEL_H;

  return (
    <div className="chart-well">
      <svg viewBox={'0 0 ' + BAR_W + ' ' + (BAR_H + LABEL_H)} style={{ width: '100%', height: BAR_H + LABEL_H, display: 'block' }}
        role="img" aria-label={'Durability shape: ' + shape.points.map((p, i) => r.axisLabel(p, shape) + ' ' + r.barLabel(p, shape)).join(', ')}>
        {shape.points.map((p, i) => {
          const frac = Math.max(0.06, Math.min(1, r.primary(p, shape)));
          const h = plot * frac;
          const x = PAD_X + i * (w + GAP);
          const y = top + (plot - h);
          return (
            <g key={i}>
              {/* the bar: discipline tint, with the white cap that means "the
                  athlete's own reading" everywhere else in the app */}
              <rect x={x} y={y} width={w} height={h} rx="4"
                fill={r.tint} opacity="0.32" />
              <rect x={x} y={y} width={w} height="2.5" rx="1.25" fill="#fff" />
              {/* the bar's own value, above it */}
              <text x={x + w / 2} y={y - 6} fontSize="9" fontWeight="800"
                fill="var(--ink)" textAnchor="middle">{r.barLabel(p, shape)}</text>
              {/* the second reading, the tell for this sport */}
              {r.secondary && (
                <text x={x + w / 2} y={y - 16} fontSize="8"
                  fill="var(--sub)" textAnchor="middle">{r.secondary(p, shape)}</text>
              )}
              <text x={x + w / 2} y={BAR_H + 12} fontSize="8"
                fill="var(--sub)" textAnchor="middle">{r.axisLabel(p, shape)}</text>
            </g>
          );
        })}
      </svg>
      <div className="du-legend">{r.legend}</div>
    </div>
  );
}
