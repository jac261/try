// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SpiderChart } from '@/components/SpiderChart.jsx';
import { swimSpider, runSpider, bikeSpider } from '@/lib/spider.js';
import { swimPaceLabel } from '@/lib';

/* Rendered on the same happy-dom harness as the other component tests, so
   the chart is checked as markup rather than as a data structure. */

const REAL_SWIM = {
  css100Sec: 110,
  cssMeta: { source: 'try-test', t400Sec: 460, t200Sec: 218, d400: 400, d200: 200 },
};
const REAL_RUN = { fivekSec: 1500, fivekMeta: { source: 'try-test' }, raceType: 'runhalf' };
const POOL = { length: 25, unit: 'meters' };

describe('SpiderChart', () => {
  it('renders named level rings and one label per axis for a full swim spider', () => {
    const html = renderToString(<SpiderChart spider={swimSpider(REAL_SWIM)} color="var(--swim)"
      fmtValue={ax => swimPaceLabel(ax.value, POOL)} />);
    ['Beginner', 'Intermediate', 'Advanced', 'Elite'].forEach(l => expect(html).toContain(l));
    ['100 m', '200 m', '400 m', '800 m', '1500 m'].forEach(l => expect(html).toContain(l));
    expect(html).toContain('<polygon');            // rings and the athlete
    expect(html).toContain('vs Try levels');
    expect(html).not.toMatch(/percentile/i);
  });

  it('marks projections with the app-wide tilde and measured points without', () => {
    // no recorded races: every run axis is a projection
    const projected = renderToString(<SpiderChart spider={runSpider(REAL_RUN, [])} />);
    expect(projected).toContain('~');
    const withRace = renderToString(<SpiderChart
      spider={runSpider(REAL_RUN, [{ type: 'Run', date: 'x', distance: 10100, movingTimeSec: 2900 }])} />);
    // the measured 10k point renders solid (fill=colour, not the card colour)
    expect(withRace.split('~').length).toBeLessThan(projected.split('~').length);
  });

  it('a dormant spider renders its reason and no chart', () => {
    const html = renderToString(<SpiderChart spider={bikeSpider({ ftp: 250, weightKg: 70 }, null)} />);
    expect(html).toContain('power curve');
    expect(html).not.toContain('<svg');
  });

  it('an estimated athlete gets the unlock line, never a polygon', () => {
    const html = renderToString(<SpiderChart spider={runSpider({ fitness: 'intermediate', raceType: 'runhalf' }, [])} />);
    expect(html).toContain('5 km test');
    expect(html).not.toContain('<svg');
  });

  it('renders nothing at all for a null spider rather than crashing', () => {
    expect(renderToString(<SpiderChart spider={null} />)).toBe('');
  });
});
