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

// Slide kinds whose headline IS a single quantity worth counting up. Titles
// ("The splits" summary, tomorrow's session name) are deliberately excluded so
// an incidental number in a name never animates.
const METRIC_KINDS = new Set(['headline', 'hr', 'effort']);

// Count a metric string up from zero (e.g. "154 bpm", "Load 45"), leaving the
// surrounding text intact. Only fires when `enabled` (a metric slide) AND the
// string holds EXACTLY ONE number — so "1h 05m" (two numbers) shows whole
// rather than counting just the hours, and titles pass straight through. Resets
// synchronously on a slide change (`key`) so a prior slide's number never
// leaks into the next for a frame; honours reduced-motion by landing at once.
function useCountUp(text, key, enabled) {
  const matches = enabled && typeof text === 'string' ? text.match(/\d[\d,]*/g) : null;
  const target = matches && matches.length === 1 ? parseInt(matches[0].replace(/,/g, ''), 10) : null;
  const reduce = prefersReducedMotion();
  const rest = target == null || reduce ? target : 0; // the value to sit at when not animating
  const [n, setN] = useState(rest);
  const [seen, setSeen] = useState(key);
  if (seen !== key) { setSeen(key); setN(rest); } // slide changed: reset in-render, no stale frame
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
  if (target == null) return text;
  return text.replace(/\d[\d,]*/, String(n));
}

export function RecapSlides({ workout, activity, plan, log, moves, onLoadIntervals, onClose }) {
  const [curKind, setCurKind] = useState(null); // track the slide by kind, not
  const [reps, setReps] = useState(null);       // position — the deck grows when reps load
  // Same modal conventions as every sheet: focus moves in, Tab is trapped,
  // Escape closes, focus returns on exit (2026-07-12 audit finding).
  const focusRef = useSheetFocus(onClose);
  const actId = activity && activity.id;
  useEffect(() => {
    if (!actId || !onLoadIntervals) return;
    let gone = false;
    onLoadIntervals(actId).then(list => { if (!gone) setReps(list); });
    return () => { gone = true; };
  }, [actId, onLoadIntervals]);

  const slides = T.buildRecap({
    workout, activity, intervals: reps, paces: plan.paces,
    plan, log, moves, todayISO: T.iso(new Date()),
  });
  // Resolve the current slide by its kind (stable across a lazy reps insertion
  // that would otherwise shift positional indices under the user's finger).
  // Done every render before the empty-deck early return, per rules of hooks.
  const has = !!(slides && slides.length);
  const found = has && curKind ? slides.findIndex(x => x.kind === curKind) : -1;
  const i = has ? (found >= 0 ? found : 0) : 0;
  const s = has ? slides[i] : null;
  const big = useCountUp(s && s.big, s && s.kind, !!(s && METRIC_KINDS.has(s.kind)));
  if (!has) return null;
  const fwd = () => (i < slides.length - 1 ? setCurKind(slides[i + 1].kind) : onClose());
  const back = () => { if (i > 0) setCurKind(slides[i - 1].kind); };
  const L = (s.lines || []).length;

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
        {(s.lines || []).map((l, n) => <p className="recap-line" key={n} style={{ '--i': 2 + n }}>{l}</p>)}
        {s.rows && (
          <div className="recap-bars" style={{ '--i': 2 + L }}>
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
          <button className="btn primary" style={{ marginTop: 22, '--i': 3 + L }} onClick={onClose}>
            <Icon name="bolt" size={18} /> Done
          </button>
        )}
      </div>
    </div>
  );
}
