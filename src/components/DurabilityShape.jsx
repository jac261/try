import * as T from '@/lib';

/* The durability shape, drawn — one chart idiom per sport.
 *
 * The design ships three separate cards (Durability bike/run/swim.dc.html)
 * and its own hub page says why: "three shapes for one question, because the
 * x-axis differs by sport". The first build collapsed all three into a single
 * bar chart with per-sport accessors, which is why the cards never looked
 * like the design. They are three shapes again here (Jon, 2026-08-04):
 *
 *   run  — pill rows, pace against distance, heart rate as the tell
 *   bike — a line over its area, power held as work accumulates
 *   swim — stroke bars under a pace line, form failing before fitness
 *
 * SCALING, which the design's own cards get wrong and this deliberately does
 * not (the mockups crop the bike axis to 100/94/88% and the swim to two
 * gridlines, the same exaggeration PowerCurveChart refuses):
 *
 *   - A bar's LENGTH is a magnitude, so bars start at zero. Run fills and
 *     swim stroke bars are zero-based, and the honest consequence is that a
 *     strong session looks flat. The printed number carries the precision.
 *   - A line encodes CHANGE, so its axis need not start at zero — but every
 *     gridline it is read against is printed, which makes the span declared
 *     rather than silent.
 *   - A tick that encodes a value needs a FIXED, stated span. Never the
 *     session's own min-to-max: that is a full-width crop, and it would also
 *     make two sessions' cards incomparable. The run's heart-rate tick rides
 *     HR_SPAN, clamped, and the legend says so.
 */

/* Buckets are spans, so they are labelled as spans. Each point's axis value
   is the END of its bucket (durability-shape.js), so a row covers the
   previous point's value up to its own, and the first starts at zero. */
function rangeLabel(points, i, key, unit) {
  const lo = i === 0 ? 0 : points[i - 1][key];
  const hi = points[i][key];
  const scale = v => (v >= 1000 ? Math.round(v / 100) / 10 : v);
  const big = hi >= 1000;
  const tail = unit === 'kJ' ? (big ? 'k kJ' : ' kJ') : (big ? ' km' : ' m');
  return scale(lo) + '–' + scale(hi) + tail;
}

/* The declared heart-rate window. Fixed on purpose: a per-session span would
   pin the slowest bucket to one end of the bar and the fastest to the other
   every single time, which is a crop that also destroys any comparison
   between two sessions. */
export const HR_SPAN = { lo: 100, hi: 180 };

const clamp01 = v => Math.max(0, Math.min(1, v));

/* THE RUN — the design's pill rows: label, pressed trough, value. */
function RunShape({ shape }) {
  const fastest = Math.min(...shape.points.map(p => p.pace));
  return (
    <div className="chart-well">
      {shape.points.map((p, i) => (
        <div className="du-bar" key={i}>
          <span className="du-bar-label">{rangeLabel(shape.points, i, 'metres', 'm')}</span>
          <span className="du-bar-track">
            {/* zero-based: the share of the session's own fastest bucket */}
            <i className="du-bar-fill run" style={{ width: (clamp01(fastest / p.pace) * 100) + '%' }} />
            <i className="du-bar-tick" style={{ left: (clamp01((p.hr - HR_SPAN.lo) / (HR_SPAN.hi - HR_SPAN.lo)) * 100) + '%' }} />
          </span>
          <span className="du-bar-val">{T.fmtPace(p.pace)} <span className="du-bar-sub">· {p.hr}</span></span>
        </div>
      ))}
      <div className="du-legend">
        <span><i className="du-key run" />pace, longer = faster</span>
        <span><i className="du-key tick" />heart rate, {HR_SPAN.lo}&ndash;{HR_SPAN.hi} bpm across the bar</span>
      </div>
    </div>
  );
}

const PLOT = { w: 320, h: 112, padL: 34, padR: 8, padT: 14, padB: 20 };

// x centres for n points across the plot, and the y for a 0..1 fraction
const plotX = (i, n) => PLOT.padL + (n === 1 ? 0 : (i * (PLOT.w - PLOT.padL - PLOT.padR)) / (n - 1));
const plotY = f => PLOT.padT + (1 - f) * (PLOT.h - PLOT.padT - PLOT.padB);
/* The end points sit ON the plot edges, so a centred label there runs off
   the viewBox and the browser simply clips it — the last watts value read
   "227 v" until this existed. Anchor the ends inward instead. */
const endAnchor = (i, n) => (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');

/* THE BIKE — power held against work done, as a line over its own area. The
   y-axis spans the session's own hold percentages and PRINTS them, which is
   what makes a non-zero base honest here rather than a crop. */
function BikeShape({ shape }) {
  const hold = shape.holdPct;
  const lo = Math.min(...hold), hi = Math.max(...hold);
  const span = Math.max(1, hi - lo);
  const fy = v => (v - lo) / span;
  const pts = hold.map((v, i) => [plotX(i, hold.length), plotY(fy(v))]);
  const line = pts.map(([x, y]) => x + ',' + y).join(' ');
  const base = plotY(0);
  return (
    <div className="chart-well">
      <svg viewBox={'0 0 ' + PLOT.w + ' ' + PLOT.h} style={{ width: '100%', height: PLOT.h, display: 'block' }}
        role="img" aria-label={'Power held: ' + shape.points.map((p, i) => hold[i] + '% by ' + p.kJ + ' kJ').join(', ')}>
        <defs>
          <linearGradient id="duBikeArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--bike)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--bike)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[hi, lo].map(v => (
          <g key={v}>
            <line x1={PLOT.padL} y1={plotY(fy(v))} x2={PLOT.w - PLOT.padR} y2={plotY(fy(v))}
              stroke="var(--faint)" strokeOpacity="0.35" strokeWidth="1" />
            <text x={PLOT.padL - 6} y={plotY(fy(v)) + 3} fontSize="8" fill="var(--sub)" textAnchor="end">{v}%</text>
          </g>
        ))}
        <polygon points={PLOT.padL + ',' + base + ' ' + line + ' ' + (PLOT.w - PLOT.padR) + ',' + base} fill="url(#duBikeArea)" />
        <polyline points={line} fill="none" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map(([x, y], i) => {
          const last = i === pts.length - 1;
          return <g key={i}>
            <circle cx={x} cy={y} r={last ? 4.5 : 3.5} fill={last ? 'var(--bike)' : '#fff'} />
            <text x={x} y={y - 8} fontSize="8.5" fontWeight="800" fill="var(--ink)" textAnchor={endAnchor(i, pts.length)}>{shape.points[i].watts} w</text>
          </g>;
        })}
        {shape.points.map((p, i) => (
          <text key={i} x={plotX(i, shape.points.length)} y={PLOT.h - 5} fontSize="7.5" fill="var(--sub)" textAnchor={endAnchor(i, shape.points.length)}>
            {rangeLabel(shape.points, i, 'kJ', 'kJ')}
          </text>
        ))}
      </svg>
      <div className="du-legend">
        <span><i className="du-key line" />power held, against work done</span>
      </div>
    </div>
  );
}

/* THE SWIM — stroke count as bars, pace as the line above them. Both on one
   plot because the story is the pair: pace slipping while the stroke count
   falls is form letting go before the engine does. */
function SwimShape({ shape }) {
  const n = shape.points.length;
  const spl = shape.points.map(p => p.strokesPerLength);
  const maxSpl = Math.max(...spl);
  const paces = shape.points.map(p => p.pace100);
  const lo = Math.min(...paces), hi = Math.max(...paces);
  const span = Math.max(0.5, hi - lo);
  // a slower pace is a BIGGER number and belongs lower on the plot
  const py = v => plotY(1 - (v - lo) / span);
  const pts = paces.map((v, i) => [plotX(i, n), py(v)]);
  const barW = Math.min(26, (PLOT.w - PLOT.padL - PLOT.padR) / (n * 1.6));
  const base = PLOT.h - PLOT.padB;
  /* The gutter is 34px and "1:36 /100m" does not fit in it — it rendered as
     "5 /100m", a clipped label that reads as a wrong number rather than a
     cut-off one. The legend already says these are per 100, so the axis
     prints the time alone; the aria-label keeps the full unit. */
  const label = v => Math.floor(v / 60) + ':' + String(Math.round(v % 60)).padStart(2, '0');
  const spoken = v => T.swimPaceLabel(v, { length: 100, unit: 'meters' });
  return (
    <div className="chart-well">
      <svg viewBox={'0 0 ' + PLOT.w + ' ' + PLOT.h} style={{ width: '100%', height: PLOT.h, display: 'block' }}
        role="img" aria-label={'Pace and stroke count: ' + shape.points.map(p => spoken(p.pace100) + ' at ' + p.strokesPerLength + ' strokes per length').join(', ')}>
        {[lo, hi].map(v => (
          <g key={v}>
            <line x1={PLOT.padL} y1={py(v)} x2={PLOT.w - PLOT.padR} y2={py(v)}
              stroke="var(--faint)" strokeOpacity="0.35" strokeWidth="1" />
            <text x={PLOT.padL - 6} y={py(v) + 3} fontSize="8" fill="var(--sub)" textAnchor="end">{label(v)}</text>
          </g>
        ))}
        {spl.map((v, i) => {
          // zero-based, and held to the lower half so the pace line stays clear
          const h = (v / maxSpl) * (base - PLOT.padT) * 0.55;
          // the end points sit ON the edges, so an edge bar would straddle
          // the viewBox and lose half its inked value to the clip
          const x = Math.max(0, Math.min(PLOT.w - barW, plotX(i, n) - barW / 2));
          return <g key={i}>
            <rect x={x} y={base - h} width={barW} height={h} rx="4" fill="var(--swim)" opacity="0.5" />
            <text x={x + barW / 2} y={base - 5} fontSize="8" fontWeight="800" fill="var(--ink)" textAnchor="middle">{v}</text>
          </g>;
        })}
        <polyline points={pts.map(([x, y]) => x + ',' + y).join(' ')} fill="none" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === n - 1 ? 4.5 : 3.5} fill={i === n - 1 ? 'var(--swim)' : '#fff'} />
        ))}
        {shape.points.map((p, i) => (
          <text key={i} x={plotX(i, n)} y={PLOT.h - 5} fontSize="7.5" fill="var(--sub)" textAnchor={endAnchor(i, n)}>
            {rangeLabel(shape.points, i, 'metres', 'm')}
          </text>
        ))}
      </svg>
      <div className="du-legend">
        <span><i className="du-key line" />pace per 100</span>
        <span><i className="du-key swim" />strokes per length</span>
      </div>
    </div>
  );
}

const SHAPES = { run: RunShape, bike: BikeShape, swim: SwimShape };

export function DurabilityShape({ shape }) {
  if (!shape || !shape.points || shape.points.length < 2) return null;
  const Chart = SHAPES[shape.sport];
  return Chart ? <Chart shape={shape} /> : null;
}
