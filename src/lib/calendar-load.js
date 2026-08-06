/* Try — what a calendar week actually cost.
 *
 * The week view used to price every row off the plan: a session you finished
 * showed the number it was forecast to cost, and work you did that was not in
 * the plan showed nothing at all. This prices the week the other way round —
 * from what happened, falling back to the forecast only where nothing was
 * recorded.
 *
 * WHY THIS DIVERGES FROM PROGRESS. The load bars refuse recorded load on
 * purpose (ProgressView): a SERIES has one currency, because its bars are
 * compared with each other across weeks as sync coverage shifts, and a bar
 * half-measured half-modelled is comparable neither bar-to-bar nor
 * week-to-week. A SNAPSHOT of one week has nothing to compare itself against
 * but itself, so it takes the best number available per session and labels
 * each one. Both rules are right; they answer different questions.
 *
 * ONE LEDGER, BUILT FROM THE RECORDING SIDE. Bricks claim their two legs
 * first, then every remaining recording is offered to the day's sessions
 * through ownerFor, one-to-one. Inverting that gives each session its
 * recording. The tempting shortcut — asking recordingFor whether a session
 * has a recording — is wrong here: it has no tick requirement, so an
 * UNTICKED session would take a recording's number while that same recording
 * still counted as unclaimed work. The week would bill you twice for one
 * ride.
 */
import { estimateTss } from './adapt.js';
import { brickPairFor, ownerFor, brickRecording, DISCIPLINE } from './autolog.js';
import { DISCIPLINES } from './disciplines.js';

// The exact guard the grid and the Recorded list already use: an activity
// with no mapped discipline or no moving time renders nowhere, so it must be
// in no total either, or the header would exceed the rows beneath it.
export const countable = a => !!(a && a.date && a.movingTimeSec && DISCIPLINES[DISCIPLINE[a.type]]);

// A recording's own load: measured where the provider sent one, else the same
// duration estimate an unrecorded session would get. That fallback is
// discipline-BLIND (no plan type, so DEFAULT_IF 0.7), which makes a load-less
// 60-minute swim and a load-less 60-minute ride both read 49. It is reached
// only by a feed activity carrying no trainingLoad — vanishingly rare against
// a real intervals.icu feed — and it wears the estimate marker.
export function loadOf(a) {
  if (!a) return { tss: 0, measured: false };
  if (a.trainingLoad != null) return { tss: a.trainingLoad, measured: !a.estimated };
  return { tss: estimateTss({ durationMin: Math.round((a.movingTimeSec || 0) / 60) }), measured: false };
}

/* One day's ledger. Returns each session with the recording that speaks for
   it (null when none does) and the recordings no session claimed.

   Ordering is load-bearing: the brick pass runs first and its legs leave the
   pool, or a ticked ride session on the same day could re-claim the ride half
   and the brick would be counted twice. */
export function dayLedger({ date, sessions, activities, log, moves }) {
  const acts = (activities || []).filter(a => countable(a) && a.date === date);
  const ws = sessions || [];
  const bySession = {};
  if (!acts.length) return { rows: ws.map(w => ({ w, recording: null })), unclaimed: [], claims: {}, pairs: {} };

  const claimed = new Set();
  const claims = {};
  const pairs = {};
  // manual entries can be neither leg of a brick nor a session's recording;
  // they only ever stand for themselves
  const feed = acts.filter(a => !a.manual);
  ws.filter(w => w.discipline === 'brick').forEach(w => {
    const pair = brickPairFor({ workout: w, activities: feed, moves, used: claimed });
    if (pair) {
      claimed.add(pair.ride.id); claimed.add(pair.run.id);
      bySession[w.id] = brickRecording(pair.ride, pair.run);
      pairs[w.id] = pair;
      claims[pair.ride.id] = w; claims[pair.run.id] = w;
    }
  });

  /* NATIVE sessions claim first. A session moved onto this day and a session
     always scheduled here are both candidates for a recording that happened
     here, and ownerFor breaks a duration tie by id — so a moved session could
     take the recording belonging to the one that never left, leaving the
     native session with an estimate and the moved session's own recording
     stranded on the day it was dragged from. Two tiers, native then arrived,
     and a week with no moves is unchanged because tier two is empty. */
  const used = new Set();
  const native = ws.filter(w => w.date === date);
  const arrived = ws.filter(w => w.date !== date);
  const offer = (a, pool) => {
    const owner = ownerFor({ activity: a, sessions: pool, log, used });
    if (!owner) return false;
    used.add(owner.id); bySession[owner.id] = a; claims[a.id] = owner;
    return true;
  };
  const pending = acts.filter(a => !claimed.has(a.id));
  const afterNative = pending.filter(a => !offer(a, native));
  const unclaimed = afterNative.filter(a => !offer(a, arrived));

  /* `claims` and `pairs` are the ledger's answer published for the surfaces
     that need to SAY who owns what, not just count it. The recorded list used
     to re-run brickPairFor and ownerFor itself, which is two implementations
     of one question: whichever drifted, a row would tag itself Matched while
     the total counted it as its own work, or the reverse. One pass, one
     answer, three consumers (week rows, month dots, recorded rows). */
  return {
    rows: ws.map(w => ({ w, recording: bySession[w.id] || null })),
    unclaimed,
    claims,        // activityId → the workout that speaks for it
    pairs,         // workoutId → { ride, run }, the brick legs it folded
  };
}

/* One session's number. Measured when a recording speaks for it, otherwise
   the plan's estimate over whatever minutes are known.

   `shown` is the eased workout: the calendar applies its overlay by passing
   easedOf(w), the way the rows themselves are rendered, so the estimate can
   never disagree with the row above it. Do NOT also pass adj — that is the
   week strip's route to the same place, and doing both squares the 0.65. */
export function sessionLoad({ shown, entry, recording }) {
  if (recording) {
    const { tss, measured } = loadOf(recording);
    return { tss, measured };
  }
  return { tss: estimateTss(shown, null, entry && entry.actualMin != null ? entry.actualMin : undefined), measured: false };
}

const minutesOf = a => Math.round((a.movingTimeSec || 0) / 60);

/* The week: every row's number, and the two totals under it.

   `planned` is the plan as it stands (eased overlay applied); `done` is what
   happened — a claimed session's recording, a ticked session's estimate, and
   every unclaimed recording. Done may exceed planned, and that is an ordinary
   week: extra work is the commonest way a week goes, so nothing here clamps
   it or treats it as an exception.

   The goal race contributes nothing to planned because its durationMin is a
   deliberate placeholder of 0 (WorkoutRow suppresses its duration for the
   same reason). It cannot be ticked either, so its recordings arrive as
   unclaimed work and count on the done side as themselves. That is the race
   counted honestly: real numbers on the day it happened, no forecast
   invented from a placeholder.

   Rounded per contribution, then summed, so the header is always the sum of
   the rows the athlete can see. */
/* PHASE B: a session that was MOVED off the day its recording sits on.

   The tick banks a recording's minutes at the time it is ticked, on the day
   the session then sat. Drag the completed session to another day to tidy the
   week and the two part company: per-day claiming leaves the recording
   unclaimed on its old day while the session, now recording-less, counts
   again through the very minutes that recording gave it. One ride, billed
   twice, and the moves overlay persists so it survives a reload.

   The tempting fix — offer every day's leftovers to every session in the week
   — loses to its own attack: with no date affinity in ownerFor, a Tuesday
   ride can claim a Thursday session whose own Thursday recording already
   speaks for it, and which of them wins depends on iteration order.

   So the second pass is keyed by BASE date. A day's leftovers are offered
   only to sessions scheduled on that day but effective elsewhere, still
   unclaimed after the first pass (their own day's recording won), and ticked
   with banked minutes (a hand-tick never claims across days). A session has
   exactly one base date, so no two days ever contend, and the outcome does
   not depend on the order the days are walked. */
function crossDayClaims({ dates, byDate, leftovers, log, moves, claimedBy }) {
  const out = {};
  const movedFrom = {};
  (dates || []).forEach(d => ((byDate && byDate[d]) || []).forEach(w => {
    const eff = (moves || {})[w.id] || w.date;
    const entry = (log || {})[w.id];
    if (eff !== w.date && !claimedBy[w.id] && entry && entry.done && entry.actualMin != null) {
      (movedFrom[w.date] = movedFrom[w.date] || []).push(w);
    }
  }));
  Object.keys(movedFrom).forEach(base => {
    const pool = leftovers[base] || [];
    if (!pool.length) return;
    const used = new Set();
    // bricks first, on the base date: an empty moves map IS "pair where it
    // was scheduled", which is exactly where the legs still sit
    movedFrom[base].filter(w => w.discipline === 'brick').forEach(w => {
      const pair = brickPairFor({ workout: w, activities: pool.filter(a => !a.manual), moves: {}, used });
      if (pair) {
        used.add(pair.ride.id); used.add(pair.run.id);
        out[w.id] = { recording: brickRecording(pair.ride, pair.run), claimed: [pair.ride.id, pair.run.id], pair, base };
      }
    });
    const singles = movedFrom[base].filter(w => w.discipline !== 'brick' && !out[w.id]);
    const taken = new Set();
    pool.filter(a => !used.has(a.id)).forEach(a => {
      const owner = ownerFor({ activity: a, sessions: singles, log, used: taken });
      if (owner) { taken.add(owner.id); used.add(a.id); out[owner.id] = { recording: a, claimed: [a.id], base }; }
    });
  });
  return out;
}

export function weekLoad({ dates, byDate, activities, log, moves, easedOf }) {
  const lg = log || {};
  const ease = easedOf || (w => w);
  const days = {};
  let doneMin = 0, plannedMin = 0, doneTss = 0, plannedTss = 0, estimated = false;

  // first pass, per day, exactly as before
  const ledgers = {};
  const leftovers = {};
  const claimedBy = {};
  (dates || []).forEach(date => {
    const led = dayLedger({ date, sessions: (byDate && byDate[date]) || [], activities, log: lg, moves });
    ledgers[date] = led;
    leftovers[date] = led.unclaimed;
    led.rows.forEach(r => { if (r.recording) claimedBy[r.w.id] = true; });
  });
  const cross = crossDayClaims({ dates, byDate, leftovers, log: lg, moves, claimedBy });
  const crossActs = new Set();
  Object.keys(cross).forEach(id => cross[id].claimed.forEach(a => crossActs.add(a)));

  (dates || []).forEach(date => {
    const sessions = (byDate && byDate[date]) || [];
    const led = ledgers[date];
    const rows = led.rows.map(r => (cross[r.w.id] ? { ...r, recording: cross[r.w.id].recording } : r));
    const unclaimed = led.unclaimed.filter(a => !crossActs.has(a.id));
    // the day's published claims gain the cross-day ones, so a recorded row
    // on the day it happened still knows a session elsewhere speaks for it
    Object.keys(cross).forEach(id => {
      const c = cross[id];
      if (c.base !== date) return;
      const w = (dates || []).flatMap(d => (byDate && byDate[d]) || []).find(x => x.id === id);
      c.claimed.forEach(a => { led.claims[a] = w; });
      if (c.pair) led.pairs[id] = c.pair;
    });
    const sessionRows = rows.map(({ w, recording }) => {
      const shown = ease(w);
      const entry = lg[w.id];
      const { tss, measured } = sessionLoad({ shown, entry, recording });
      const done = !!entry;
      plannedMin += shown.durationMin || 0;
      plannedTss += Math.round(estimateTss(shown));
      if (done) {
        doneMin += recording ? minutesOf(recording)
          : (entry.actualMin != null ? entry.actualMin : (shown.durationMin || 0));
        doneTss += Math.round(tss);
        if (!measured) estimated = true;
      }
      return { w, shown, recording, done, tss: Math.round(tss), measured };
    });
    const recordedRows = unclaimed.map(a => {
      const { tss, measured } = loadOf(a);
      doneMin += minutesOf(a);
      doneTss += Math.round(tss);
      if (!measured) estimated = true;
      return { activity: a, tss: Math.round(tss), measured };
    });
    // the ledger rides along so the recorded rows read the same claims the
    // totals were summed from, rather than deriving their own
    days[date] = { sessions: sessionRows, unclaimed: recordedRows, ledger: led };
  });

  return { days, doneMin, plannedMin, doneTss, plannedTss, estimated };
}
