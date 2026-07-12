import { useEffect, useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { useSheetFocus } from '@/utils/useSheetFocus.js';
import { Icon } from '@/components/Icon.jsx';

/* Wrapped-style session recap: full-screen, one idea per slide, tap the right
   side (or the arrow) to advance, left to go back, X to leave. Slides come
   pre-assembled from lib/recap.js; the interval rows arrive lazily and the
   deck simply re-renders when they do. */
export function RecapSlides({ workout, activity, plan, log, moves, onLoadIntervals, onClose }) {
  const [idx, setIdx] = useState(0);
  const [reps, setReps] = useState(null);
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
  if (!slides || !slides.length) return null;
  const i = Math.min(idx, slides.length - 1);
  const s = slides[i];
  const fwd = () => (i < slides.length - 1 ? setIdx(i + 1) : onClose());
  const back = () => setIdx(Math.max(0, i - 1));

  return (
    <div className="recap" ref={focusRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Session recap">
      <div className="recap-dots" aria-hidden="true">
        {slides.map((_, n) => <i key={n} className={n === i ? 'on' : ''} />)}
      </div>
      <a className="recap-close" {...tap(onClose)} role="button" aria-label="Close recap">✕</a>
      <div className="recap-tap left" {...tap(back)} aria-label="Previous slide" role="button" />
      <div className="recap-tap right" {...tap(fwd)} aria-label="Next slide" role="button" />
      <div className="recap-body" key={i}>
        <div className="recap-kicker">{s.title}</div>
        {s.big && <div className="recap-big">{s.big}</div>}
        {(s.lines || []).map((l, n) => <p className="recap-line" key={n}>{l}</p>)}
        {s.rows && (
          <div className="recap-bars">
            {s.rows.slice(0, 10).map((r, n) => (
              <div className="rb" key={n}>
                <span className="rb-l">{r.label}</span>
                <span className="rb-bar"><i style={{
                  width: Math.round(Math.max(0.15, Math.min(1, r.frac || 0)) * 100) + '%',
                  background: r.tone === 'good' ? 'var(--run)' : r.tone === 'warn' ? '#f6b27a' : 'var(--blue)',
                }} /></span>
                <span className="rb-v">{r.value}</span>
              </div>
            ))}
          </div>
        )}
        {i === slides.length - 1 && (
          <button className="btn primary" style={{ marginTop: 22 }} onClick={onClose}>
            <Icon name="bolt" size={18} /> Done
          </button>
        )}
      </div>
    </div>
  );
}
