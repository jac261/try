import * as T from '@/lib';

// ---- adaptive pace tuning from post-session feedback ----
// Reviews how recent sessions (since the last baseline change) have felt, per
// discipline, and suggests a gentle pace nudge when a discipline trends one way.
// Workout types that genuinely tax the target paces. Easy / Long / Technique /
// Endurance (and recovery-week sessions, which downgrade to those) are *meant* to
// feel easy, so they don't signal that targets are too soft.
export const INTENSITY_TYPES = { 'Tempo': 1, 'Threshold': 1, 'VO2 Intervals': 1, 'Sweet Spot': 1, 'CSS Intervals': 1, 'Race Pace': 1 };
export function paceSuggestions(plan, log) {
  const since = plan.updatedAt || plan.createdAt || '0';
  const all = plan.weeks.flatMap(w => w.workouts).filter(w => INTENSITY_TYPES[w.type] && !w.test && !w.race);
  const byDisc = { run: [], bike: [], swim: [] };
  all.forEach(w => {
    const l = log[w.id];
    if (l && l.feel && l.at && l.at > since && byDisc[w.discipline]) byDisc[w.discipline].push(l.feel);
  });
  const out = [];
  ['run', 'bike', 'swim'].forEach(d => {
    if (d === 'bike' && !plan.profile.ftp) return;   // bike runs on RPE without an FTP — nothing to nudge
    const fs = byDisc[d];
    if (fs.length < 3) return;
    const easy = fs.filter(x => x === 'easy').length;
    const hard = fs.filter(x => x === 'hard').length;
    if (easy - hard >= 2) out.push({ discipline: d, direction: 'faster' });
    else if (hard - easy >= 2) out.push({ discipline: d, direction: 'easier' });
  });
  return out;
}

// Translate suggestions into adjusted baseline fields (~2% nudge each).
export function tuneFields(profile, suggestions) {
  const lvl = T.FITNESS[profile.fitness] || T.FITNESS.intermediate;
  const fields = {};
  suggestions.forEach(s => {
    const t = s.direction === 'faster' ? 0.98 : 1.02;   // run/swim: less time = faster
    const w = s.direction === 'faster' ? 1.02 : 0.98;   // bike: more watts = faster
    if (s.discipline === 'run') {
      // seed from the runner anchor on a solo plan, or the pace fix leaks the
      // moment an athlete accepts a run suggestion on a blank-5k plan
      const soloRun = (T.RACES[profile.raceType] || {}).solo === 'run';
      fields.fivekSec = Math.round((profile.fivekSec || (soloRun ? lvl.runEst5k : lvl.est5k)) * t);
      // The fifth 5 km write point, and the one that could launder a guess
      // into evidence. A feel-based nudge means the number is no longer
      // whatever was measured — and on a blank-5k plan it was never measured
      // at all, it is the level table nudged two per cent. Stamping it
      // 'estimated' keeps runAnchor from calling it real, which is what kept
      // race projections and benchmark history off a number the athlete never
      // ran. Mirrors the swim's cssMeta below, which fixed this exact class.
      fields.fivekMeta = { source: 'estimated', measuredAt: T.iso(new Date()), confidence: 'low' };
    }
    if (s.discipline === 'swim') {
      fields.css100Sec = Math.round((profile.css100Sec || lvl.estCss) * t);
      // a feel-based nudge is the fifth CSS write point (gauntlet catch
      // 2026-07-27): the tuned number is no longer whatever was measured, so
      // the provenance must not keep claiming a swum test — it is an
      // estimate now, dated to the nudge
      fields.cssMeta = { source: 'estimated', measuredAt: T.iso(new Date()), confidence: 'low' };
    }
    if (s.discipline === 'bike' && profile.ftp) {
      fields.ftp = Math.round(profile.ftp * w);
      // The fifth FTP write point. A feel-based nudge means the number is no
      // longer whatever was tested, so the provenance must stop claiming it
      // was: it is a model of how the rides have felt, at low confidence.
      fields.ftpMeta = { source: 'activity-model', measuredAt: T.iso(new Date()), confidence: 'low' };
    }
  });
  return fields;
}
