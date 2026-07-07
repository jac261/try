/* Workouts-to-watch: turn the upcoming plan into the desired intervals.icu
   calendar for a rolling window. The backend endpoint (PUT /api/integrations/
   intervals-icu/planned-events) reconciles the athlete's calendar to this list,
   and intervals.icu pushes planned workouts on to a linked watch platform
   (Garmin etc.), so the plan — adaptive-engine adjustments included — reaches
   the wrist.

   v2: runs and rides go up as STRUCTURED workouts in the intervals.icu DSL
   (probed live 2026-07-08): step lines are `- 9m Z4`, repeats are `4x` on its
   own line followed by a blank-line-separated block, `Warmup`/`Cooldown`
   header lines set the Garmin step types, and run/swim zones need the
   ` Pace` suffix or intervals defaults them to POWER zones. Absolute paces
   (`4:35/km`) do not parse, so targets are zone-based — which the workout
   blocks already carry. `m` means MINUTES in the DSL (swim distances would
   need `0.4km`), so swims and bricks stay descriptive (`•` bullets, which the
   parser ignores) until a distance-step probe lands.

   intervals.icu recomputes an event's duration from parsed steps, and the
   backend reconciler treats a moving-time mismatch as drift (delete +
   recreate). Structured events therefore report the STEP TOTAL as their
   moving time, not the nominal session duration. */
import { iso, addDays } from './date.js';
import { effDate } from './schedule.js';

// discipline → intervals.icu sport type; bricks ride as their bike leg.
export const WATCH_TYPES = { run: 'Run', bike: 'Ride', swim: 'Swim', strength: 'WeightTraining', brick: 'Ride' };

// A rolling week is all the wrist needs: the next few sessions, always
// including tomorrow. Anything longer just churns events the engine may
// reshape anyway before they arrive.
export const WATCH_WINDOW_DAYS = 7;

const line = s => '• ' + [s.label, s.min ? s.min + 'm' : null, s.detail].filter(Boolean).join(' · ');

// Adjustment notes as plain sentences: inert free text in a structured doc,
// bulleted in a descriptive one.
function adjustmentNotes(w, bullet) {
  const p = bullet ? '• ' : '';
  const notes = [];
  if (w.eased) notes.push(p + 'Eased by the adaptive engine' + (w.easedFrom ? ' (was ' + String(w.easedFrom).replace(/\s+/g, ' ') + ')' : '') + (bullet ? '' : '.'));
  if (w.trimmed) notes.push(p + 'Trimmed by the adaptive engine' + (bullet ? '' : '.'));
  if (w.boosted) notes.push(p + 'Boosted by the adaptive engine' + (bullet ? '' : '.'));
  return notes;
}

// Human-readable session steps plus a note when the adaptive engine has
// reshaped the session, so the watch copy explains itself.
export function watchDescription(w) {
  return (w.segments || []).map(line).concat(adjustmentNotes(w, true)).join('\n') || null;
}

const durTok = min => {
  const s = Math.round(min * 60);
  return s % 60 === 0 ? (s / 60) + 'm' : s + 's';
};
// Bare zones are power zones; runs need the Pace suffix (verified by probe).
const zoneTok = (disc, zone) => (disc === 'bike' ? zone : zone + ' Pace');

// n repeats of an identical on/off pair → compress to the DSL repeat form.
function uniformReps(blocks) {
  if (blocks.length < 4 || blocks.length % 2 !== 0) return null;
  const [on, off] = blocks;
  for (let i = 0; i < blocks.length; i += 2) {
    if (blocks[i].min !== on.min || blocks[i].zone !== on.zone) return null;
    if (blocks[i + 1].min !== off.min || blocks[i + 1].zone !== off.zone) return null;
  }
  return { n: blocks.length / 2, on, off };
}

// Structured DSL for a run/ride whose segments all carry profile data.
// Returns { dsl, seconds } (seconds = step total, see header comment), or
// null → caller falls back to the descriptive form.
export function watchSteps(w) {
  if (w.discipline !== 'run' && w.discipline !== 'bike') return null;
  const segs = w.segments || [];
  if (!segs.length || !segs.every(s => (s.blocks && s.blocks.length) || (s.min && s.zone))) return null;
  const tok = b => '- ' + durTok(b.min) + ' ' + zoneTok(w.discipline, b.zone);
  const sections = [];
  let seconds = 0;
  segs.forEach((s, i) => {
    const blocks = s.blocks || [{ min: s.min, zone: s.zone }];
    blocks.forEach(b => { seconds += Math.round(b.min * 60); });
    const label = (s.label || '').toLowerCase();
    const header = i === 0 && label.includes('warm') ? 'Warmup'
      : i === segs.length - 1 && (label.includes('cool') || label.includes('ease home')) ? 'Cooldown'
        : null;
    const u = s.blocks && uniformReps(s.blocks);
    if (u) sections.push(u.n + 'x\n' + tok(u.on) + '\n' + tok(u.off));
    else sections.push((header ? header + '\n' : '') + blocks.map(tok).join('\n'));
  });
  return { dsl: sections.join('\n\n'), seconds };
}

// The desired calendar for [todayISO .. todayISO+days): one event per upcoming
// session at its effective (possibly moved) date, with adjusted volume via
// easedOf. Race-day entries and rest days are skipped; the backend deletes any
// previously pushed event that drops out of this list.
export function buildWatchEvents({ plan, moves, easedOf, todayISO, days = WATCH_WINDOW_DAYS }) {
  const newest = iso(addDays(todayISO, days - 1));
  const eased = easedOf || (w => w);
  const events = [];
  for (const w of ((plan && plan.weeks) || []).flatMap(week => week.workouts)) {
    const type = WATCH_TYPES[w.discipline];
    if (!type || w.race) continue;
    const d = effDate(w, moves || {});
    if (d < todayISO || d > newest) continue;
    const e = eased(w);
    if (!e.durationMin) continue;
    const steps = watchSteps(e);
    const notes = adjustmentNotes(e, false);
    events.push({
      ref: String(w.id),
      date: d,
      type,
      name: e.title || e.type || 'Session',
      description: steps
        ? steps.dsl + (notes.length ? '\n\n' + notes.join('\n') : '')
        : watchDescription(e),
      movingTimeSec: steps ? steps.seconds : Math.round(e.durationMin * 60),
    });
  }
  // Deterministic order so an unchanged plan serialises to an unchanged
  // payload (the app skips the push when the JSON hash matches).
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ref < b.ref ? -1 : 1));
  return { oldest: todayISO, newest, events: events.slice(0, 100) };
}
