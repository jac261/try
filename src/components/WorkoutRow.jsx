import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { ProfileStrip } from '@/components/WorkoutProfile.jsx';

const D = T.DISCIPLINES;

/* ---------------- workout row + detail ---------------- */
export function WorkoutRow({ w, done, onClick, eff, moved, profile }) {
  if (w.discipline === 'rest') return (
    <div className="wk" style={{ opacity: .6, cursor: 'default' }}>
      <div className="dot" style={{ background: 'var(--rest)' }}><Icon name="rest" size={22} /></div>
      <div className="meta"><div className="t">Rest day</div><div className="s">Recover & adapt</div></div>
    </div>
  );
  const disc = D[w.discipline];
  return (
    <div className={'wk' + (done ? ' done' : '')} {...tap(onClick)}>
      <div className="dot" style={{ background: disc.grad }}><Icon name={disc.icon} size={22} /></div>
      <div className="meta">
        <div className="t">{w.title} {w.test ? <span className="tag test">Test</span> : (w.key && !w.race && <span className="tag key">Key</span>)}{w.second && <span className="tag second">2nd</span>}{w.custom && <span className="tag added">Added</span>}{w.eased && <span className="tag eased">Eased</span>}{w.trimmed && <span className="tag trimmed">Trimmed</span>}{w.boosted && <span className="tag boosted">Boosted</span>}{moved && <span className="tag moved">Moved</span>}</div>
        <div className="s">{w.type}{w.distance ? ' · ' + w.distance + ' ' + w.unit : ''} · {T.fmtDuration(w.durationMin || 0)}</div>
        {profile && <ProfileStrip w={w} />}
      </div>
      <div className="right">{T.fmtDate(eff || w.date, { weekday: 'short' })}</div>
      <div className="check">✓</div>
    </div>
  );
}

// One-line "why this session" coaching note, keyed by workout type.
