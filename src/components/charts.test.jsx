import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { TrendChart } from './charts.jsx';

/* TrendChart carries five charts already, so the season's additions had to be
   opt-in. Byte-identity against the pre-change component was checked directly
   at the time, across fill / null gaps / zones / bars+refLines / band+domain;
   what is worth KEEPING is the guard that the new props stay off by default,
   because that is the thing a later edit could quietly break. */

const base = { series: [{ values: [10, 20, 30, 25], color: '#5b8cff' }], height: 100 };

describe('TrendChart: the season additions are opt-in', () => {
  it('draws no dash, no markers and no ribbon when it is not asked to', () => {
    const svg = renderToString(<TrendChart {...base} />);
    expect(svg).not.toContain('stroke-dasharray');
    expect(svg).not.toContain('letter-spacing="0.7"');   // the mark label
    expect(svg).toContain('circle');                     // but the endpoint dot is still there
  });

  it('keeps the plot the same height until a ribbon asks for room', () => {
    const plain = renderToString(<TrendChart {...base} />);
    const ribbed = renderToString(<TrendChart {...base} ribbon={[{ from: 0, to: 3, color: '#38bdf8', label: 'Base' }]} />);
    expect(ribbed).not.toBe(plain);
    // both still declare the same box; only the plot inside it gives way
    expect(ribbed).toContain('viewBox="0 0 320 100"');
    expect(plain).toContain('viewBox="0 0 320 100"');
    expect(ribbed).toContain('Base');
  });
});

describe('TrendChart: what the season asks for', () => {
  it('dashes a series and can withhold its endpoint dot', () => {
    const svg = renderToString(<TrendChart height={100} series={[
      { values: [null, null, 20, 25], color: '#fff', dash: '5 5', noDot: true },
    ]} />);
    expect(svg).toContain('stroke-dasharray="5 5"');
    expect(svg).not.toContain('<circle');
  });

  it('places a marker at a fractional index, between two points', () => {
    const at = i => {
      const svg = renderToString(<TrendChart {...base} marks={[{ i, label: 'TODAY', value: 20 }]} />);
      return Number(/<line x1="([\d.]+)" x2="\1"/.exec(svg)[1]);
    };
    const one = at(1), two = at(2), half = at(1.5);
    expect(half).toBeGreaterThan(one);
    expect(half).toBeLessThan(two);
    // and it really is halfway, not snapped
    expect(half).toBeCloseTo((one + two) / 2, 4);
  });

  it('gives a ribbon span the full width of the weeks it covers', () => {
    const svg = renderToString(<TrendChart {...base}
      ribbon={[{ from: 0, to: 1, color: '#38bdf8', label: 'Base' }, { from: 2, to: 3, color: '#c084fc', label: 'Build' }]} />);
    const rects = [...svg.matchAll(/<rect x="([\d.]+)"[^>]*width="([\d.]+)"[^>]*rx="3.5"/g)]
      .map(m => ({ x: Number(m[1]), w: Number(m[2]) }));
    expect(rects).toHaveLength(2);
    // they meet rather than overlapping or leaving a gap in the middle
    expect(rects[0].x + rects[0].w).toBeCloseTo(rects[1].x, 1);
    expect(svg).toContain('Build');
  });
});
