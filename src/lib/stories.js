import { DISCIPLINE } from './autolog.js';
import { weeklyRunKm } from './runstats.js';
import { RUN_RAMP_RULES } from './runload.js';
import { fmtDuration } from './units.js';
import { fmtDate, daysBetween } from './date.js';

/* Progress stories (phase 6, spec §9.6): short milestone sentences on the
 * Progress Overview. Every story is a recency-windowed derivation over data
 * the app already holds, so it appears when earned and expires on its own —
 * there is deliberately NO seen-store, which is why nothing here ever says
 * "first ever" (that claim would need a stamp; "longest recorded" does not).
 *
 * Engine-truth rules this module lives by: shared shapes are parametrised
 * per discipline so no line can be wrong for one of them; the volume story
 * fires only when the ramp signal itself certifies the load (praise the
 * signal cannot certify is banned); the accepted-proposal story quotes the
 * journal's own headline and re-derives nothing. */

export const STORY_WINDOW_DAYS = 14;

const within = (dateISO, todayISO) => {
  if (!dateISO) return false;
  const d = daysBetween(dateISO, todayISO);
  return d >= 0 && d <= STORY_WINDOW_DAYS;
};

const NOUN = { run: 'run', bike: 'ride', swim: 'swim' };
const LONG_NOUN = { run: 'long runs', bike: 'long rides' };

export function progressStories({ activities, durability, plan, log, moves, decisionLog, runLoad, todayISO }) {
  const stories = [];
  const acts = Array.isArray(activities) ? activities : [];

  // S1: the last three durability reads in a discipline all held strong.
  // Bands are the engine's own verdicts; run and bike get their own line.
  for (const d of ['run', 'bike']) {
    const reads = (Array.isArray(durability) ? durability : [])
      .filter(e => e && e.discipline === d && e.read && e.read.band)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    if (reads.length >= 3 && reads.slice(0, 3).every(e => e.read.band === 'held-strong')
      && within(reads[0].date, todayISO)) {
      stories.push({ id: 'durability-' + d, icon: 'trend', text: 'Your last three ' + LONG_NOUN[d] + ' held strong to the end.' });
    }
  }

  // S2: three complete weeks of strictly rising run volume, certified by the
  // ramp signal sitting inside the build guideline. No signal, no story.
  if (runLoad && runLoad.rampPct != null && runLoad.rampPct <= RUN_RAMP_RULES.buildPct && acts.length) {
    const wk = weeklyRunKm({ activities: acts, todayISO, weeks: 5 });
    const complete = wk.slice(0, -1).slice(-3); // drop the current, incomplete week
    if (complete.length === 3 && complete.every(x => x.km > 0)
      && complete[0].km < complete[1].km && complete[1].km < complete[2].km) {
      stories.push({ id: 'run-volume', icon: 'trend', text: 'Three straight weeks of rising run volume, and your run load is still inside the build guideline.' });
    }
  }

  // S3: the longest recorded session of a discipline, set within the window.
  // Strictly longest (ties do not fire) with at least two earlier sessions
  // of the same discipline, so a lone first activity is never a milestone.
  for (const d of ['swim', 'bike', 'run']) {
    const ofD = acts.filter(a => a && DISCIPLINE[a.type] === d && a.movingTimeSec > 0 && a.date);
    if (ofD.length < 3) continue;
    const top = ofD.reduce((a, b) => (b.movingTimeSec > a.movingTimeSec ? b : a));
    const rest = ofD.filter(a => a !== top);
    const strictly = rest.every(a => a.movingTimeSec < top.movingTimeSec);
    const priors = rest.filter(a => a.date < top.date).length;
    if (strictly && priors >= 2 && within(top.date, todayISO)) {
      stories.push({ id: 'longest-' + d, icon: 'flame', text: 'Your longest recorded ' + NOUN[d] + ': ' + fmtDuration(Math.round(top.movingTimeSec / 60)) + ' on ' + fmtDate(top.date, { day: 'numeric', month: 'short' }) + '.' });
    }
  }

  // S4: a benchmark test completed recently. A log fact, plan mode only.
  if (plan && Array.isArray(plan.weeks) && log) {
    const tests = plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.test && log[w.id])
      .map(w => ({ w, date: (moves || {})[w.id] || w.date }))
      .filter(x => x.date <= todayISO && within(x.date, todayISO))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    if (tests.length) {
      const t = tests[0];
      stories.push({ id: 'benchmark', icon: 'stopwatch', text: 'You completed ' + t.w.title + ' on ' + fmtDate(t.date, { day: 'numeric', month: 'short' }) + '. A fresh benchmark is the most honest input a plan can get.' });
    }
  }

  // S5: an accepted proposal, quoted in the journal's own words. Latest
  // status per decision id wins (a later rejection retracts the story).
  if (Array.isArray(decisionLog) && decisionLog.length) {
    const latest = new Map();
    for (const row of decisionLog) {
      if (!row || !row.id || !row.at) continue;
      const prev = latest.get(row.id);
      if (!prev || row.at > prev.at) latest.set(row.id, row);
    }
    const accepted = [...latest.values()]
      .filter(r => r.status === 'accepted' && r.headline && within((r.at || '').slice(0, 10), todayISO))
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    if (accepted.length) {
      stories.push({ id: 'accepted', icon: 'check', text: 'Accepted this week: ' + accepted[0].headline });
    }
  }

  return stories.slice(0, 4);
}
