import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';

/* The Sunday-evening wrap: one sober card on Today reviewing the week that
 * just finished. Deliberately NOT the recap deck's spectacle — a weekly
 * aggregate is coarser and partly estimated, and dressing it in count-ups
 * would manufacture precision the data doesn't carry (design panel,
 * 2026-07-15). Shows from Sunday evening through Wednesday, then lapses on
 * its own; dismiss hides this week's for good. Content is recomputed live —
 * only the seen flag persists. */
export function WeeklyDigest({ plan, log, moves, adjust, adjustLog, wellness, activities, storage, todayISO }) {
  const [gone, setGone] = useState(false);
  const weekMonday = T.reviewedWeekMonday(todayISO, new Date().getHours());
  const seen = storage.load('digestSeenWeek', null);
  if (gone || seen === weekMonday || !T.digestWindowOpen(weekMonday, todayISO)) return null;
  const d = T.buildWeeklyDigest({ plan, log, moves, adjust, adjustLog, wellness, activities, todayISO, weekMonday });
  if (!d) return null;
  const dismiss = () => { storage.save('digestSeenWeek', weekMonday); setGone(true); };
  const fmtD = s => T.fmtDate(s, { month: 'short', day: 'numeric' });

  return (
    <>
      <div className="section-title">Your week <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>{fmtD(d.range.start)} to {fmtD(d.range.end)}</span></div>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {d.tracker ? 'Tracker mode' : (d.phase ? d.phase + ' phase · week ' + d.weekNo + ' of ' + d.totalWeeks : '')}
          </div>
          <div className="spacer" />
          <a className="reset" {...tap(dismiss)} role="button" aria-label="Dismiss this week's digest">Dismiss</a>
        </div>

        <div className="rd-pmc" style={{ marginTop: 0 }}>
          <div><b>{d.tracker ? d.done : d.done + ' of ' + d.planned}</b><span>{d.tracker ? (d.done === 1 ? 'session logged' : 'sessions logged') : 'sessions done'}</span></div>
          <div><b>{T.fmtDuration(d.totalMin)}</b><span>trained</span></div>
          {/* the tilde is mandatory on plan-mode load: it is an estimate and
              must never read as a measurement */}
          {d.load != null && <div><b>{d.loadEstimated ? '~' : ''}{d.load}</b><span>load banked</span></div>}
        </div>

        {d.fitness && (d.fitness.word || d.fitness.formWord) && (
          <div className="muted" style={{ fontSize: 12.5, margin: '10px 2px 0' }}>
            {d.fitness.word && <>Fitness: {d.fitness.word} ({d.fitness.delta > 0 ? '+' : ''}{d.fitness.delta})</>}
            {d.fitness.word && d.fitness.formWord && ' · '}
            {d.fitness.formWord && <>Form: {d.fitness.formWord}</>}
          </div>
        )}

        {d.raceDone && d.raceDone.length > 0 && d.raceDone.map((r, n) => (
          <div className="testnote" key={'race' + n} style={{ marginTop: 10 }}>
            <Icon name="trophy" size={18} /><span>Race day: {r}. Done.</span>
          </div>
        ))}

        {!d.tracker && d.engine.map((e, n) => (
          <div className="testnote" key={n} style={{ marginTop: 10 }}>
            <Icon name="heartrate" size={18} />
            <span><b>{e.headline}</b>{e.why ? '. ' + e.why : ''}</span>
          </div>
        ))}
        {/* only a week that was actually trained earns this line: with zero
            sessions done it would sit above the "didn't happen" list and
            contradict it (gauntlet finding) */}
        {!d.tracker && !d.engine.length && d.done > 0 && (
          <div className="muted" style={{ fontSize: 12.5, margin: '10px 2px 0' }}>
            Nothing needed adjusting. You trained the week as written.
          </div>
        )}

        {d.missed.length > 0 && (
          <div className="muted" style={{ fontSize: 12.5, margin: '8px 2px 0' }}>
            Didn't happen: {d.missed.map(m => m.title + ' (' + T.fmtDate(m.day, { weekday: 'short' }) + ')').join(', ')}
          </div>
        )}

        {d.ahead && (
          <div className="tmrw" style={{ marginTop: 12, cursor: "default", userSelect: "auto" }}>
            <Icon name="calendar" size={15} />
            <span>Week ahead · {d.ahead.phase ? d.ahead.phase + ': ' : ''}<b>{d.ahead.sessions} sessions</b> · {T.fmtDuration(d.ahead.totalMin)}
              {d.ahead.keys.length > 0 && <> · {d.ahead.keys.join(', ')}</>}
              {d.ahead.adjusted && <> · already adjusted</>}</span>
          </div>
        )}
      </div>
    </>
  );
}
