import { useEffect, useMemo, useRef, useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { useSheetFocus } from '@/utils/useSheetFocus.js';
import { weekRange } from '@/lib/schedule.js';
import { Icon } from '@/components/Icon.jsx';
import { WorkoutProfile } from '@/components/WorkoutProfile.jsx';
import { InfoLink } from '@/components/InfoLink.jsx';
import { BikeExecution } from '@/components/BikeExecution.jsx';
import { BikeLongPlan, PositionTap } from '@/components/BikeLongPlan.jsx';

const D = T.DISCIPLINES;

const WHY = {
  'Easy': 'Build your aerobic base. Keep it conversational, easy enough to chat the whole way.',
  'Long': 'Build endurance for race day. Stay aerobic and relaxed, and practise your fuelling.',
  'Fartlek': 'Play with speed. Surge when it feels right, float in between - structure without the track.',
  'Tempo': 'Raise the pace you can hold for the long haul. Settle into a steady "comfortably hard" effort.',
  'Threshold': 'Lift your threshold, the effort you could just sustain for an hour. Strong and controlled, never all-out.',
  'VO2 Intervals': 'Sharpen your top-end fitness. Commit to the target pace on every rep, then recover fully.',
  'Endurance': 'Lay down aerobic base on the bike. Smooth, steady and mostly Zone 2.',
  'Sweet Spot': 'Big aerobic and threshold gains for the time spent. Sustained, just below threshold.',
  'Technique': 'Groove efficient form while fresh. Focus on a clean catch and a long, balanced body line.',
  'CSS Intervals': 'Build sustainable swim speed. Hold your CSS pace, smooth and controlled, not a sprint.',
  'Race Pace': 'Rehearse race effort so it feels familiar. Strong and relaxed at your goal pace.',
  'Brick': 'Teach your legs to run off the bike. Expect heaviness at first, and find your run rhythm quickly.',
  'Strength': 'Build durability and power to resist fatigue and injury. Quality over quantity: move well, brace your core.',
  'Open Water': 'Rehearse race-day swimming. Practise sighting, drafting and holding a straight line without walls to push off.',
};

// Some types exist in more than one sport; where the shared wording would name
// the wrong one, a discipline-specific entry wins (field report 2026-07-11: an
// Endurance Swim explained itself as a bike session).
const WHY_DISC = {
  'swim:Endurance': 'Build aerobic endurance in the water. Long, smooth and unhurried, holding relaxed form as the distance adds up.',
  // The shared 'Long' entry talks about fuelling, which is run/bike advice; a
  // pool session needs its own reason to exist.
  // Not "your biggest swim of the week": the other swim sessions can out-
  // distance it depending on level and race (gauntlet catch 2026-07-18).
  'swim:Long': 'Steady, patient distance work. An even rhythm from the first length to the last: the volume does the work when your form holds it together.',
};

export function DetailSheet({ w, plan, done, onClose, onToggle, eff, onMove, onResetMove, onLogResult, feel, onFeel, onRestore, onRemove, activity, onLoadIntervals, onSupport, onWhatIf, onReplayRecap, missedReason, onMissed, fuelLog, onFuel, positionLog, onPosition, brick, onCue, cueAnswer, onReview }) {
  // The rep table: lazily fetch the recording's interval analysis once the
  // session is done and matched. null → loading/none; [] handled by the lib.
  const [reps, setReps] = useState(null);
  // Settled = the lap question has an ANSWER (rows, or a definitive none).
  // The report effect below waits for it: reporting a repless bike or run
  // review while the fetch is in flight PUT a downgrade over stored
  // per-effort evidence on every reopen (gauntlet catch 2026-07-30).
  const [repsSettled, setRepsSettled] = useState(false);
  const actId = done && activity ? activity.id : null;
  useEffect(() => {
    if (!actId || !onLoadIntervals) { setRepsSettled(true); return undefined; }
    setRepsSettled(false);
    let gone = false;
    onLoadIntervals(actId).then(list => { if (!gone) { setReps(list); setRepsSettled(true); } })
      .catch(() => { if (!gone) setRepsSettled(true); });
    return () => { gone = true; };
  }, [actId, onLoadIntervals]);
  /* Phase 1 (2026-07-30): the reviews, computed once per input change rather
     than inline in the render, because they are now WRITTEN as well as
     shown. The same conditions the render always used; ad-hoc exclusion
     lives inside computeReviews. */
  const reviews = useMemo(() => (done && activity
    ? T.computeReviews({ workout: w, activity, intervals: reps, paces: plan.paces, profile: plan.profile, feel })
    : {}), [done, activity, w, reps, plan, feel]);
  /* Report the computed reviews upward for persistence, once the lap fetch
     has settled — a mid-flight report would be a repless review racing its
     own upgrade. The sheet only ever REPORTS — the app's handler diffs
     against the stored copy and refuses downgrades, so reopening is free.
     onReview rides a ref, not the effect deps: the handler is recreated on
     every App render and a deps entry would re-fire this (and re-diff)
     per render for as long as the sheet is open. */
  const onReviewRef = useRef(onReview);
  useEffect(() => { onReviewRef.current = onReview; });
  useEffect(() => {
    if (!onReviewRef.current || !repsSettled) return;
    if (reviews.swimReview || reviews.bikeReview || reviews.runReview) onReviewRef.current(w.id, reviews);
  }, [repsSettled, reviews, w.id]);
  const disc = D[w.discipline];
  /* §1/§3: does a run follow this ride? A brick session is one by definition,
     and that is the only way it happens — the generator never schedules a
     separate run on the same date as a ride, so the "look for a run today"
     clause this used to carry was dead in every plan ever built. */
  const brickFollows = w.discipline === 'brick';
  const why = !w.race && !w.test ? (WHY_DISC[w.discipline + ':' + w.type] || WHY[w.type]) : null;
  const shown = eff || w.date;
  const moved = shown !== w.date;
  const days = weekRange(w.date);
  const sheetRef = useSheetFocus(onClose);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label={w.title} onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="hero">
          <div className="dot" style={{ background: disc.grad }}><Icon name={disc.icon} size={26} /></div>
          <div><h2>{w.title}</h2><div className="s">{T.fmtDate(shown, { weekday: 'long', month: 'long', day: 'numeric' })} · {w.phase} phase</div></div>
        </div>
        {/* The one thing a finished session asks of the athlete comes first,
            not buried under the workout structure (Jon, 2026-07-15). */}
        {/* Both margins inline: .feel only sets margin-top in the stylesheet
            (its old home borrowed its bottom gap from the review section's
            title), and the eased/trimmed/boosted notes below carry no top
            margin of their own. */}
        {/* A past session that did not happen gets the one-tap "what
            happened?" chips. The answer is the ONLY way a miss is ever
            attributed (wellness never infers it), it feeds the weekly
            decision, and answering is always optional. */}
        {!done && !w.race && !w.test && onMissed && shown < T.iso(new Date()) && <div className="feel" style={{ marginTop: 4, marginBottom: 14 }}>
          {/* A tune-up gets the conditional form: the app cannot always see
              whether a race happened (bricks and ambiguous days never
              auto-close), so it must not assert the miss it is asking about
              (gauntlet 2026-07-30). */}
          <div className="feel-q">{w.bRace ? 'If this race didn\'t happen, what got in the way?' : 'This one didn\'t happen. What got in the way?'}</div>
          <div className="feel-row missed">
            {Object.entries(T.MISSED_REASONS).map(([k, lab]) =>
              <button key={k} className={'feelbtn' + (missedReason === k ? ' on right' : '')}
                onClick={() => onMissed(w.id, missedReason === k ? null : k)}>{lab}</button>)}
          </div>
        </div>}
        {done && !w.race && onFeel && <div className="feel" style={{ marginTop: 4, marginBottom: 14 }}>
          <div className="feel-q">How did it feel?</div>
          <div className="feel-row">
            {[['easy', 'Easy'], ['right', 'Just right'], ['hard', 'Hard']].map(([k, lab]) =>
              <button key={k} className={'feelbtn' + (feel === k ? ' on ' + k : '')} onClick={() => onFeel(w.id, k)}>{lab}</button>)}
          </div>
          {/* Phase 5 (§5): one question after a technique session, and only
              a technique session. It makes no claim to have measured anyone's
              stroke, and it deliberately does NOT yet bias drill selection —
              that write would change generated plans (the phase 1 boundary).
              Live since 2026-07-30: the backend stores the answer and App
              passes onCue. */}
          {onCue && w.type === 'Technique' && (() => {
            const chosen = cueAnswer || null;
            return <>
              <div className="fuel-q">Which cue helped most today?</div>
              <div className="feel-row fuel cue" style={{ flexWrap: 'wrap' }}>
                {T.TECHNIQUE_FOCUS.concat([{ id: 'none', label: 'None of these' }]).map(f =>
                  <button key={f.id} className={'feelbtn' + (chosen === f.id ? ' on right' : '')}
                    onClick={() => onCue(w.id, chosen === f.id ? null : f.id)}>{f.label}</button>)}
              </div>
              <div className="fuel-cap">Your answer is kept with the session. It is your word on what helped, not a stroke analysis.</div>
            </>;
          })()}
          {/* Fuel, deliberately SUBORDINATE to feel (the one thing a finished
              session asks comes first): long sessions with a matched
              recording only, keyed by the recording, always optional. */}
          {onFuel && activity && (w.role === 'long' || w.discipline === 'brick') && (() => {
            // answered-state and save target resolve from the SAME activity
            // prop and the raw map, so an eased rebuild can never read one
            // recording and write another (gauntlet catch 2026-07-21)
            const fuel = fuelLog && fuelLog[activity.id] && fuelLog[activity.id].level;
            return <>
              <div className="fuel-q">Fuel on board?</div>
              <div className="feel-row fuel">
                {Object.entries(T.FUEL_LEVELS).map(([k, lab]) =>
                  <button key={k} className={'feelbtn' + (fuel === k ? ' on right' : '')}
                    onClick={() => onFuel(activity.id, fuel === k ? null : k, w.discipline)}>{lab}</button>)}
              </div>
              <div className="fuel-cap">{T.FUEL_CAPTION}</div>
              {(() => {
                // §3: the tap they just gave, measured against what the
                // session actually asked for. Silent until they answer.
                // The run judges its taps against its own lower gut numbers
                // (audit wiring 2026-07-30); rides and bricks keep the bike's.
                const fp = w.discipline === 'run'
                  ? T.runFuellingPlan({ workout: w, profile: plan.profile, fuelLog })
                  : T.bikeFuellingPlan({ workout: w, profile: plan.profile, fuelLog, brickFollows });
                const out = w.discipline === 'run'
                  ? T.runFuellingOutcome({ plan: fp, level: fuel })
                  : T.fuellingOutcome({ plan: fp, level: fuel });
                return out && out.text ? <div className="lead" style={{ margin: '6px 0 0', fontSize: 12 }}>{out.text}</div> : null;
              })()}
            </>;
          })()}
          <PositionTap w={w} activity={activity} positionLog={positionLog} onPosition={onPosition} />
          {/* §4: how the bike leg set the run up. The pattern is the only
              thing allowed to say somebody's pacing is wrong, so only the
              pattern speaks here. */}
          {brick && brick.pattern && (w.discipline === 'brick' || w.discipline === 'bike') && (
            <div className="testnote" style={{ marginTop: 8 }}>
              <Icon name="trend" size={18} /><span>{brick.pattern.text}</span>
            </div>
          )}
        </div>}
        {w.eased && <div className="testnote"><Icon name="heartrate" size={18} /><span>Eased from your planned {w.easedFrom} session for recovery. {onRestore && <a className="reset" {...tap(onRestore)}>Restore the hard session</a>}</span></div>}
        {w.trimmed && <div className="testnote"><Icon name="trend" size={18} /><span>Trimmed from {T.fmtDuration(w.trimmedFrom)} by the adaptive engine to protect you from overload. {onRestore && <a className="reset" {...tap(onRestore)}>Restore full volume</a>}</span></div>}
        {w.boosted && <div className="testnote"><Icon name="flame" size={18} /><span>Extended from {T.fmtDuration(w.boostedFrom)} because your form showed room to absorb more load. {onRestore && <a className="reset" {...tap(onRestore)}>Back to the planned volume</a>}</span></div>}
        {!w.race && <div className="statline">
          <div className="s"><b>{T.fmtDuration(w.durationMin || 0)}</b><span>Duration</span></div>
          {w.distance && <div className="s"><b>{w.distEst ? '~' : ''}{w.distance}</b><span>{w.unit}</span></div>}
          <div className="s"><b>{disc.name}</b><span>{w.type}</span></div>
        </div>}
        {/* Phase 4 §2: the tilde says the distance is estimated; this says
            what the estimate assumed, so it can be judged rather than
            trusted. Bike only, because it is the only modelled one. */}
        {(() => {
          const est = T.bikeDistanceEstimate(w, plan.paces);
          if (!est) return null;
          return <div className="lead" style={{ margin: '2px 0 0', fontSize: 12 }}>
            ~{est.distanceKm} km is modelled from this session's own mix ({est.assumptions.zoneMix}) at
            your current strength, not measured. Your actual distance depends on terrain, wind and who you ride with.
          </div>;
        })()}
        {why && <div className="why" style={{ borderColor: disc.color }}><span className="why-label">Why this session</span>{why}</div>}
        <div className="section-title" style={{ margin: '8px 0 2px' }}>{!w.race && !w.bRace && <InfoLink onOpen={onSupport} topic="workout-library" />}{w.race || w.bRace ? 'Race plan' : 'Workout'}</div>
        <WorkoutProfile w={w} />
        {/* Defensive: an ad-hoc session has no prescription to render, and a
            plan stored before a field existed can arrive thin. */}
        {(w.segments || []).map((s, i) => (
          <div className="seg" key={i}>
            <div className="bar" style={{ background: disc.color }} />
            <div><div className="l">{s.label}</div><div className="d">{s.detail}</div></div>
            {s.min ? <div className="m">{s.min} min</div> : null}
          </div>
        ))}
        {/* Phase 4 §5: the same card is a different session on a trainer and
            on a road, so it says which it was written for and what changes in
            the other place. The choice is local to this sheet on purpose —
            it changes the wording, never the session, so there is nothing
            about it worth persisting or syncing. */}
        <BikeExecution w={w} profile={plan.profile} />
        {/* Phase 6 §1/§3: what this long ride is for, and what to eat on it. */}
        <BikeLongPlan w={w} plan={plan} fuelLog={fuelLog} brickFollows={brickFollows} />
        {/* The run long's fuelling plan, on the bike's terms (audit wiring
            2026-07-30): what to take, when to start, and why the number is
            where it is. Renders nothing for a run short enough not to need
            fuel, so no card appears on a forty-minute easy run. */}
        {w.discipline === 'run' && !w.race && (() => {
          const fp = T.runFuellingPlan({ workout: w, profile: plan.profile, fuelLog });
          if (!fp) return null;
          return (
            <div className="testnote" style={{ marginTop: 8 }}>
              <Icon name="flame" size={18} />
              <span><b>{fp.carbPerHour} g of carbs an hour</b> ({fp.carbTotal} g total), starting inside the first {fp.startAfterMin} minutes, with {fp.fluidMlPerHour[0]}–{fp.fluidMlPerHour[1]} ml of fluid an hour. {fp.why}</span>
            </div>
          );
        })()}
        {!w.race && !w.bRace && onMove && <>
          <div className="section-title" style={{ margin: '18px 0 8px' }}>Reschedule
            {moved && <a className="reset" {...tap(() => onResetMove(w.id))}> ↺ reset</a>}</div>
          <div className="days">
            {days.map((d, i) => {
              const lab = ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i];
              return <div key={d} className={'d' + (d === shown ? ' on' : '')}
                aria-label={'Move to ' + T.fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' }) + (d === shown ? ' (current day)' : '')}
                {...tap(() => onMove(w.id, d))}>
                <div style={{ fontSize: 10, fontWeight: 600, opacity: .7 }}>{lab}</div>
                {Number(d.slice(8))}</div>;
            })}
          </div>
        </>}
        <div style={{ height: 16 }} />
        {w.test && w.note && <div className="testnote"><Icon name="stopwatch" size={18} /><span>{w.note}</span></div>}
        {/* Phase 6: the safety wording rides every open-water session, and the
            pool equivalent is always on the card — the athlete swaps the
            water, not the session, so nothing has to be stored for it and
            there is never a reason to skip. */}
        {w.safety && <div className="testnote"><Icon name="heartrate" size={18} /><span>{w.safety}</span></div>}
        {(() => {
          const fb = T.poolFallback(w);
          if (!fb || !fb.lines.length) return null;
          return (
            <div className="testnote" style={{ display: 'block' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{fb.title}</div>
              <div className="lead" style={{ margin: '0 0 6px' }}>{fb.lead}</div>
              {fb.lines.map((l, i) => <div key={i} className="lead" style={{ margin: '0 0 2px' }}>{l}</div>)}
            </div>
          );
        })()}
        {w.test && onLogResult && <><button className="btn primary" onClick={onLogResult}><Icon name="trend" size={18} /> Log result &amp; re-target</button><div style={{ height: 10 }} /></>}
        {/* An ad-hoc session is synthesised FROM a recording: it already
            happened, and it occupies no plan slot to complete. Offering the
            toggle would write a log entry against a workout id that no plan
            contains. */}
        {!w.race && !w.adhoc && <button className={'btn ' + (done ? 'done' : (w.test ? 'ghost' : 'primary'))} onClick={onToggle}>
          {done ? '✓ Completed — tap to undo' : 'Mark as complete'}</button>}
        {/* the what-if doorway every design judge asked for: meet the athlete
            at the moment of doubt, pre-filled with this exact session */}
        {onWhatIf && !done && !w.race && !w.bRace && !w.test && shown >= T.iso(new Date()) && <a className="wi-link" {...tap(() => onWhatIf(w))} role="button">What if I skip this?</a>}
        {done && activity && (() => {
          // Post-session review: the recording's numbers next to the plan's
          // intent, with verdicts only where an average can judge fairly.
          // Phase 4: the per-rep coaching read for swims, computed from the
          // same laps the rep table shows. reviewActivity takes it and
          // speaks with one voice — no average verdict beside a per-rep one.
          // Computed in the reviews memo above (they persist now, so the
          // computation is shared with the report-upward effect). Run is
          // built from the SAME intervalRows the splits table below renders,
          // so the two cannot disagree (audit catch 2026-07-30).
          const rv = T.reviewActivity({ workout: w, activity, paces: plan.paces, log: null,
            swimReview: reviews.swimReview || null, bikeReview: reviews.bikeReview || null, runReview: reviews.runReview || null });
          if (!rv) return null;
          return (
            <div className="review">
              <div className="section-title" style={{ margin: '14px 0 6px' }}>How it went
                {/* the deck only auto-plays once per recording; this is the way back in */}
                {onReplayRecap && <a className="reset" {...tap(onReplayRecap)} role="button"
                  aria-label="Replay the recap slides" style={{ marginLeft: 8 }}>▶ Replay recap</a>}</div>
              <div className="rd-pmc" style={{ marginTop: 0, flexWrap: 'wrap' }}>
                {rv.stats.slice(0, 4).map(([k, v]) => <div key={k}><b style={{ fontSize: 15 }}>{v}</b><span>{k}</span></div>)}
              </div>
              {rv.verdicts.map((v, i) => (
                <div className="testnote" key={i} style={{ marginTop: 8 }}>
                  <Icon name={v.tone === 'good' ? 'trophy' : v.tone === 'warn' ? 'heartrate' : 'trend'} size={18} />
                  <span>{v.text}</span>
                </div>
              ))}
              {(() => {
                // Rep-by-rep (or km splits): honest per-interval numbers, with
                // verdict dots only where the session type defines a target.
                const it = T.intervalRows({ workout: w, intervals: reps, paces: plan.paces, activity });
                if (!it) return null;
                const toneCol = { good: 'var(--run)', warn: '#f6b27a', info: 'var(--muted)' };
                return (
                  <div className="rep-table">
                    <div className="rd-trend-head" style={{ marginTop: 12 }}><span>{it.judged ? 'Reps' : 'Splits'}</span><span>{it.summary}</span></div>
                    {/* §7: said only when the allowance actually changed a
                        verdict, so it explains rather than disclaims. */}
                    {it.note && <div className="lead" style={{ margin: '4px 0 0', fontSize: 12 }}>{it.note}</div>}
                    {it.rows.map(r => (
                      <div className="seg" key={r.n} style={{ padding: '5px 0' }}>
                        <div className="bar" style={{ background: r.tone ? toneCol[r.tone] : 'var(--chip)' }} />
                        <div><div className="l">{(r.label || '#' + r.n)}</div>
                          <div className="d">
                            {T.fmtDuration(Math.round(r.timeSec / 60) || 1)}
                            {r.distance ? ' · ' + (r.distance / 1000).toFixed(2) + ' km' : ''}
                            {r.paceSec ? ' · ' + (w.discipline === 'swim' ? T.swimPaceLabel(r.paceSec, (plan.paces && plan.paces.pool) || T.DEFAULT_POOL) : T.fmtPace(r.paceSec) + ' /km') : ''}
                            {r.watts != null ? ' · ' + r.watts + ' W' : ''}
                            {r.hr != null ? ' · ' + r.hr + ' bpm' : ''}
                          </div></div>
                        {r.tone && <div className="m">{r.tone === 'good' ? 'on target' : r.tone === 'warn' ? 'hot' : 'under'}</div>}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {(() => {
                /* Swim phase 8's stroke metrics, behind their flag. The gate
                   function shipped with ZERO callers, so even with the flag
                   on and the backend fields present nothing would ever have
                   rendered — a gate with no door, the same class as the bike
                   load model and the brick engine before their audits. The
                   flag is off and the fields are absent, so this renders
                   nothing today; the day both change is a flip, not a build. */
                if (w.discipline !== 'swim' || !reps) return null;
                if (!T.strokeMetricsEnabled({ activity, laps: reps, enabled: T.STROKE_METRICS_FLAG })) return null;
                const ss = T.strokeSessionSummary({ activity, laps: reps, poolLengthM: plan.paces && plan.paces.pool ? T.poolLengthM(plan.paces.pool) : undefined });
                if (!ss || !ss.summary) return null;
                return <div className="lead" style={{ margin: '6px 0 0', fontSize: 12 }}>{ss.summary}</div>;
              })()}
            </div>
          );
        })()}
        {activity && <a className="act-link" href={T.activityUrl(activity)} target="_blank" rel="noopener noreferrer">
          <Icon name="watch" size={15} /> See the full recording{activity.name ? ' · ' + activity.name : ''} ↗</a>}
        {/* Future-tense encouragement ends with race day — opened from the
            calendar a week later, "You've got this" reads as a glitch — and
            ends the moment a tune-up is ticked done, or the same sheet would
            ask "How did it feel?" above it (gauntlet catch 2026-07-30). The
            A race can never be done, so for it the gate is date-only. */}
        {(w.race || w.bRace) && !done && shown >= T.iso(new Date()) && <div className="card center" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)', margin: 0 }}><b style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Icon name="trophy" size={18} /> You've got this.</b></div>}
        {w.custom && onRemove && <>
          <div style={{ height: 10 }} />
          <button className="btn ghost remove" onClick={onRemove}>Remove this session</button>
        </>}
      </div>
    </div>
  );
}

