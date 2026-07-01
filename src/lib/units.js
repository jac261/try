/* Try — number, pace & duration helpers. */

export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
export function round5(n) { return Math.max(5, Math.round(n / 5) * 5); }
export function lerp(a, b, t) { return a + (b - a) * t; }

export function fmtPace(secPerKm) {
  const s = Math.round(secPerKm);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function parseTimeToSec(str) {
  if (!str) return null;
  const parts = String(str).split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number(str) * 60;
}

export function fmtDuration(min) {
  const m = Math.round(min);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? h + 'h ' + r + 'm' : h + 'h';
}
