/* Try — the athlete state strip's pure mapper.
 *
 * Four independent axes Jon named in the vision doc: Fitness, Fatigue,
 * Recovery, and run load (the "injury risk" column, honestly relabelled —
 * see the tile note below). Each reads a signal that already exists; this
 * function does no computing of its own beyond banding and trend direction,
 * so it stays trivially testable and the strip component stays presentational.
 *
 * Deliberate separations, so the four tiles never restate one another:
 *   - Fitness reads CTL, Fatigue reads ATL. NOT both through TSB — that would
 *     show the same number twice and throw away the distinct fatigue axis.
 *   - Recovery reads TSB via the form zones, using their labels VERBATIM so the
 *     tile word matches the chart legend directly below it.
 *   - Run load reads runLoadSignal (logged run minutes ramp), which is
 *     log-only, so a sensor-less athlete gets an identical tile.
 *
 * Honesty rules baked in: thin data shows an explicit "not enough" state per
 * tile, never a fabricated number; if NEITHER load nor run history exists the
 * whole strip hides (show:false) and the trend charts' own empty state speaks;
 * the run-load tile is labelled "Run load", never "Injury risk", and never
 * prints the ramp percent (which invites the ACWR misreading runLoadSignal's
 * own header warns against) — only the honest acute-minutes figure.
 */
import { wellness as W } from '@/lib/wellness.js';
import { RUN_RAMP_RULES } from '@/lib/runload.js';

export function athleteState({ wellness, runLoad, recovery } = {}) {
  const load = (wellness || []).filter(r => r.ctl != null && r.atl != null).slice(-60);
  // Two rows minimum: a trend arrow needs a start and an end, and a lone
  // reading is too thin to headline "where you stand". The recovery tile keys
  // on tsbNow instead (a form zone reads off one row), but with a single row
  // the whole strip hides anyway unless there is run history.
  const hasLoad = load.length >= 2;
  const last = load.length ? load[load.length - 1] : null;
  const first = load.length ? load[0] : null;
  const derived = !!(last && last.derived);
  // Trust a stored (possibly manually entered) tsb over ctl-atl for the shown
  // number and its zone, matching ReadinessCard. projectRecovery instead keys
  // its timeline on ctl-atl, so in the rare case a manual tsb contradicts
  // ctl-atl the two can disagree; the highRisk-AND-recovery gate below fails
  // safe, omitting the sub rather than pairing it with a non-highRisk word.
  const tsbNow = last ? (last.tsb != null ? last.tsb : last.ctl - last.atl) : null;
  const ctlD = hasLoad ? last.ctl - first.ctl : null;
  const atlD = hasLoad ? last.atl - first.atl : null;
  // acute7d must be present too, or the tile would render "undefined min".
  const runOk = !!(runLoad && runLoad.rampPct != null && runLoad.acute7d != null);

  // Nothing honest to say → hide the whole strip rather than show four blanks.
  const show = hasLoad || runOk;

  const trend = (delta, up, flat, down) =>
    delta == null ? null : delta > 0 ? up : delta < 0 ? down : flat;
  const arrow = delta => delta == null ? null : delta > 0 ? '▲' : delta < 0 ? '▼' : '–';

  const fz = W.formZone(tsbNow);

  // Recovery timeline enrichment: only while form sits in high risk and a
  // projection exists, phrased exactly as the readiness card phrases it.
  // Mirror ReadinessCard's four branches exactly (ReadinessCard.jsx:209-213).
  // days == null is the beyond-horizon case: recovery was NOT seen inside the
  // projection window, so it is an unbounded floor ("at least"), never a
  // bounded "a week or two". Only 2..7 days earns a day count; past that the
  // card softens to "a week or two" and so must this.
  let recSub = null;
  if (fz && fz.key === 'highRisk' && recovery) {
    recSub = recovery.days == null ? 'high risk at least another week or two'
      : recovery.days <= 1 ? 'clear by tomorrow'
        : recovery.days <= 7 ? 'recovers in about ' + recovery.days + ' days'
          : 'clears in a week or two';
  }

  let runWord = null, runColor = null;
  if (runOk) {
    const r = runLoad.rampPct;                   // unrounded, per runLoadSignal
    // Zero logged run minutes is not a reassuring "Steady" green: the athlete
    // has stopped running. Say so plainly rather than dressing it as safe.
    if (runLoad.acute7d === 0) { runWord = 'No runs logged'; runColor = 'var(--muted)'; }
    else if (r >= RUN_RAMP_RULES.riskPct) { runWord = 'Ramping hard'; runColor = 'var(--danger)'; }
    else if (r >= RUN_RAMP_RULES.buildPct) { runWord = 'Building'; runColor = '#facc15'; }
    else { runWord = 'Steady'; runColor = 'var(--run)'; }
  }

  const tiles = [
    {
      key: 'fitness', label: 'Fitness', topic: 'fitness-fatigue',
      empty: !hasLoad,
      value: hasLoad ? Math.round(last.ctl) : null,
      word: trend(ctlD, 'rising', 'holding', 'easing'),
      arrow: arrow(ctlD),
      color: 'var(--blue)',
    },
    {
      key: 'fatigue', label: 'Fatigue', topic: 'fitness-fatigue',
      empty: !hasLoad,
      value: hasLoad ? Math.round(last.atl) : null,
      word: trend(atlD, 'climbing', 'steady', 'dropping'),
      arrow: arrow(atlD),
      color: 'var(--danger)',
    },
    {
      key: 'recovery', label: 'Recovery', topic: 'form',
      empty: tsbNow == null,
      value: tsbNow == null ? null : tsbNow,      // rendered via <Signed>
      signed: true,
      word: fz ? fz.label : null,
      sub: recSub,
      color: fz ? fz.color : null,
    },
    {
      key: 'runload', label: 'Run load', topic: 'ramp-rate',
      empty: !runOk,
      emptyWord: 'Not enough runs yet',
      value: runOk ? runLoad.acute7d + ' min' : null,
      word: runWord,
      sub: runOk ? 'run load, last 7 days' : null,
      arrow: runOk ? arrow(runLoad.rampPct) : null,
      color: runColor,
    },
  ];

  return { show, derived, tiles };
}
