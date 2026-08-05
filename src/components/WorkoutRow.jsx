import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { ProfileStrip } from '@/components/WorkoutProfile.jsx';

const D = T.DISCIPLINES;

/* ---------------- workout row + detail ---------------- */
/* `right` replaces the weekday in the right-hand column. The calendar's week
   range puts the session's load there, where the weekday would be repeating
   the day heading it already sits under. Absent, the row is unchanged, which
   is the point: this row carries the Key/Test/Race/2nd/Added/Eased/Trimmed/
   Moved tags, and a hand-rolled week row would have quietly dropped them. */
export function WorkoutRow({ w, done, onClick, eff, moved, profile, onToggle, right }) {
  if (w.discipline === 'rest') return (
    <div className="wk" style={{ opacity: .6, cursor: 'default' }}>
      <div className="dot" style={{ background: 'var(--rest)' }}><Icon name="rest" size={22} /></div>
      <div className="meta"><div className="t">Rest day</div><div className="s">Recover & adapt</div></div>
    </div>
  );
  const disc = D[w.discipline];
  // The key glow wants the discipline's own colour; race day is excluded
  // because it is an event, not a training emphasis — its gold ring already
  // says everything.
  const key = !!w.key && !w.race && !w.bRace;
  return (
    <div className={'wk' + (done ? ' done' : '')} {...tap(onClick)}>
      <div className={'dot' + (key ? ' key' : '')}
        style={{ background: disc.grad, '--tile-c': disc.color }}><Icon name={disc.icon} size={22} /></div>
      <div className="meta">
        <div className="t">{w.title} {w.bRace ? <span className="tag test">Race</span> : w.test ? <span className="tag test">Test</span> : (w.key && !w.race && <span className="tag key">Key</span>)}{w.second && <span className="tag second">2nd</span>}{w.custom && <span className="tag added">Added</span>}{w.eased && <span className="tag eased">Eased</span>}{w.trimmed && <span className="tag trimmed">Trimmed</span>}{w.boosted && <span className="tag boosted">Boosted</span>}{moved && <span className="tag moved">Moved</span>}</div>
        {/* Race day's durationMin is a placeholder, and '0 min' next to the
            athlete's goal race read as a glitch (UI sim catch 2026-07-17);
            same reasoning as DetailSheet's race-guarded statline. */}
        {/* Estimated distances wear the tilde, like every estimated pace and
            watt range does. distEst has been set by the builders since the
            run pass but was never rendered (design panel 2026-07-18). */}
        <div className="s">{w.type}{w.distance ? ' · ' + (w.distEst ? '~' : '') + w.distance + ' ' + w.unit : ''}{w.race ? '' : ' · ' + T.fmtDuration(w.durationMin || 0)}</div>
        {profile && <ProfileStrip w={w} />}
      </div>
      <div className="right">{right !== undefined ? right : T.fmtDate(eff || w.date, { weekday: 'short' })}</div>
      {/* .wk.done is a visual class and the tick below is aria-hidden, so
          completion reached the eye and nothing else (audit 2026-08-05).
          Spoken rather than labelled: an aria-label here would have to
          restate the title, type, distance, duration, day and seven possible
          tags, and would drift from them the first time any changed. */}
      {done && <span className="sr-only">Completed</span>}
      {/* pointer-only quick-complete: kept out of the accessibility tree so the
          row is not a button-inside-a-button; keyboard and screen-reader users
          complete sessions via the detail sheet's button. */}
      <div className="check" aria-hidden="true"
        onClick={onToggle && !w.race ? e => { e.stopPropagation(); onToggle(); } : undefined}>✓</div>
    </div>
  );
}

// One-line "why this session" coaching note, keyed by workout type.
