/* Try — the season, as one curve.
 *
 * The calendar's month and week ranges answer "what am I doing". This answers
 * "am I on the ramp": the whole plan as weekly fitness, solid where it has
 * happened and dashed where it is still a plan, with the blocks it belongs to
 * and the dates between here and the race.
 *
 * TWO HALVES, TWO SOURCES.
 *
 * Behind today the numbers already exist: App merges the wellness feed with
 * withLogLoad, which fills in a plan-derived series whenever the feed has
 * nothing fresh. This reads that and never recomputes it — a chart inventing
 * its own history beside the one the rest of the app shows is the surest way
 * to make two screens disagree.
 *
 * Ahead of today it walks the standard impulse response
 *   CTL' = CTL + (TSS − CTL)/42,  ATL' = ATL + (TSS − ATL)/7
 * over the planned sessions on their effective dates, with the adjustment
 * overlay applied — the same accounting projectRaceForm uses, deliberately.
 *
 * WHY THIS DOES NOT CALL projectRaceForm, having looked:
 *
 * 1. That function feeds proposeRace, which is a coach-brain actuator that
 *    reaches the athlete as a taper proposal, and it carries one direct test.
 *    Refactoring an engine path that thin to serve a chart is the wrong risk.
 * 2. The preconditions genuinely differ. projectRaceForm returns null on stale
 *    sensors, because a proposal off dead sensors is worse than no proposal. A
 *    chart has no such duty: its past half is already the derived series when
 *    the feed is quiet, and it projects from wherever that ends. It also has
 *    to draw for a maintenance block, which has no race at all.
 *
 * So the recurrence is written once here and season.test.js asserts the two
 * agree on race-morning TSB for identical inputs. That is the anti-drift
 * guarantee loadmodel.js asks for, without editing the engine to get it.
 */
import { iso, addDays, daysBetween, startOfWeekMonday } from './date.js';
import { estimateTss } from './adapt.js';
import { phaseGroups } from './plan.js';

const round1 = x => Math.round(x * 10) / 10;

/* One day of the recurrence. Exported so the anti-drift test can drive it
   directly rather than through the whole curve. */
export function stepLoad({ ctl, atl }, tss) {
  return { ctl: ctl + (tss - ctl) / 42, atl: atl + (tss - atl) / 7 };
}

/* The season as weekly points, plus what has to be drawn on top of them.
 *
 * Returns null when there is no plan to chart — tracker mode, where
 * plan.weeks is [], is the case that matters.
 */
export function seasonCurve({ plan, wellness, log, moves, adjust, todayISO }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const today = todayISO || iso(new Date());
  const weeks = plan.weeks;
  const firstDay = weeks[0].start;
  const lastDay = iso(addDays(weeks[weeks.length - 1].start, 6));

  const all = weeks.flatMap(w => w.workouts);
  const raceWo = all.find(w => w.race);
  const raceDate = raceWo ? ((moves || {})[raceWo.id] || raceWo.date) : null;

  /* MEASURED / DERIVED, behind today. Only readings inside the plan window
     count: an athlete who came from a tracker has months of history before the
     plan started, and a season chart that opens six months before week 1 is
     answering a question nobody asked. */
  const byDate = {};
  (wellness || []).forEach(r => {
    if (r && r.ctl != null && r.date >= firstDay && r.date <= today) byDate[r.date] = r;
  });
  const known = Object.keys(byDate).sort();
  const lastKnown = known.length ? byDate[known[known.length - 1]] : null;

  /* PROJECTED, ahead of it. Sessions already logged are excluded exactly as
     projectRaceForm excludes them: their load is in the measured series
     already, and counting it twice would ramp the projection off a day the
     athlete has finished. */
  const plannedBy = {};
  all.forEach(w => {
    if (w.race || w.discipline === 'rest' || (log || {})[w.id]) return;
    const d = (moves || {})[w.id] || w.date;
    (plannedBy[d] = plannedBy[d] || []).push(w);
  });

  const projected = {};
  if (lastKnown && lastKnown.atl != null) {
    let state = { ctl: lastKnown.ctl, atl: lastKnown.atl };
    for (let d = iso(addDays(lastKnown.date, 1)); d <= lastDay; d = iso(addDays(d, 1))) {
      const tss = (plannedBy[d] || []).reduce((s, w) => s + estimateTss(w, (adjust || {})[w.id]), 0);
      state = stepLoad(state, tss);
      projected[d] = state;
    }
  }

  /* Sampled at each plan week's Monday. Weekly rather than daily because the
     question is the shape of a season, and 34 points draw it as well as 238
     do — but a week with NO reading stays null rather than borrowing its
     neighbour's, so a feed that starts after the plan did shows a line that
     starts where the data does. */
  const points = weeks.map(w => {
    const d = w.start;
    const m = byDate[d];
    if (m) return { date: d, ctl: round1(m.ctl), projected: false };
    const p = projected[d];
    if (p) return { date: d, ctl: round1(p.ctl), projected: true };
    return { date: d, ctl: null, projected: d > today };
  });

  // Fractional, because today and race day fall mid-week and the one line
  // whose whole job is to say "exactly here" must not be rounded to Monday.
  const atIndex = dISO => {
    if (dISO < firstDay || dISO > lastDay) return null;
    return round1(daysBetween(firstDay, iso(startOfWeekMonday(dISO))) / 7
      + (daysBetween(iso(startOfWeekMonday(dISO)), dISO) / 7));
  };

  const groups = phaseGroups(plan);
  const nowWeek = weeks.find(w => today >= w.start && today <= iso(addDays(w.start, 6)));
  const nowGroup = nowWeek && groups.find(g => nowWeek.index >= g.start && nowWeek.index < g.start + g.weeks);

  return {
    points,
    todayIndex: atIndex(today),
    raceIndex: raceDate ? atIndex(raceDate) : null,
    raceDate,
    // Base/Build/Peak/Taper as spans in the same index space as the points,
    // so the ribbon lines up with the plot rather than approximating it.
    phases: groups.map(g => ({ label: g.phase, from: g.start, to: g.start + g.weeks - 1 })),
    weeks: weeks.length,
    // "week 22 of 34" — absent rather than guessed when today is outside the
    // plan (before it starts, or after it ends).
    weekOfSeason: nowWeek ? nowWeek.index + 1 : null,
    block: nowGroup && nowWeek
      ? { label: nowGroup.phase, week: nowWeek.index - nowGroup.start + 1, of: nowGroup.weeks }
      : null,
    from: firstDay,
    to: lastDay,
  };
}

/* What the plan has already committed to between here and the end of it:
   benchmark tests, tune-up races, and the race itself. Read off the plan's own
   workouts rather than off the engine's retest nudges — those answer "should
   you test", which is a different question from "when does the plan say you
   will". */
const TEST_LABEL = {
  bikeFtp: 'FTP retest',
  swimCss: 'Swim CSS test',
  runFivek: '5k time trial',
};

export function seasonMilestones({ plan, moves, todayISO, limit }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return [];
  const today = todayISO || iso(new Date());
  const out = [];
  plan.weeks.flatMap(w => w.workouts).forEach(w => {
    const date = (moves || {})[w.id] || w.date;
    if (date < today) return;
    if (w.race) out.push({ id: w.id, date, kind: 'race', icon: 'trophy', label: w.title });
    else if (w.bRace) out.push({ id: w.id, date, kind: 'tuneup', icon: 'flag', label: w.title });
    else if (w.test) out.push({
      id: w.id, date, kind: 'test', icon: 'stopwatch',
      label: TEST_LABEL[w.testKind] || w.title,
    });
  });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return limit ? out.slice(0, limit) : out;
}
