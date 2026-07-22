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
export function WeeklyDigest({ plan, log, moves, adjust, adjustLog, wellness, activities, storage, todayISO, coachLog, blockReviewed, onBlockReviewed, onFocus }) {
  const [gone, setGone] = useState(false);
  const weekMonday = T.reviewedWeekMonday(todayISO, new Date().getHours());
  const seen = storage.load('digestSeenWeek', null);
  if (gone || seen === weekMonday || !T.digestWindowOpen(weekMonday, todayISO)) return null;
  const d = T.buildWeeklyDigest({ plan, log, moves, adjust, adjustLog, wellness, activities, todayISO, weekMonday });
  if (!d) return null;
  const dismiss = () => { storage.save('digestSeenWeek', weekMonday); setGone(true); };
  const fmtD = s => T.fmtDate(s, { month: 'short', day: 'numeric' });
  // The coach's call for the reviewed week: quoted from the frozen store or
  // absent. Never recomputed here; a recompute presented as the original
  // call would be a lie on a card whose whole job is the honest record
  // (design panel 2026-07-20).
  const stored = coachLog && coachLog[weekMonday];
  // Only the CURRENT plan's frozen decision is quotable: one from a replaced
  // plan is a record about a different reality (re-verify catch 2026-07-20).
  const coach = stored && (stored.planCreatedAt ?? null) === ((plan && plan.createdAt) || null) ? stored : null;
  // The block review: fires when this reviewed week closes a block (or on
  // the four-week cadence where no boundaries exist). One summary, one
  // optional one-tap question, never the spec's seven-question form.
  const solo = (T.RACES[plan && plan.race] || {}).solo || null;
  const fx = T.resolveFocus(plan && plan.profile, plan && plan.profile ? T.weakestLink({ profile: plan.profile }) : null, solo);
  const review = coach && blockReviewed !== weekMonday
    ? T.buildBlockReview({ plan, coachLog, weekMonday, focus: fx.focus, lastReviewedMonday: blockReviewed }) : null;
  const [reviewOpen, setReviewOpen] = useState(false);

  return (
    <>
      <div className="section-title">Your week <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>{fmtD(d.range.start)} to {fmtD(d.range.end)}</span></div>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {d.tracker ? 'No plan active' : (d.phase ? d.phase + ' phase · week ' + d.weekNo + ' of ' + d.totalWeeks : '')}
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

        {review && (
          <div className="coach-card block-review">
            <div className="coach-head"><span className="coach-pill">Block review</span>
              <b>{review.phase === 'Maintain' || !review.phase ? 'The last few weeks' : 'That ' + review.phase + ' block is done'}</b></div>
            <div className="coach-ev"><span className="coach-sig">the block</span>{review.summary}</div>
            {review.coverage && <div className="coach-ev conflicting"><span className="coach-sig">coverage</span>{review.coverage}</div>}
            {onBlockReviewed && !reviewOpen && (solo
              ? <div className="feel-row" style={{ marginTop: 8 }}>
                <button className="feelbtn" onClick={() => onBlockReviewed(weekMonday)}>Got it</button>
              </div>
              : <div className="feel-row" style={{ marginTop: 8 }}>
                <button className="feelbtn" onClick={() => onBlockReviewed(weekMonday)}>Keep the focus</button>
                <button className="feelbtn" onClick={() => setReviewOpen(true)}>Change it</button>
                <button className="feelbtn" onClick={() => onBlockReviewed(weekMonday)}>Not sure yet</button>
              </div>)}
            {reviewOpen && !solo && onFocus && <div className="feel-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              {Object.entries(T.FOCUS_OPTIONS)
                .filter(([k]) => k === 'general' || !(plan.profile && plan.profile.excludedDiscipline === k))
                .map(([k, lab]) => <button key={k} className="feelbtn" style={{ flex: '1 1 45%' }}
                  onClick={() => { onFocus(k === 'general' ? null : k); onBlockReviewed(weekMonday); }}>{k === 'general' ? 'Everything evenly' : 'Focus on ' + lab}</button>)}
            </div>}
          </div>
        )}
        {coach && (
          <div className="coach-card">
            <div className="coach-head">
              <span className={'coach-pill ' + coach.overall.decision}>{T.DECISION_LABELS[coach.overall.decision]}</span>
              <b>{coach.overall.headline}</b>
            </div>
            {coach.overall.evidence.map((e, n) => (
              <div className="coach-ev" key={n}><span className="coach-sig">{e.signal}</span>{e.reading}</div>
            ))}
            {coach.overall.conflicting.map((c, n) => (
              <div className="coach-ev conflicting" key={'c' + n}><span className="coach-sig">worth noting</span>{c}</div>
            ))}
            {coach.progression && !review && (
              <div className="coach-ev"><span className="coach-sig">next up</span>{'when the ' + coach.progression.discipline + ' stays clean: ' + coach.progression.what}</div>
            )}
          </div>
        )}

        {/* the ONE engine call quoted inside the decision card must not
            render again below it; identity is headline plus why, and only
            the first match is hidden, so an unrelated call reusing the same
            template headline still shows (re-verify catch 2026-07-20) */}
        {!d.tracker && (() => {
          const rows = d.engine.slice();
          if (coach && coach.quotedEngine) {
            const i = rows.findIndex(e => e.headline === coach.quotedEngine.headline && (e.why || null) === (coach.quotedEngine.why || null));
            if (i >= 0) rows.splice(i, 1);
          }
          return rows;
        })().map((e, n) => (
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
