import { useEffect, useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { useSheetFocus } from '@/utils/useSheetFocus.js';
import { Icon } from '@/components/Icon.jsx';

/* Wrapped-style session recap: full-screen, one idea per slide, tap the right
   side (or the arrow) to advance, left to go back, X to leave. Slides come
   pre-assembled from lib/recap.js; the interval rows arrive lazily and the
   deck simply re-renders when they do. Motion is Wrapped-flavoured — each
   slide's pieces rise in staggered, the headline number counts up, the bars
   sweep out — and every bit of it stands down under prefers-reduced-motion. */

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Duration formatter, matching lib/recap.js fmtMin so the counted headline
// lands exactly on the slide's `big` string.
const fmtDur = sec => {
  const m = Math.round(sec / 60);
  return m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + ' min';
};
const fmtBig = (n, fmt) => fmt === 'dur' ? fmtDur(n) : fmt === 'bpm' ? n + ' bpm' : fmt === 'load' ? 'Load ' + n
  : fmt === 'km1' ? (n / 10).toFixed(1) + ' km' : String(n); // km1 counts tenths of a km

// Animate a headline number up from zero. The slide carries an explicit
// { to, fmt } count spec (from buildRecap), so we animate a known integer and
// format it deterministically — a duration counts as a growing clock, heart
// rate and load as plain numbers, and anything without a spec (titles, split
// summaries) never animates. Resets synchronously on a slide change (`key`) so
// a prior slide's number never leaks into the next for a frame; honours
// reduced-motion by landing on the value at once.
function useCount(target, key) {
  const reduce = prefersReducedMotion();
  const rest = target == null || reduce ? target : 0;
  const [n, setN] = useState(rest);
  const [seen, setSeen] = useState(key);
  if (seen !== key) { setSeen(key); setN(rest); }
  useEffect(() => {
    if (target == null || reduce) return;
    let raf, t0 = null;
    const step = t => {
      if (t0 == null) t0 = t;
      const p = Math.min(1, (t - t0) / 650);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3)))); // easeOutCubic
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => raf && cancelAnimationFrame(raf);
  }, [key, target, reduce]);
  return n;
}

// A red heart-rate trace: each segment's average HR plotted in time order, the
// line drawing itself in left to right with a soft fill welling up beneath.
// Straight segments (segment-average resolution — honest about what it is).
function HrGraph({ hr }) {
  const W = 320, H = 130, pad = 12;
  const pts = hr.series;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const hrs = pts.map(p => p.hr);
  const lo = Math.min(...hrs), hi = Math.max(...hrs, hr.max || 0);
  const span = Math.max(1, hi - lo);
  const x = t => pad + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * (W - 2 * pad);
  const y = v => pad + (1 - (v - lo) / span) * (H - 2 * pad);
  const line = pts.map((p, n) => (n ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.hr).toFixed(1)).join(' ');
  const area = 'M' + x(t0).toFixed(1) + ' ' + (H - pad) + ' '
    + pts.map(p => 'L' + x(p.t).toFixed(1) + ' ' + y(p.hr).toFixed(1)).join(' ')
    + ' L' + x(t1).toFixed(1) + ' ' + (H - pad) + ' Z';
  return (
    <svg className="recap-hr" viewBox={`0 0 ${W} ${H}`} role="img" style={{ '--i': 2 }}
      aria-label={'Heart rate profile, average ' + hr.avg + ', peak ' + hr.max + ' bpm'}>
      <defs>
        <linearGradient id="recap-hr-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--danger)" stopOpacity="0.38" />
          <stop offset="100%" stopColor="var(--danger)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="recap-hr-area" d={area} fill="url(#recap-hr-grad)" />
      <path className="recap-hr-line" d={line} pathLength="1" fill="none"
        stroke="var(--danger)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// The route, drawn as the GPS track alone — no map tiles. A base map would
// drag in an external tile service (network, attribution, visual noise); the
// wrapped aesthetic wants the shape of the effort, not the street names. The
// track projects equirectangularly (x scaled by cos of the mid-latitude so
// shapes keep their proportions), draws itself start to finish, and a dot
// rides the line via offset-path. Browsers without offset-path support (or
// reduced motion) simply show the drawn route — the dot is decoration.
const ROUTE_COLOR = { run: 'var(--run)', bike: 'var(--bike)', brick: 'var(--brick)', swim: 'var(--swim)' };
function RouteMap({ route, discipline }) {
  const W = 320, H = 230, pad = 16;
  // projection lives in lib/route.js (pure, tested — incl. the antimeridian
  // unwrap that keeps a Fiji loop from smearing across the whole viewBox)
  const pts = T.projectRoute(route, W, H, pad);
  const d = pts.map(([x, y], n) => (n ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  const color = ROUTE_COLOR[discipline] || 'var(--accent)';
  return (
    <svg className="recap-route" viewBox={`0 0 ${W} ${H}`} role="img" style={{ '--i': 2 }}
      aria-label="Map of the route taken, drawn from the recording's GPS track">
      <path className="recap-route-ghost" d={d} fill="none"
        stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <path className="recap-route-line" d={d} pathLength="1" fill="none"
        stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle className="recap-route-start" cx={sx} cy={sy} r="4.5" fill="var(--bg, #0e1217)"
        stroke={color} strokeWidth="2.5" />
      <circle className="recap-route-end" cx={ex} cy={ey} r="4.5" fill={color} />
      <circle className="recap-route-dot" r="5" fill={color} style={{ offsetPath: `path("${d}")` }} />
    </svg>
  );
}

export function RecapSlides({ workout, activity, plan, log, moves, onLoadIntervals, onLoadRoute, onClose }) {
  const [curKind, setCurKind] = useState(null); // track the slide by kind, not
  const [reps, setReps] = useState(null);       // position — the deck grows when reps load
  // Same modal conventions as every sheet: focus moves in, Tab is trapped,
  // Escape closes, focus returns on exit (2026-07-12 audit finding).
  const focusRef = useSheetFocus(onClose);
  const [route, setRoute] = useState(null);
  const actId = activity && activity.id;
  useEffect(() => {
    if (!actId || !onLoadIntervals) return;
    let gone = false;
    onLoadIntervals(actId).then(list => { if (!gone) setReps(list); });
    return () => { gone = true; };
  }, [actId, onLoadIntervals]);
  // The GPS track arrives lazily exactly like the reps: the deck re-resolves
  // the current slide by kind, so a route slide appearing mid-view never
  // shifts the slide under the user's finger.
  useEffect(() => {
    if (!actId || !onLoadRoute) return;
    let gone = false;
    onLoadRoute(actId).then(r => { if (!gone) setRoute(r); });
    return () => { gone = true; };
  }, [actId, onLoadRoute]);

  const slides = T.buildRecap({
    workout, activity, intervals: reps, route, paces: plan.paces,
    plan, log, moves, todayISO: T.iso(new Date()),
  });
  // Resolve the current slide by its kind (stable across a lazy reps insertion
  // that would otherwise shift positional indices under the user's finger).
  // Done every render before the empty-deck early return, per rules of hooks.
  const has = !!(slides && slides.length);
  const found = has && curKind ? slides.findIndex(x => x.kind === curKind) : -1;
  const i = has ? (found >= 0 ? found : 0) : 0;
  const s = has ? slides[i] : null;
  const countN = useCount(s && s.count ? s.count.to : null, s && s.kind);
  if (!has) return null;
  const big = s.count && countN != null ? fmtBig(countN, s.count.fmt) : s.big;
  const fwd = () => (i < slides.length - 1 ? setCurKind(slides[i + 1].kind) : onClose());
  const back = () => { if (i > 0) setCurKind(slides[i - 1].kind); };
  const L = (s.lines || []).length;
  const gi = 2 + (s.hr || s.route ? 1 : 0); // lines/bars start after the optional graph/map

  return (
    <div className="recap" ref={focusRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Session recap">
      <div className="recap-dots" aria-hidden="true">
        {slides.map((_, n) => <i key={n} className={n === i ? 'on' : ''} />)}
      </div>
      <a className="recap-close" {...tap(onClose)} role="button" aria-label="Close recap">✕</a>
      <div className="recap-tap left" {...tap(back)} aria-label="Previous slide" role="button" />
      <div className="recap-tap right" {...tap(fwd)} aria-label="Next slide" role="button" />
      <div className="recap-body" key={s.kind}>
        <div className="recap-kicker" style={{ '--i': 0 }}>{s.title}</div>
        {s.big && <div className="recap-big" style={{ '--i': 1 }}>{big}</div>}
        {s.hr && <HrGraph hr={s.hr} />}
        {s.route && <RouteMap route={s.route} discipline={workout.discipline} />}
        {(s.lines || []).map((l, n) => <p className="recap-line" key={n} style={{ '--i': gi + n }}>{l}</p>)}
        {s.rows && (
          <div className="recap-bars" style={{ '--i': gi + L }}>
            {s.rows.slice(0, 10).map((r, n) => (
              <div className="rb" key={n}>
                <span className="rb-l">{r.label}</span>
                <span className="rb-bar"><i style={{
                  '--i': n,
                  width: Math.round(Math.max(0.15, Math.min(1, r.frac || 0)) * 100) + '%',
                  background: r.tone === 'good' ? 'var(--run)' : r.tone === 'warn' ? '#f6b27a' : 'var(--blue)',
                }} /></span>
                <span className="rb-v">{r.value}</span>
              </div>
            ))}
          </div>
        )}
        {i === slides.length - 1 && (
          <button className="btn primary" style={{ marginTop: 22, '--i': gi + L + 1 }} onClick={onClose}>
            <Icon name="bolt" size={18} /> Done
          </button>
        )}
      </div>
    </div>
  );
}
