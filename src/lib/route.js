/* Try — GPS route projection for the recap map.
 *
 * Pure math, extracted from the RouteMap component so it can be tested like
 * every other piece of pure logic in this codebase: [lat, lng] pairs in, SVG
 * x/y points out. Equirectangular with the x-axis scaled by cos of the mid
 * latitude, so a loop in Bristol keeps its proportions instead of stretching.
 *
 * Longitudes are unwrapped before the bounding box is taken: a short track
 * that straddles the ±180° antimeridian (Fiji, Kiribati, the Bering coast)
 * otherwise reads as spanning the whole globe and projects to a flat smear.
 * When the raw span exceeds 180° the negative side is shifted +360 and the
 * true, tight extent emerges.
 */
export function projectRoute(route, W, H, pad) {
  const lats = route.map(p => p[0]);
  let lngs = route.map(p => p[1]);
  if (Math.max(...lngs) - Math.min(...lngs) > 180) {
    lngs = lngs.map(l => (l < 0 ? l + 360 : l));
  }
  const la0 = Math.min(...lats), la1 = Math.max(...lats);
  const lo0 = Math.min(...lngs), lo1 = Math.max(...lngs);
  const kx = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
  const w = Math.max(1e-7, (lo1 - lo0) * kx), h = Math.max(1e-7, la1 - la0);
  const sc = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
  const ox = (W - w * sc) / 2, oy = (H - h * sc) / 2;
  return route.map((p, n) => [
    ox + (lngs[n] - lo0) * kx * sc,
    oy + (la1 - p[0]) * sc,
  ]);
}
