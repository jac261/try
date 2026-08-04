import { useState } from 'react';
import * as T from '@/lib';
import { INTENSITY_TYPES } from '@/lib/tuning.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { Signed } from '@/components/Signed.jsx';
import { InfoLink } from '@/components/InfoLink.jsx';

// The card answers the morning question and shows its receipts: the score, the
// signals behind it, today's coaching, and the three load numbers. It carries
// no charts. The "Details" fold that used to hold four of them came out on
// 2026-08-04 — Fitness & Fatigue, Form and Ramp rate were already in Progress,
// and the readiness trend moved there to join them (Jon), which is where a
// fourteen-day line belongs rather than folded into a daily verdict.
/* Phase 2 stray fix: these two keys were browser-global (bare try.*) —
   shared across every account on one device, the exact cross-account leak
   the TodayView dismissals were already migrated away from; a proposal
   dismissed by one athlete was silenced for the next. Same pattern as
   TodayView's DISMISS_NS: per-user namespace set from the storage prop
   before any lazy initialiser runs, reads fall back to the legacy global
   key once so existing choices are honoured, writes go per-user only. */
let CARD_NS = 'try.';
const cGet = name => {
  try { return localStorage.getItem(CARD_NS + name) ?? localStorage.getItem('try.' + name); }
  catch (e) { return null; }
};
const cSet = (name, v) => { try { localStorage.setItem(CARD_NS + name, v); } catch (e) { /* private mode */ } };
// A rejected proposal stays rejected: the signature is kind + band + workout
// + day, so "Not today" holds for the rest of the day but a new day (or a
// different proposal) speaks again.
const loadPropDismiss = () => cGet('todayProposalDismissed');
const savePropDismiss = v => cSet('todayProposalDismissed', v);

const BAND_COLOR = { green: 'var(--run)', amber: 'var(--bike)', red: 'var(--danger)' };
// the disc's glow: the band colour at low alpha, opaque per the kit's rule 4
const GLOW = { green: 'rgba(52,211,153,.25)', amber: 'rgba(251,146,60,.25)', red: 'rgba(248,113,113,.25)' };

// The morning check-in: one tap, three answers, skippable, gone once answered.
// The answer scores immediately (the "How you feel" factor) and becomes the
// clean daily label the calibration observations have been missing.
function FeelCheckin({ onFeel }) {
  return (
    <div className="rd-checkin">
      <span className="ck-q">How do you feel?</span>
      <div className="ck-opts">
        {[['fresh', 'Fresh'], ['okay', 'Okay'], ['rough', 'Rough']].map(([v, label]) => (
          <button key={v} className="btn ghost sm" onClick={() => onFeel(v)}>{label}</button>
        ))}
        <a className="reset ck-skip" {...tap(() => onFeel('skip'))} role="button" aria-label="Skip today's check-in">skip</a>
      </div>
    </div>
  );
}

/* Card 1f's score disc: the number pressed into the pane, lit from the
   top-left, with the band's own colour glowing out of it. It replaces the
   progress ring, which encoded the score as an arc as well as a figure — the
   arc is the thing lost in this trade, and it is worth a look in review. */
function ScoreDisc({ score, band }) {
  return (
    <div className="rd-disc" style={{ '--rd-glow': GLOW[band], color: BAND_COLOR[band] }}>{score}</div>
  );
}

/* The receipts: each morning signal against its own baseline. Scored signals
   read as evidence; the rest are real deviations the model gave no credit for
   (sleep above 7h, resting HR below baseline) and render hollow so they cannot
   be mistaken for evidence. See wellness.readinessSignals. */
function SignalBars({ signals }) {
  if (!signals.length) return null;
  return (
    <div className="rd-signals">
      <div className="rd-signals-head"><span>WORSE</span><span>BASELINE</span><span>BETTER</span></div>
      {signals.map(sig => {
        const pct = Math.abs(sig.pos) * 50;
        const better = sig.pos >= 0;
        return (
          <div className="rd-sig" key={sig.key}>
            <div className="rd-sig-label">{sig.label}</div>
            <div className="rd-sig-track">
              <div className="rd-sig-tick" />
              <div className={'rd-sig-fill' + (sig.scored ? '' : ' ghost')}
                style={{
                  [better ? 'left' : 'right']: '50%',
                  width: pct + '%',
                  background: better
                    ? 'linear-gradient(90deg, rgba(52,211,153,.5), var(--run))'
                    : 'linear-gradient(270deg, rgba(251,146,60,.5), var(--bike))',
                }}
                aria-hidden="true" />
            </div>
            <div className="rd-sig-val">{sig.text}</div>
          </div>
        );
      })}
    </div>
  );
}

export function ReadinessCard({ wellness, today, onEdit, onFeel, onEase, onRestore, onOpen , onSupport, noPlan, storage, onDecision }) {
  if (storage && storage.ns) CARD_NS = storage.ns;
  // Declared with the other hooks, ABOVE the !rec early return: a hook below
  // it changes the mounted instance's hook count the moment the first
  // readiness entry lands (the splash-hold crash class, 2026-07-15).
  const [propDismissed, setPropDismissed] = useState(loadPropDismiss);
  const todayISO = T.iso(new Date());
  const rec = wellness.find(r => r.date === todayISO) || (wellness.length ? wellness[wellness.length - 1] : null);
  if (!rec) {
    // No data at all yet: the check-in still works (it becomes the day's only
    // signal — the sensor-less path), alongside the manual-entry prompt.
    return (
      <>
        {onFeel && <div className="card rd">{<FeelCheckin onFeel={onFeel} />}</div>}
        <div className="banner rd-empty" {...tap(onEdit)}>
          <div className="bi"><Icon name="heartrate" size={20} /></div>
          <div><div className="bt">Add your morning readiness</div>
            <div className="bs">Log HRV, sleep &amp; resting HR for a daily go / ease / recover call →</div></div>
        </div>
      </>
    );
  }
  const base = T.wellness.baseline(wellness, todayISO);
  const rd = T.wellness.readiness(rec, base);
  const eased = today.find(w => w.eased);
  const hard = today.find(w => INTENSITY_TYPES[w.type]);
  const sessTitle = (hard || eased || today.find(w => w.discipline !== 'rest') || {}).title;
  // No workouts today: a rest day inside a plan still reads as "rest day", but
  // with no plan at all (tracker mode) pass null so advice speaks only about
  // the body, not a session that does not exist.
  const adv = T.wellness.advice(rd.band, !!hard, today.length ? (sessTitle || 'rest day') : (noPlan ? null : 'rest day'));
  const stale = rec.date !== todayISO;
  const rawProposal = stale ? null : T.proposeToday({ band: rd.band, score: rd.score, todays: today });
  // The band is part of the signature: rejecting an amber ease must not
  // silence the red-band escalation of the same session later the same day.
  const propSig = rawProposal
    ? rawProposal.kind + ':' + rd.band + ':' + (rawProposal.workout ? rawProposal.workout.id : '') + ':' + todayISO : null;
  const proposal = rawProposal && propDismissed !== propSig ? rawProposal : null;
  const rejectProposal = () => {
    savePropDismiss(propSig); setPropDismissed(propSig);
    if (onDecision && rawProposal) onDecision(T.fromTodayProposal(rawProposal), 'rejected');
  };

  // Training-load signals feed the coach line, the summary numbers and the
  // auto-expand rule, so they're computed up front (all null-safe on thin data).
  const load = wellness.filter(r => r.ctl != null && r.atl != null).slice(-60);
  const hasLoad = load.length >= 3;
  const tsbSeries = load.map(r => (r.tsb != null ? r.tsb : r.ctl - r.atl));
  const lastLoad = hasLoad ? load[load.length - 1] : null;
  const tsbNow = hasLoad ? tsbSeries[tsbSeries.length - 1] : null;
  const zone = T.wellness.formZone(tsbNow);
  const ramp = hasLoad ? T.wellness.rampRate(wellness) : null;
  const coach = hasLoad ? T.wellness.coachLine(tsbNow, ramp) : null;

  return (
    <div className={'card rd rd-glass rd-' + rd.band}>
      <div className="rd-top">
        <ScoreDisc score={rd.score} band={rd.band} />
        <div className="rd-main">
          {/* The explainer link used to live in the fold's trend header. The
              fold is gone and the charts moved to Progress, but the route from
              the score to what the score MEANS should not need a trip to
              another tab, so it moves up here. */}
          <div className="rd-headline">{rd.headline} <InfoLink onOpen={onSupport} topic="readiness" /></div>
          <div className="rd-advice">{adv}</div>
        </div>
      </div>
      {/* Card 1f: the score's receipts, always visible. They were two taps
          deep before (Details, then Why?), which is what 1f is arguing
          against — a number nobody can check. */}
      <SignalBars signals={T.wellness.readinessSignals(rec, T.wellness.baseline(wellness, rec.date))} />
      {onFeel && !(rec.date === todayISO && rec.feel) && <FeelCheckin onFeel={onFeel} />}
      {/* The adaptive engine (Phase 1): at most one reasoned proposal for today,
          from this morning's band — rules & thresholds in docs/ADAPTIVE_ENGINE.md.
          Stale wellness data never drives a change (yesterday's read isn't advice). */}
      {proposal ? (() => {
        const acceptRaw = proposal.action === 'easeToday' ? onEase
          : proposal.action === 'restoreToday' ? onRestore
          : () => onOpen && onOpen(proposal.workout);
        const accept = () => {
          /* ease/restore actuate on the tap, so accepting IS the decision.
             move-test only OPENS the sheet — the reschedule is a separate
             manual act the athlete may never take (the documented actuator
             gap) — so journalling 'accepted' there recorded a change that
             never happened, and the still-visible card could then append a
             rejection minutes later: accepted-then-dismissed for one
             decision (gauntlet catch). It journals nothing. */
          if (onDecision && proposal.kind !== 'move-test') onDecision(T.fromTodayProposal(proposal), 'accepted');
          acceptRaw();
        };
        return (
          <div className="rd-proposal">
            <div className="ph"><Icon name={proposal.kind === 'restore' ? 'bolt' : proposal.kind === 'move-test' ? 'calendar' : 'rest'} size={16} /> {proposal.headline}</div>
            <div className="pw">{proposal.why}</div>
            <div className="rd-actions">
              <button className="btn ghost sm rd-action" onClick={accept}>
                {proposal.kind === 'move-test' ? 'Open & reschedule' : proposal.kind === 'restore' ? 'Restore the session' : 'Accept the swap'}
              </button>
              {/* the reject: the card must not persist all day once the
                  athlete has decided against it (Jon, 2026-07-16) */}
              <a className="reset rd-reject" {...tap(rejectProposal)} role="button"
                aria-label="Dismiss this suggestion for today">Not today</a>
            </div>
          </div>
        );
      })() : eased ? (
        <div className="rd-eased"><Icon name="rest" size={15} /> Today eased to {eased.title} for recovery · <a className="reset" {...tap(onRestore)}>undo</a></div>
      ) : null}
      {/* The coach line synthesises the multi-week load trend, so it only speaks
          when the engine has nothing more specific to say for today — otherwise
          "room to push" stacks under a recovery ease and reads as a contradiction. */}
      {coach && !proposal && !eased && <div className="rd-coach">{coach}</div>}
      {/* The doc's load row, permanent. It replaces the "Details" fold whose
          four charts all live in Progress now (Jon, 2026-08-04) — but the
          fold's toggle row carried these three numbers as inline chips, so
          they land here as the doc's pressed tiles rather than disappearing
          with it. */}
      {hasLoad && (
        <div className="rd-pmc">
          <div><b>{Math.round(lastLoad.ctl)}</b><span>Fitness</span></div>
          <div><b>{Math.round(lastLoad.atl)}</b><span>Fatigue</span></div>
          {/* The grey zone means "nothing notable", so it keeps the plain ink:
              its colour measured 3.99:1 on the pressed tile, which is paying
              legibility to signal nothing. Coloured here means worth a look. */}
          <div><b style={{ color: zone && zone.key !== 'grey' ? zone.color : undefined }}><Signed v={tsbNow} /></b><span>Form</span></div>
        </div>
      )}
      <div className="rd-foot">
        <span>{stale ? 'From ' + T.fmtDate(rec.date, { month: 'short', day: 'numeric' }) : 'This morning'}</span>
        <a className="reset" {...tap(onEdit)}>Update →</a>
      </div>
    </div>
  );
}
