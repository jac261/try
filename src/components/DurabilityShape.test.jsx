import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DurabilityShape, HR_SPAN } from './DurabilityShape.jsx';

/* Three idioms since 2026-08-04, and the scaling rules that keep them
   honest. There was no component test at all before this: every durability
   test exercised the shape BUILDERS, so nothing would have noticed the chart
   drawing a cropped axis or a silent scale. */

const runShape = {
  sport: 'run', axis: 'm',
  points: [
    { metres: 5000, pace: 292, hr: 142, laps: 5 }, { metres: 10000, pace: 295, hr: 146, laps: 5 },
    { metres: 15000, pace: 298, hr: 151, laps: 5 }, { metres: 21000, pace: 306, hr: 155, laps: 6 },
  ],
  totalM: 21000, decouplingPct: 4.8, hrDriftPct: 9.2,
};
const bikeShape = {
  sport: 'bike', axis: 'kJ',
  points: [
    { kJ: 700, watts: 258, laps: 4 }, { kJ: 1400, watts: 253, laps: 4 },
    { kJ: 2100, watts: 243, laps: 4 }, { kJ: 2800, watts: 227, laps: 4 },
  ],
  totalKJ: 2800, dropPct: 12, holdPct: [100, 98, 94, 88],
};
const swimShape = {
  sport: 'swim', axis: 'm',
  points: [
    { metres: 750, pace100: 96, strokesPerLength: 16, laps: 8 },
    { metres: 1500, pace100: 98, strokesPerLength: 16, laps: 8 },
    { metres: 2250, pace100: 99, strokesPerLength: 15, laps: 7 },
    { metres: 3000, pace100: 101, strokesPerLength: 14.5, laps: 7 },
  ],
  totalM: 3000, paceDriftSec: 5, strokeDrift: -1.5, deviceCounted: true,
};
const html = shape => renderToStaticMarkup(<DurabilityShape shape={shape} />);

describe('each sport gets its own shape', () => {
  it('the run draws pill rows, the bike a line, the swim bars under a line', () => {
    expect(html(runShape)).toContain('du-bar-track');
    expect(html(runShape)).not.toContain('<svg');
    expect(html(bikeShape)).toContain('<polyline');
    expect(html(bikeShape)).not.toContain('du-bar-track');
    expect(html(swimShape)).toContain('<polyline');
    expect(html(swimShape)).toContain('<rect');
  });

  it('refuses anything it cannot draw rather than drawing it wrong', () => {
    expect(html({ sport: 'run', points: [runShape.points[0]] })).toBe('');
    expect(html({ sport: 'skiing', points: runShape.points })).toBe('');
    expect(html(null)).toBe('');
  });
});

describe('buckets are labelled as the spans they are', () => {
  it('each row names its stretch, not a single point on the axis', () => {
    const out = html(runShape);
    expect(out).toContain('0–5 km');
    expect(out).toContain('5–10 km');
    expect(out).toContain('15–21 km');
    // the old single-endpoint tick would have printed a bare "5k"
    expect(out).not.toMatch(/>5k</);
  });
});

describe('the scaling rules', () => {
  it('run fills are zero-based shares of the fastest bucket, so a flat session looks flat', () => {
    const out = html(runShape);
    // 292/292 = 100%, 292/306 = 95.4%: honest, and visibly nearly full
    expect(out).toContain('width:100%');
    expect(out).toMatch(/width:95\.4\d*%/);
  });

  it('the heart-rate tick uses a FIXED span, not the session\'s own range', () => {
    // 142 bpm on a 100-180 window is (142-100)/80 = 52.5%, and it must stay
    // there whatever the other buckets do. A per-session span would pin the
    // lowest bucket to 0% and the highest to 100% every time, which is a
    // full-width crop and makes two sessions incomparable.
    const at = out => out.match(/du-bar-tick[^"]*"\s*style="left:([\d.]+)%/);
    const wide = { ...runShape, points: runShape.points.map((p, i) => (i ? { ...p, hr: 180 } : p)) };
    expect(at(html(runShape))[1]).toBe('52.5');
    expect(at(html(wide))[1]).toBe('52.5');
    expect(HR_SPAN).toEqual({ lo: 100, hi: 180 });
  });

  it('the tick clamps rather than escaping its bar', () => {
    const wild = { ...runShape, points: runShape.points.map(p => ({ ...p, hr: 240 })) };
    expect(html(wild)).toContain('left:100%');
    const low = { ...runShape, points: runShape.points.map(p => ({ ...p, hr: 40 })) };
    expect(html(low)).toContain('left:0%');
  });

  it('the bike line prints every gridline it is read against', () => {
    const out = html(bikeShape);
    // a non-zero base is honest only while the span is declared
    expect(out).toContain('>100%<');
    expect(out).toContain('>88%<');
    expect(out).toContain('258 w');
    expect(out).toContain('227 w');
  });

  it('the swim prints its pace gridlines and inks the stroke count in the bar', () => {
    const out = html(swimShape);
    expect(out).toContain('1:36');   // fastest bucket
    expect(out).toContain('1:41');   // slowest
    expect(out).toContain('>16<');
    expect(out).toContain('>14.5<');
  });
});

describe('the legends say what the marks mean', () => {
  it('the run legend states the tick\'s window in bpm', () => {
    expect(html(runShape)).toContain('100–180 bpm across the bar');
    expect(html(runShape)).toContain('pace, longer = faster');
  });

  it('the swim legend names both series', () => {
    const out = html(swimShape);
    expect(out).toContain('pace per 100');
    expect(out).toContain('strokes per length');
  });
});
