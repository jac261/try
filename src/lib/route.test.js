import { describe, it, expect } from 'vitest';
import { projectRoute } from './route.js';

const W = 320, H = 230, PAD = 16;
const xs = pts => pts.map(p => p[0]);
const ys = pts => pts.map(p => p[1]);

describe('projectRoute (GPS track → SVG points)', () => {
  it('fits the track inside the padded box, centred', () => {
    const pts = projectRoute([[51.4592, -2.5938], [51.4601, -2.5951], [51.4622, -2.5972]], W, H, PAD);
    pts.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(PAD - 1e-6);
      expect(x).toBeLessThanOrEqual(W - PAD + 1e-6);
      expect(y).toBeGreaterThanOrEqual(PAD - 1e-6);
      expect(y).toBeLessThanOrEqual(H - PAD + 1e-6);
    });
    // the tall axis of this track (latitude) should span the full padded height
    expect(Math.max(...ys(pts)) - Math.min(...ys(pts))).toBeCloseTo(H - 2 * PAD, 5);
  });

  it('keeps north up and east right', () => {
    const pts = projectRoute([[51.0, -2.0], [52.0, -1.0]], W, H, PAD);
    expect(pts[1][1]).toBeLessThan(pts[0][1]);    // more northerly → smaller y
    expect(pts[1][0]).toBeGreaterThan(pts[0][0]); // more easterly → bigger x
  });

  it('scales x by cos(mid latitude) so shapes keep their proportions', () => {
    // 0.1° of longitude at 60°N is half the ground distance of 0.1° latitude,
    // so a "square" in degrees must project twice as tall as it is wide.
    const pts = projectRoute([[60.0, 10.0], [60.1, 10.0], [60.1, 10.1], [60.0, 10.1]], W, H, PAD);
    const w = Math.max(...xs(pts)) - Math.min(...xs(pts));
    const h = Math.max(...ys(pts)) - Math.min(...ys(pts));
    expect(h / w).toBeCloseTo(1 / Math.cos(60.05 * Math.PI / 180), 2);
  });

  it('unwraps the antimeridian: a tight loop at ±180° projects tight, not smeared', () => {
    // a few hundred metres of track near Fiji, straddling the date line
    const route = [[-17.70, 178.5], [-17.71, 179.9], [-17.72, -179.5], [-17.73, -178.0]];
    const pts = projectRoute(route, W, H, PAD);
    // without unwrapping this reads as a ~359° span and the points smear to
    // both edges of the box; unwrapped, longitude runs 178.5 → 182 in order
    const px = xs(pts);
    expect(px[0]).toBeLessThan(px[1]);
    expect(px[1]).toBeLessThan(px[2]);
    expect(px[2]).toBeLessThan(px[3]);
    // and the latitude span (0.03°) vs longitude span (3.5°) means the track
    // is much wider than tall — not a flat line pinned to both edges
    const h = Math.max(...ys(pts)) - Math.min(...ys(pts));
    expect(h).toBeGreaterThan(1);
  });

  it('southern hemisphere tracks are not mirrored', () => {
    const pts = projectRoute([[-33.9, 151.2], [-33.8, 151.2]], W, H, PAD); // Sydney, heading north
    expect(pts[1][1]).toBeLessThan(pts[0][1]);
  });

  it('a degenerate track (all points identical) stays finite', () => {
    const pts = projectRoute([[51.5, -2.5], [51.5, -2.5]], W, H, PAD);
    pts.forEach(([x, y]) => {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    });
  });
});
