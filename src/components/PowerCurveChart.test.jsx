// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PowerCurveChart } from '@/components/PowerCurveChart.jsx';
import { PowerCurveCard } from '@/components/PowerCurveCard.jsx';
import { powerCurve, curveComparison, staleDurations, CURVE_DURATIONS } from '@/lib/bike-power-curve.js';

/* The curve as a curve (Jon, 2026-07-30). Two things this must get right that
 * a generic line chart would not: a LOG duration axis, and a refusal to draw
 * a previous curve through points the model says are not comparable. */

const TODAY = '2026-07-30';
const pt = (durationSec, watts, extra = {}) => ({
  durationSec, watts, date: '2026-07-01', source: 'Quarq', bike: 'Tarmac', indoor: false, quality: 'high', ...extra,
});
const FULL = powerCurve(CURVE_DURATIONS.map((d, i) => pt(d, 900 - i * 70)));

const render = (props) => renderToString(<PowerCurveChart {...props} />);

describe('PowerCurveChart', () => {
  it('renders a path and one marker per duration', () => {
    const html = render({ curve: FULL, stale: [], ftpWatts: 260 });
    expect(html).toContain('<path');
    expect((html.match(/<circle/g) || []).length).toBe(FULL.points.length);
    // SSR splits interpolated text with comment markers, so match loosely
    expect(html).toMatch(/threshold[\s\S]{0,30}260/);
  });

  it('places duration on a LOG axis, not by even index', () => {
    /* The reason this component exists rather than reusing TrendChart. With a
       sparse curve — 5 s, 1 min, 60 min — even-index spacing would put the
       middle point at the centre of the chart, drawing a straight decline that
       is not there. On a log axis 60 s sits about a third of the way across. */
    const sparse = powerCurve([pt(5, 900), pt(60, 400), pt(3600, 240)]);
    const html = render({ curve: sparse, stale: [] });
    const xs = [...html.matchAll(/<circle[^>]*cx="([\d.]+)"/g)].map(m => parseFloat(m[1]));
    expect(xs).toHaveLength(3);
    const span = xs[2] - xs[0];
    const middleFraction = (xs[1] - xs[0]) / span;
    expect(middleFraction).toBeGreaterThan(0.25);
    expect(middleFraction).toBeLessThan(0.45);   // ~0.38 on log; 0.5 would be even-index
  });

  it('spans the full model duration range, so a missing long best reads as missing', () => {
    // A rider with no hour best must not have their 20-minute point pushed to
    // the right edge as though it were their longest possible effort.
    const short = powerCurve([pt(5, 900), pt(60, 420), pt(300, 330)]);
    const html = render({ curve: short, stale: [] });
    const xs = [...html.matchAll(/<circle[^>]*cx="([\d.]+)"/g)].map(m => parseFloat(m[1]));
    expect(Math.max(...xs)).toBeLessThan(200);   // well short of the 320 width
  });

  it('draws stale points hollow and fresh points filled', () => {
    const stale = [3600];
    const html = render({ curve: FULL, stale, ftpWatts: 260 });
    // the hollow one uses the card colour as its fill
    expect(html).toMatch(/<circle[^>]*fill="var\(--card\)"/);
  });

  it('refuses to draw a previous curve through incomparable points', () => {
    // A different power meter reads per cent apart, which looks exactly like
    // fitness. Two lines on one chart is the strongest possible claim that
    // they can be read against each other.
    const prevSame = powerCurve(CURVE_DURATIONS.map((d, i) => pt(d, 880 - i * 70)));
    const withPrev = render({ curve: FULL, previous: prevSame, comparison: curveComparison({ current: FULL, previous: prevSame }), stale: [] });
    const prevMeter = powerCurve(CURVE_DURATIONS.map((d, i) => pt(d, 880 - i * 70, { source: 'Assioma' })));
    const withMeterChange = render({ curve: FULL, previous: prevMeter, comparison: curveComparison({ current: FULL, previous: prevMeter }), stale: [] });
    const paths = h => (h.match(/<path/g) || []).length;
    expect(paths(withPrev)).toBeGreaterThan(paths(withMeterChange));
    expect(paths(withMeterChange)).toBe(1);   // the current curve only
  });

  it('renders nothing for fewer than two points: one best is not a curve', () => {
    expect(render({ curve: powerCurve([pt(300, 330)]), stale: [] })).toBe('');
    expect(render({ curve: null, stale: [] })).toBe('');
  });

  it('survives a curve with no threshold to reference', () => {
    const html = render({ curve: FULL, stale: [] });
    expect(html).toContain('<path');
    expect(html).not.toMatch(/threshold/);
  });
});

describe('the card shows the graph above its rows', () => {
  it('renders the chart and keeps the per-duration detail', () => {
    const html = renderToString(
      <PowerCurveCard curve={FULL} previous={null} ftpWatts={260} todayISO={TODAY} />);
    expect(html).toContain('<svg');                 // the shape
    expect(html).toContain('% of threshold');       // the facts a line cannot carry
    expect(html).toContain('Power curve');
  });

  it('still renders nothing at all without a curve', () => {
    expect(renderToString(<PowerCurveCard curve={null} ftpWatts={260} todayISO={TODAY} />)).toBe('');
  });
});
