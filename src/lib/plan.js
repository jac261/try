/* Try — periodized plan generator + structured workout builder */
import { clamp, round5, lerp, fmtPace } from './units.js';
import { iso, addDays, startOfWeekMonday, daysBetween } from './date.js';
import { RACES, B_RACES, FITNESS, ZONES } from './domain.js';
import { weakBias } from './weakest.js';

/* ---- paces derived from the athlete's baselines ---- */
function computePaces(profile) {
  const lvl = FITNESS[profile.fitness] || FITNESS.intermediate;
  // Use the athlete's own numbers if given, otherwise estimate from their level.
  const fivek = profile.fivekSec || lvl.est5k;
  const p = fivek / 5;                             // sec per km at 5k effort
  const css = profile.css100Sec || lvl.estCss;
  const ftp = profile.ftp || null;                 // watts (optional, no estimate)
  return {
    runEstimated: !profile.fivekSec,               // true when paces are level-based guesses
    swimEstimated: !profile.css100Sec,
    ftp: ftp,
    run: { recovery: p + 85, easy: p + 70, long: p + 78, tempo: p + 35, threshold: p + 12, interval: p - 8 },
    swim: { easy: css + 12, steady: css + 6, css: css, fast: css - 6 },
  };
}

function runDetail(pc, key, zone) {
  const z = ZONES[zone];
  if (pc.runEstimated) return '~' + fmtPace(pc.run[key]) + ' /km · ' + zone + ' · ' + z.rpe;
  return fmtPace(pc.run[key]) + ' /km · ' + zone + ' ' + z.name;
}
function swimDetail(pc, key, zone) {
  const z = ZONES[zone];
  if (pc.swimEstimated) return '~' + fmtPace(pc.swim[key]) + ' /100m · ' + zone + ' · ' + z.rpe;
  return fmtPace(pc.swim[key]) + ' /100m · ' + zone;
}
function bikeDetail(pc, lo, hi, zone) {
  const z = ZONES[zone];
  if (pc.ftp) return Math.round(pc.ftp * lo) + '–' + Math.round(pc.ftp * hi) + ' W · ' + zone + ' ' + z.name;
  return zone + ' ' + z.name + ' · ' + z.rpe;
}

/* ---- per-discipline workout builders → {title, segments[], distance} ----

   The workout library: each session type carries several classic formats of
   the same intensity character, picked deterministically by `seed` (the plan
   week index). Variant 0 is always the canonical template, consecutive weeks
   rotate formats, and the adaptive engine's rebuilds (ease/trim/boost) pass
   the workout's stored seed so a reshaped session keeps its format.
   Recovery weeks pin variant 0 (the gentlest, canonical shape). No
   randomness anywhere — the same profile always generates the same plan. */

// Expand an interval pattern into drawable blocks for the workout profile:
// n × (on minutes at onZone / off minutes at offZone), recoveries included.
function rep(n, on, onZone, off, offZone) {
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ min: on, zone: onZone });
    if (off) blocks.push({ min: off, zone: offZone });
  }
  return blocks;
}

/* ---- sizing: make a variant's segments sum to exactly its durationMin ----

   The one quantity the card breakdown, the fit and the watch push all sum: a
   segment's effective minutes are its block total when structured, else its own
   `min`. (watch.js sums the same thing, so card == watch by construction.) */
export function segMinutes(seg) {
  return seg.blocks ? seg.blocks.reduce((a, b) => a + (b.min || 0), 0) : (seg.min || 0);
}
function sumMinutes(segs) {
  return segs.reduce((a, s) => a + segMinutes(s), 0);
}

// Fit a selected variant to exactly `dur`: canonicalise each structured
// segment's `min` to its block total, then flex the aerobic buffers around the
// fixed quality work so the segments sum to dur without touching the reps or
// their labels.
//   'lead' formats (Long/Endurance): the steady lead-in (first segment) soaks
//     everything after it.
//   'tail' formats (warm-up + quality + cool-down): the cool-down soaks the
//     residual; on a short session where the quality no longer leaves room, the
//     WARM-UP shrinks toward a floor first (a shorter session wants a shorter
//     warm-up), and only when even that will not fit does the whole thing
//     collapse to a single continuous block of the session's own character
//     (`fb`) — the degrade floor. Deterministic and pure: only minutes move,
//     never the variant, its blocks or its labels.
// Distance from the session's real pace mix, not a flat easy-pace anchor: each
// block covers ground at its own zone's pace, so quality km read longer and
// long-run km shorter — both honest. Swim distance is the summed prescribed
// metres (exact, no estimate). Bike stays a ~30 km/h guess.
const ZONE_PACE = { Z1: 'recovery', Z2: 'easy', Z3: 'tempo', Z4: 'threshold', Z5: 'interval' };
function runDistance(segs, pc) {
  let km = 0;
  const add = (min, zone) => { km += (min || 0) * 60 / (pc.run[ZONE_PACE[zone]] || pc.run.easy); };
  segs.forEach(s => { if (s.blocks) s.blocks.forEach(b => add(b.min, b.zone)); else add(s.min, s.zone); });
  return Math.round(km * 10) / 10;
}
function swimDistance(segs) {
  let m = 0;
  segs.forEach(s => { if (s.swim) m += s.swim.distM != null ? s.swim.distM : (s.swim.n || 0) * (s.swim.repM || 0); });
  return Math.round(m / 100) / 10;
}

const FIT_FLOOR = 3;
const WARM_FLOOR = 6;
function fitFlex(segs, dur, pos, fb) {
  segs.forEach(s => { if (s.blocks) s.min = segMinutes(s); });
  const fallback = () => [{ label: fb.label, min: dur, detail: fb.detail, zone: fb.zone }];
  if (pos === 'lead' || segs.length < 3) {
    const lead = dur - segs.slice(1).reduce((a, s) => a + segMinutes(s), 0);
    if (lead >= FIT_FLOOR) { segs[0].min = lead; return segs; }
    return fallback();
  }
  const warm = segs[0], cool = segs[segs.length - 1];
  const midFixed = segs.slice(1, -1).reduce((a, s) => a + segMinutes(s), 0);
  let coolMin = dur - segMinutes(warm) - midFixed;
  if (coolMin >= FIT_FLOOR) { cool.min = coolMin; return segs; } // long/normal: cool absorbs
  const newWarm = dur - midFixed - FIT_FLOOR;                    // short: pull the warm-up in
  coolMin = dur - newWarm - midFixed;
  if (newWarm >= WARM_FLOOR && coolMin >= FIT_FLOOR) { warm.min = newWarm; cool.min = coolMin; return segs; }
  return fallback();
}

// Swim segments are distance-based, so profile blocks estimate their minutes
// from the CSS-anchored paces: one steady block for continuous swimming, or
// work/rest alternation for interval sets (rest drawn as Z1). Each helper is
// spread into its segment and also keeps the structural prescription (metres,
// reps, rest, % of CSS speed) that the structured watch push emits as DSL.
function swimBlock(pc, key, zone, distM, restPer100) {
  return {
    blocks: [{ min: (distM / 100) * (pc.swim[key] + (restPer100 || 0)) / 60, zone: zone }],
    swim: { distM: distM, pct: Math.round(pc.swim.css / pc.swim[key] * 100) },
  };
}
function swimRep(pc, key, zone, n, repM, restSec) {
  return {
    blocks: rep(n, (repM / 100) * pc.swim[key] / 60, zone, (restSec || 0) / 60, 'Z1'),
    swim: { n: n, repM: repM, restSec: restSec || 0, pct: Math.round(pc.swim.css / pc.swim[key] * 100) },
  };
}

function buildRun(type, dur, pc, seed, phase, intensity = 0) {
  const v = n => (seed || 0) % n;
  // Durability: intervals on tired legs at the end of the long session build
  // fatigue resistance — a Build/Peak tool, never Base or recovery weeks, and
  // never for a beginner (intensity < 0): threshold reps on already-tired legs
  // are a poor risk/reward at that level. The dur floor keeps the steady lead-in
  // (dur − 25) positive when a Long is trimmed small.
  // Gate on phase + level only — NOT dur. Both are stable across an ease/trim
  // rebuild (the workout keeps its phase, the athlete keeps their level), so the
  // variant-menu size v(durability ? 3 : 2) stays constant and a rebuilt session
  // keeps its format. Short durations are handled by clamping the lead-ins, not
  // by shrinking the menu (which would flip the variant on a trim across 45).
  const durability = (phase === 'Build' || phase === 'Peak') && intensity >= 0;
  let segs = [], title = 'Run';
  if (type === 'Long') {
    title = 'Long Run';
    segs = [
      [{ label: 'Steady aerobic', min: dur, detail: runDetail(pc, 'long', 'Z2'), zone: 'Z2' }],
      [
        { label: 'Steady aerobic', min: Math.max(5, dur - 15), detail: runDetail(pc, 'long', 'Z2'), zone: 'Z2' },
        { label: 'Fast finish', min: 15, detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3' },
      ],
      [
        { label: 'Steady aerobic', min: Math.max(5, dur - 25), detail: runDetail(pc, 'long', 'Z2'), zone: 'Z2' },
        { label: '4 × (3 min threshold / 2 min easy) — on tired legs', min: 20, detail: runDetail(pc, 'threshold', 'Z4'), zone: 'Z4', blocks: rep(4, 3, 'Z4', 2, 'Z2') },
        { label: 'Ease home', min: 5, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
    ][v(durability ? 3 : 2)];
  } else if (type === 'Easy') {
    title = 'Easy Run';
    const half = Math.round(dur / 2);
    segs = [
      [{ label: 'Relaxed', min: dur, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' }],
      [
        { label: 'Relaxed', min: dur - 8, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: '6 × 20 s strides · walk back', min: 8, detail: 'Fast but relaxed · form over force', blocks: rep(6, 0.35, 'Z5', 1, 'Z1') },
      ],
      [
        { label: 'First half · very relaxed', min: half, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: 'Second half · steady', min: dur - half, detail: runDetail(pc, 'long', 'Z2'), zone: 'Z2' },
      ],
    ][v(3)];
  } else if (type === 'Tempo') {
    title = 'Tempo Run';
    const main = Math.max(15, dur - 22);
    const half = Math.max(8, Math.round(main / 2) - 2);
    const third = Math.round(dur / 3);
    segs = [
      [
        { label: 'Warm-up', min: 12, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: 'Tempo block', min: main, detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3' },
        { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 12, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: '2 × (' + half + ' min tempo / 4 min float)', min: main, detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3', blocks: rep(2, half, 'Z3', 4, 'Z2') },
        { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Settle in · relaxed', min: third, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: 'Steady', min: third, detail: runDetail(pc, 'long', 'Z2'), zone: 'Z2' },
        { label: 'Wind it up · tempo', min: dur - 2 * third, detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3' },
      ],
    ][v(3)];
  } else if (type === 'VO2 Intervals') {
    title = 'VO2 Intervals';
    const reps = clamp(Math.round((dur - 25) / 5), 4, 8);
    const sets = clamp(Math.round((dur - 25) / 12), 2, 3);
    const hills = clamp(Math.round((dur - 25) / 4), 5, 10);
    const thirties = Array.from({ length: sets }).flatMap((x, i) =>
      rep(10, 0.5, 'Z5', 0.5, 'Z1').concat(i < sets - 1 ? [{ min: 3, zone: 'Z1' }] : []));
    segs = [
      [
        { label: 'Warm-up', min: 15, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: reps + ' × (3 min hard / 2 min easy)', min: reps * 5, detail: runDetail(pc, 'interval', 'Z5'), zone: 'Z5', blocks: rep(reps, 3, 'Z5', 2, 'Z1') },
        { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: sets + ' × 10 × (30 s hard / 30 s easy) · 3 min between sets', min: sets * 12, detail: runDetail(pc, 'interval', 'Z5'), zone: 'Z5', blocks: thirties },
        { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: hills + ' × 75 s uphill hard · jog down', min: hills * 4, detail: runDetail(pc, 'interval', 'Z5'), zone: 'Z5', blocks: rep(hills, 1.25, 'Z5', 2.75, 'Z1') },
        { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
    ][v(3)];
  } else if (type === 'Fartlek') {
    title = 'Fartlek Run';
    const surges = clamp(Math.round((dur - 18) / 3), 6, 12);
    // Pick the tallest pyramid that fits the session (work + equal-jog = 2 × sum).
    const steps = dur - 18 >= 32 ? [1, 2, 3, 4, 3, 2, 1] : dur - 18 >= 24 ? [1, 2, 3, 3, 2, 1] : [1, 2, 3, 2, 1];
    const pyramidMin = 2 * steps.reduce((a, b) => a + b, 0);
    const pyramid = steps.flatMap(m => [{ min: m, zone: 'Z3' }, { min: m, zone: 'Z2' }]);
    segs = [
      [
        { label: 'Warm-up', min: 10, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: surges + ' × (1 min brisk / 2 min easy)', min: surges * 3, detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3', blocks: rep(surges, 1, 'Z3', 2, 'Z2') },
        { label: 'Cool-down', min: 8, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 10, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: 'Pyramid: ' + steps.join('-') + ' min brisk / equal easy jog', min: pyramidMin, detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3', blocks: pyramid },
        { label: 'Cool-down', min: 8, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 10, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: 'Surges by feel · 8–12 × 30–60 s quick on rolling terrain', min: Math.max(12, dur - 18), detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3' },
        { label: 'Cool-down', min: 8, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
    ][v(3)];
  } else { // Threshold
    title = 'Threshold Run';
    const reps = clamp(Math.round((dur - 25) / 12), 2, 4);
    const cruise = clamp(Math.round((dur - 25) / 7), 3, 6);
    const blocks = clamp(Math.round((dur - 25) / 16), 2, 3);
    segs = [
      [
        { label: 'Warm-up', min: 15, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: reps + ' × (9 min threshold / 3 min easy)', min: reps * 12, detail: runDetail(pc, 'threshold', 'Z4'), zone: 'Z4', blocks: rep(reps, 9, 'Z4', 3, 'Z2') },
        { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: cruise + ' × (5 min threshold / 2 min easy)', min: cruise * 7, detail: runDetail(pc, 'threshold', 'Z4'), zone: 'Z4', blocks: rep(cruise, 5, 'Z4', 2, 'Z2') },
        { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
        { label: blocks + ' × (12 min cruise / 4 min easy)', min: blocks * 16, detail: runDetail(pc, 'threshold', 'Z4'), zone: 'Z4', blocks: rep(blocks, 12, 'Z4', 4, 'Z2') },
        { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
    ][v(3)];
  }
  // Fit the chosen variant to exactly dur: Long/Easy flex their steady lead-in,
  // the quality formats flex their cool-down; a hard-trimmed session that can't
  // carry the structure collapses to a single steady block of the right colour.
  const FB = {
    Long: { label: 'Steady aerobic', detail: runDetail(pc, 'long', 'Z2'), zone: 'Z2' },
    Easy: { label: 'Relaxed', detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
    Tempo: { label: 'Tempo', detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3' },
    Fartlek: { label: 'Fartlek by feel', detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3' },
    'VO2 Intervals': { label: 'Hard aerobic effort', detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3' },
    Threshold: { label: 'Threshold effort', detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3' },
  };
  segs = fitFlex(segs, dur, (type === 'Long' || type === 'Easy') ? 'lead' : 'tail', FB[type] || FB.Tempo);
  const dist = runDistance(segs, pc);
  return { title: title, segments: segs, distance: dist, unit: 'km', distEst: pc.runEstimated };
}

function buildBike(type, dur, pc, seed, phase, intensity = 0) {
  const v = n => (seed || 0) % n;
  // Durability: see buildRun — a Build/Peak tool, never for a beginner, and only
  // when the ride is long enough to carry the tired-legs finish (dur − 32 > 0).
  // See buildRun: gated on phase + level only (both stable across a rebuild), so
  // the variant menu never resizes on a trim; lead-ins are clamped, not the menu.
  const durability = (phase === 'Build' || phase === 'Peak') && intensity >= 0;
  let segs = [], title = 'Bike';
  if (type === 'Long') {
    title = 'Long Ride';
    segs = [
      [
        { label: 'Endurance', min: Math.max(5, dur - 20), detail: bikeDetail(pc, 0.6, 0.75, 'Z2'), zone: 'Z2' },
        { label: '2 × 6 min tempo surges', min: 20, detail: bikeDetail(pc, 0.83, 0.9, 'Z3'), zone: 'Z3', blocks: rep(2, 6, 'Z3', 4, 'Z2') },
      ],
      [
        { label: 'Endurance', min: Math.max(5, dur - 25), detail: bikeDetail(pc, 0.6, 0.75, 'Z2'), zone: 'Z2' },
        { label: '2 × 10 min sweet spot / 2.5 min easy', min: 25, detail: bikeDetail(pc, 0.84, 0.9, 'Z3'), zone: 'Z3', blocks: rep(2, 10, 'Z3', 2.5, 'Z1') },
      ],
      [
        { label: 'Endurance', min: Math.max(5, dur - 32), detail: bikeDetail(pc, 0.6, 0.75, 'Z2'), zone: 'Z2' },
        { label: '3 × (5 min at threshold / 3 min easy) — on tired legs', min: 24, detail: bikeDetail(pc, 0.95, 1.05, 'Z4'), zone: 'Z4', blocks: rep(3, 5, 'Z4', 3, 'Z1') },
        { label: 'Ease home', min: 8, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
    ][v(durability ? 3 : 2)];
  } else if (type === 'Endurance') {
    title = 'Endurance Ride';
    segs = [
      [{ label: 'Steady', min: dur, detail: bikeDetail(pc, 0.6, 0.75, 'Z2'), zone: 'Z2' }],
      [
        { label: 'Steady', min: Math.max(5, dur - 18), detail: bikeDetail(pc, 0.6, 0.75, 'Z2'), zone: 'Z2' },
        { label: '3 × 6 min high cadence (95–105 rpm)', min: 18, detail: bikeDetail(pc, 0.6, 0.75, 'Z2'), zone: 'Z2' },
      ],
      [
        { label: 'Steady', min: Math.max(5, dur - 24), detail: bikeDetail(pc, 0.6, 0.75, 'Z2'), zone: 'Z2' },
        { label: '3 × 8 min low cadence (60–65 rpm), seated', min: 24, detail: bikeDetail(pc, 0.72, 0.8, 'Z3'), zone: 'Z3' },
      ],
    ][v(3)];
  } else if (type === 'Sweet Spot') {
    title = 'Sweet Spot';
    const reps = clamp(Math.round((dur - 25) / 17), 2, 4);
    const nines = clamp(Math.round((dur - 25) / 12), 3, 5);
    const block = clamp(dur - 25, 20, 40);
    segs = [
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: reps + ' × (12 min / 5 min easy)', min: reps * 17, detail: bikeDetail(pc, 0.84, 0.9, 'Z3'), zone: 'Z3', blocks: rep(reps, 12, 'Z3', 5, 'Z1') },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: nines + ' × (9 min / 3 min easy)', min: nines * 12, detail: bikeDetail(pc, 0.84, 0.9, 'Z3'), zone: 'Z3', blocks: rep(nines, 9, 'Z3', 3, 'Z1') },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: block + ' min continuous sweet spot', min: block, detail: bikeDetail(pc, 0.84, 0.9, 'Z3'), zone: 'Z3' },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
    ][v(3)];
  } else if (type === 'Tempo') {
    title = 'Tempo Ride';
    const blocks = clamp(Math.round((dur - 25) / 16), 2, 3);
    const cont = clamp(dur - 25, 20, 45);
    const eights = clamp(Math.round((dur - 25) / 11), 2, 4);
    segs = [
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: blocks + ' × (12 min tempo / 4 min easy)', min: blocks * 16, detail: bikeDetail(pc, 0.76, 0.85, 'Z3'), zone: 'Z3', blocks: rep(blocks, 12, 'Z3', 4, 'Z1') },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: cont + ' min steady tempo', min: cont, detail: bikeDetail(pc, 0.76, 0.85, 'Z3'), zone: 'Z3' },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: eights + ' × (8 min tempo / 3 min easy)', min: eights * 11, detail: bikeDetail(pc, 0.76, 0.85, 'Z3'), zone: 'Z3', blocks: rep(eights, 8, 'Z3', 3, 'Z1') },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
    ][v(3)];
  } else if (type === 'VO2 Intervals') {
    title = 'Bike VO2';
    const reps = clamp(Math.round((dur - 25) / 6), 3, 6);
    const sets = clamp(Math.round((dur - 25) / 14), 2, 3);
    const fours = clamp(Math.round((dur - 25) / 8), 3, 5);
    const thirties = Array.from({ length: sets }).flatMap((x, i) =>
      rep(12, 0.5, 'Z5', 0.5, 'Z1').concat(i < sets - 1 ? [{ min: 2, zone: 'Z1' }] : []));
    segs = [
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: reps + ' × (3 min hard / 3 min easy)', min: reps * 6, detail: bikeDetail(pc, 1.06, 1.2, 'Z5'), zone: 'Z5', blocks: rep(reps, 3, 'Z5', 3, 'Z1') },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: sets + ' × 12 × (30 s hard / 30 s easy) · 2 min between sets', min: sets * 14, detail: bikeDetail(pc, 1.06, 1.2, 'Z5'), zone: 'Z5', blocks: thirties },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: fours + ' × (4 min hard / 4 min easy)', min: fours * 8, detail: bikeDetail(pc, 1.06, 1.15, 'Z5'), zone: 'Z5', blocks: rep(fours, 4, 'Z5', 4, 'Z1') },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
    ][v(3)];
  } else { // Threshold
    title = 'Bike Threshold';
    const reps = clamp(Math.round((dur - 25) / 12), 3, 5);
    const overs = clamp(Math.round((dur - 25) / 12), 2, 4);
    const shorts = clamp(Math.round((dur - 25) / 8), 3, 6);
    // Over-under: the "under" legs sit just below threshold (high tempo, Z3) and
    // the "over" legs just above (threshold, Z4) — NOT Z5. Tagging the overs Z5
    // sent the watch a tempo-to-VO2 swing (106-120% FTP) that contradicted the
    // ~90/~105% the card promised and the "over-under" name.
    const ou = Array.from({ length: overs }).flatMap(() =>
      [{ min: 2, zone: 'Z3' }, { min: 1, zone: 'Z4' }, { min: 2, zone: 'Z3' }, { min: 1, zone: 'Z4' }, { min: 2, zone: 'Z3' }, { min: 1, zone: 'Z4' }, { min: 3, zone: 'Z1' }]);
    segs = [
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: reps + ' × (8 min / 4 min easy)', min: reps * 12, detail: bikeDetail(pc, 0.95, 1.05, 'Z4'), zone: 'Z4', blocks: rep(reps, 8, 'Z4', 4, 'Z1') },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: overs + ' × (9 min over-unders: 2 min low / 1 min high / 3 min easy)', min: overs * 12, detail: bikeDetail(pc, 0.9, 1.05, 'Z4'), zone: 'Z4', blocks: ou },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
      [
        { label: 'Warm-up', min: 15, detail: bikeDetail(pc, 0.55, 0.65, 'Z2'), zone: 'Z2' },
        { label: shorts + ' × (5 min / 3 min easy)', min: shorts * 8, detail: bikeDetail(pc, 0.98, 1.08, 'Z4'), zone: 'Z4', blocks: rep(shorts, 5, 'Z4', 3, 'Z1') },
        { label: 'Cool-down', min: 10, detail: bikeDetail(pc, 0.5, 0.6, 'Z1'), zone: 'Z1' },
      ],
    ][v(3)];
  }
  const FB = {
    Long: { label: 'Endurance', detail: bikeDetail(pc, 0.6, 0.75, 'Z2'), zone: 'Z2' },
    Endurance: { label: 'Steady', detail: bikeDetail(pc, 0.6, 0.75, 'Z2'), zone: 'Z2' },
    'Sweet Spot': { label: 'Sweet spot', detail: bikeDetail(pc, 0.84, 0.9, 'Z3'), zone: 'Z3' },
    Tempo: { label: 'Tempo', detail: bikeDetail(pc, 0.76, 0.85, 'Z3'), zone: 'Z3' },
    'VO2 Intervals': { label: 'Hard aerobic effort', detail: bikeDetail(pc, 0.76, 0.85, 'Z3'), zone: 'Z3' },
    Threshold: { label: 'Threshold effort', detail: bikeDetail(pc, 0.83, 0.9, 'Z3'), zone: 'Z3' },
  };
  segs = fitFlex(segs, dur, (type === 'Long' || type === 'Endurance') ? 'lead' : 'tail', FB[type] || FB.Tempo);
  const dist = Math.round(dur / 60 * 30); // ~30 km/h estimate (no power-to-speed model)
  return { title: title, segments: segs, distance: dist, unit: 'km', distEst: true };
}

function buildSwim(type, dur, pc, seed) {
  const v = n => (seed || 0) % n;
  const reps = clamp(Math.round(dur / 4), 6, 16);
  let segs = [], title = 'Swim', main;
  if (type === 'Technique') {
    title = 'Technique Swim';
    main = reps * 100;
    segs = v(2) === 0
      ? [
        { label: 'Warm-up 300 m', detail: swimDetail(pc, 'easy', 'Z2'), ...swimBlock(pc, 'easy', 'Z2', 300) },
        { label: '6 × 50 m drills', detail: 'Catch-up, single-arm, scull', ...swimRep(pc, 'easy', 'Z1', 6, 50, 15) },
        { label: reps + ' × 100 m steady', detail: swimDetail(pc, 'steady', 'Z3'), ...swimRep(pc, 'steady', 'Z3', reps, 100, 10) },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1'), ...swimBlock(pc, 'easy', 'Z1', 200) },
      ]
      : [
        { label: 'Warm-up 300 m', detail: swimDetail(pc, 'easy', 'Z2'), ...swimBlock(pc, 'easy', 'Z2', 300) },
        { label: '8 × 50 m drills', detail: 'Fist, 6-1-6, kick on side', ...swimRep(pc, 'easy', 'Z1', 8, 50, 15) },
        { label: reps + ' × 100 m as 25 m drill / 75 m smooth', detail: swimDetail(pc, 'steady', 'Z3'), ...swimRep(pc, 'steady', 'Z3', reps, 100, 10) },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1'), ...swimBlock(pc, 'easy', 'Z1', 200) },
      ];
  } else if (type === 'CSS Intervals') {
    title = 'CSS Intervals';
    const twos = Math.max(3, Math.round(reps / 2));
    const variant = v(3);
    main = variant === 1 ? twos * 200 : reps * 100;
    segs = [
      [
        { label: 'Warm-up 400 m', detail: swimDetail(pc, 'easy', 'Z2'), ...swimBlock(pc, 'easy', 'Z2', 400) },
        { label: reps + ' × 100 m @ CSS', detail: swimDetail(pc, 'css', 'Z4') + ' · 15 s rest', ...swimRep(pc, 'css', 'Z4', reps, 100, 15) },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1'), ...swimBlock(pc, 'easy', 'Z1', 200) },
      ],
      [
        { label: 'Warm-up 400 m', detail: swimDetail(pc, 'easy', 'Z2'), ...swimBlock(pc, 'easy', 'Z2', 400) },
        { label: twos + ' × 200 m @ CSS + 2 s/100 m', detail: swimDetail(pc, 'css', 'Z4') + ' · 20 s rest', ...swimRep(pc, 'css', 'Z4', twos, 200, 20) },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1'), ...swimBlock(pc, 'easy', 'Z1', 200) },
      ],
      [
        { label: 'Warm-up 400 m', detail: swimDetail(pc, 'easy', 'Z2'), ...swimBlock(pc, 'easy', 'Z2', 400) },
        { label: (reps * 2) + ' × 50 m fast', detail: swimDetail(pc, 'fast', 'Z5') + ' · 20 s rest', ...swimRep(pc, 'fast', 'Z5', reps * 2, 50, 20) },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1'), ...swimBlock(pc, 'easy', 'Z1', 200) },
      ],
    ][variant];
  } else if (type === 'Open Water') {
    title = 'Open Water Swim';
    main = reps * 100;
    segs = [
      { label: 'Warm-up 300 m', detail: swimDetail(pc, 'easy', 'Z2'), ...swimBlock(pc, 'easy', 'Z2', 300) },
      { label: '4 × 200 m @ race effort', detail: swimDetail(pc, 'css', 'Z4') + ' · sight every 6–8 strokes', ...swimRep(pc, 'css', 'Z4', 4, 200, 30) },
      { label: 'Open-water skills', detail: 'Deep-water start, drafting, buoy turns — practise swimming straight' },
      { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1'), ...swimBlock(pc, 'easy', 'Z1', 200) },
    ];
  } else { // Endurance / Race Pace
    title = type === 'Race Pace' ? 'Race-Pace Swim' : 'Endurance Swim';
    main = reps * 100;
    const third = Math.max(1, Math.round(reps / 3)) * 100;
    segs = type === 'Endurance' && v(2) === 1
      ? [
        { label: 'Warm-up 300 m', detail: swimDetail(pc, 'easy', 'Z2'), ...swimBlock(pc, 'easy', 'Z2', 300) },
        { label: '3 × ' + third + ' m steady · 30 s rest', detail: swimDetail(pc, 'steady', 'Z2'), ...swimRep(pc, 'steady', 'Z2', 3, third, 30) },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1'), ...swimBlock(pc, 'easy', 'Z1', 200) },
      ]
      : [
        { label: 'Warm-up 300 m', detail: swimDetail(pc, 'easy', 'Z2'), ...swimBlock(pc, 'easy', 'Z2', 300) },
        { label: (reps * 100) + ' m continuous', detail: swimDetail(pc, type === 'Race Pace' ? 'css' : 'steady', type === 'Race Pace' ? 'Z4' : 'Z2'), ...swimBlock(pc, type === 'Race Pace' ? 'css' : 'steady', type === 'Race Pace' ? 'Z4' : 'Z2', reps * 100) },
        { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1'), ...swimBlock(pc, 'easy', 'Z1', 200) },
      ];
    if (type === 'Endurance' && v(2) === 1) main = third * 3;
  }
  const dist = swimDistance(segs); // exact: summed prescribed metres, not a flat overhead guess
  return { title: title, segments: segs, distance: dist, unit: 'km' };
}

// The peak run-off-the-bike anchor scales to the race: sprint/olympic race runs
// sit near threshold, half/t100 at tempo, an Ironman run is aerobic — threshold
// off the bike on a long-course peak brick is the over-fatigue risk the audit
// flagged, and "race pace" now means it at every distance.
const RACE_RUN_ANCHOR = {
  sprint: { key: 'threshold', zone: 'Z4' }, olympic: { key: 'threshold', zone: 'Z4' },
  half: { key: 'tempo', zone: 'Z3' }, t100: { key: 'tempo', zone: 'Z3' },
  full: { key: 'long', zone: 'Z2' }, maintenance: { key: 'tempo', zone: 'Z3' },
};
function buildBrick(dur, pc, phase, seed, raceType) {
  const v = (seed || 0) % 3;
  const base = phase === 'Base' || phase === 'Maintain', peak = phase === 'Peak';
  const bikeMin = Math.round(dur * (peak ? 0.62 : 0.7));   // more run off the bike at peak
  const runMin = dur - bikeMin;
  const t2 = { label: 'T2 — quick transition', detail: 'Rack bike, shoes on, < 60 s' };
  let segs;
  if (v === 1) {
    // race-sim: effort blocks on the bike, then hold form off it
    segs = [
      { label: base ? 'Bike — steady with 2 × 8 min upper Z2' : 'Bike — steady with 3 × 8 min at race effort', min: bikeMin,
        detail: bikeDetail(pc, base ? 0.65 : 0.78, base ? 0.75 : 0.9, base ? 'Z2' : 'Z3'), zone: base ? 'Z2' : 'Z3' },
      t2,
      { label: 'Run off the bike — negative split', min: runMin,
        detail: runDetail(pc, base ? 'easy' : 'tempo', base ? 'Z2' : 'Z3'), zone: base ? 'Z2' : 'Z3' },
    ];
  } else if (v === 2) {
    // double transition: two shorter rounds, twice the T2 practice
    const bike1 = Math.round(dur * 0.35), run1 = Math.round(dur * 0.15);
    segs = [
      { label: 'Round 1 — bike', min: bike1, detail: bikeDetail(pc, base ? 0.6 : 0.72, base ? 0.75 : 0.85, base ? 'Z2' : 'Z3'), zone: base ? 'Z2' : 'Z3' },
      t2,
      { label: 'Round 1 — run off the bike', min: run1, detail: runDetail(pc, base ? 'easy' : 'tempo', base ? 'Z2' : 'Z3'), zone: base ? 'Z2' : 'Z3' },
      { label: 'Round 2 — bike', min: bike1, detail: bikeDetail(pc, base ? 0.6 : 0.72, base ? 0.75 : 0.85, base ? 'Z2' : 'Z3'), zone: base ? 'Z2' : 'Z3' },
      t2,
      { label: 'Round 2 — run off the bike', min: dur - 2 * bike1 - run1, detail: runDetail(pc, base ? 'easy' : 'tempo', base ? 'Z2' : 'Z3'), zone: base ? 'Z2' : 'Z3' },
    ];
  } else {
    segs = [
      { label: base ? 'Bike — steady aerobic' : 'Bike — build to race effort', min: bikeMin,
        detail: bikeDetail(pc, base ? 0.6 : 0.72, base ? 0.75 : 0.88, base ? 'Z2' : 'Z3'), zone: base ? 'Z2' : 'Z3' },
      t2,
      base
        ? { label: 'Run off the bike — easy', min: runMin, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' }
        : peak
          ? (a => ({ label: 'Run off the bike — race pace', min: runMin, detail: runDetail(pc, a.key, a.zone), zone: a.zone }))(RACE_RUN_ANCHOR[raceType] || RACE_RUN_ANCHOR.olympic)
          : { label: 'Run off the bike — tempo', min: runMin, detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3' },
    ];
  }
  return { title: 'Brick', segments: segs, distance: null, unit: 'km' };
}

// Strength session — durability, power and injury resistance (Base/Build only).
function buildStrength(phase) {
  const base = phase === 'Base';
  return {
    title: 'Strength', durationMin: base ? 40 : 35, distance: null, unit: '',
    segments: [
      { label: 'Mobility & activation', min: 8, detail: 'Hips, ankles, glutes & core switch-on' },
      base
        ? { label: 'Foundation circuit · 3 rounds', min: 24, detail: 'Goblet squat, Romanian deadlift, split squat, push-up — 12–15 reps' }
        : { label: 'Strength · 4 sets', min: 20, detail: 'Back squat, deadlift, single-leg work — 5–8 strong reps, full recovery' },
      { label: 'Core & balance', min: base ? 8 : 7, detail: 'Plank & side plank, dead bug, single-leg balance' },
    ],
  };
}

// Benchmark fitness tests — the athlete logs the result to re-target paces/power.
function buildTest(kind, pc) {
  if (kind === 'run5k') {
    return {
      title: 'Fitness Test · 5k Run', durationMin: 45, distance: 5, unit: 'km',
      segments: [
        { label: 'Warm-up', min: 15, detail: runDetail(pc, 'easy', 'Z2') + ' + 3 × 20 s strides' },
        { label: '5 km time trial — all out', min: 22, detail: 'Even effort, finish hard. Note your finish time.' },
        { label: 'Cool-down', min: 8, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ],
      note: 'Enter your 5k time in Update fitness to re-target your run paces.',
    };
  }
  if (kind === 'bikeFtp') {
    return {
      title: 'Fitness Test · Bike FTP', durationMin: 60, distance: null, unit: 'km',
      segments: [
        { label: 'Warm-up', min: 18, detail: 'Build + 3 × 1 min fast spins' },
        { label: '20 min time trial — max sustainable', min: 20, detail: 'Hold the hardest steady power you can hold for 20 min.' },
        { label: 'Cool-down', min: 22, detail: 'Easy spin' },
      ],
      note: 'FTP ≈ 95% of your 20-min average power. Enter it in Update fitness.',
    };
  }
  // swimCss
  return {
    title: 'Fitness Test · Swim CSS', durationMin: 45, distance: 1.4, unit: 'km',
    segments: [
      { label: 'Warm-up 400 m', detail: swimDetail(pc, 'easy', 'Z2') },
      { label: '400 m time trial — all out', detail: 'Note your time (T400).' },
      { label: 'Easy 200 m', detail: 'Recover fully.' },
      { label: '200 m time trial — all out', detail: 'Note your time (T200).' },
      { label: 'Cool-down 200 m', detail: swimDetail(pc, 'easy', 'Z1') },
    ],
    note: 'CSS pace per 100 m = (T400 − T200) ÷ 2. Enter it in Update fitness.',
  };
}

const TEST_ROTATION = ['run5k', 'bikeFtp', 'swimCss'];
const TEST_DISC = { run5k: 'run', bikeFtp: 'bike', swimCss: 'swim' };

/* ---- base session durations (minutes, intermediate athlete) ---- */
const LONG_RUN = { sprint: 55, olympic: 70, half: 95, t100: 100, full: 120, maintenance: 70 };
const LONG_BIKE = { sprint: 70, olympic: 100, half: 160, t100: 170, full: 210, maintenance: 100 };
const LONG_BRICK = { sprint: 70, olympic: 95, half: 135, t100: 145, full: 165, maintenance: 90 };

const TEMPLATES = {
  3: ['swim:quality', 'bike:long', 'run:long'],
  4: ['swim:easy', 'bike:quality', 'run:quality', 'brick:long'],
  5: ['swim:easy', 'run:quality', 'bike:quality', 'run:long', 'bike:long'],
  6: ['swim:easy', 'run:quality', 'bike:quality', 'swim:quality', 'run:long', 'bike:long'],
  7: ['swim:easy', 'run:quality', 'bike:quality', 'swim:quality', 'run:long', 'bike:long', 'brick:long'],
};

// preferred weekdays (0=Mon..6=Sun): quality midweek, long on weekend
const WEEKDAY_ORDER = [1, 3, 0, 2, 4]; // Tue, Thu, Mon, Wed, Fri
const WEEKEND = [5, 6];                 // Sat, Sun

// Quality-session ladders, easiest → hardest. The chosen rung = phase position
// (Base 0, Build 1, Peak/Taper 2) shifted by the athlete's intensity level, so a
// beginner trains one rung easier and an elite two rungs harder for the same week.
const INTENSITY_LADDER = {
  run:  ['Easy', 'Fartlek', 'Tempo', 'Threshold', 'VO2 Intervals'],
  bike: ['Endurance', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'],
  swim: ['Technique', 'Endurance', 'CSS Intervals', 'Race Pace'],
};
// Anchor each phase onto the ladder so the intermediate athlete keeps the
// classic Base → Build → Peak arc (easy end → mid → race-specific) while the
// intensity level (−1 beginner … +2 elite) spreads across the extra rungs:
// beginners get structured play (Fartlek / Tempo Ride) instead of jumping
// straight to hard reps, elites top out at VO2 on the bike too.
const LADDER_ANCHOR = { Base: 0, Build: 2, Peak: 3, Maintain: 1 };
function typeFor(discipline, role, phase, isRecovery, intensity) {
  if (role === 'long') return 'Long';
  if (role === 'brick') return 'Brick';
  // Peak swims become race-specific open-water sessions (any role, but not recovery weeks).
  if (discipline === 'swim' && phase === 'Peak' && !isRecovery) return 'Open Water';
  if (role === 'easy') return discipline === 'swim' ? 'Technique' : 'Easy';
  // role === 'quality'
  if (isRecovery) return discipline === 'swim' ? 'Technique' : (discipline === 'bike' ? 'Endurance' : 'Easy');
  const ladder = INTENSITY_LADDER[discipline] || ['Easy'];
  const anchor = LADDER_ANCHOR[phase] != null ? LADDER_ANCHOR[phase] : LADDER_ANCHOR.Peak;
  const idx = clamp(anchor + (intensity || 0), 0, ladder.length - 1);
  return ladder[idx];
}

function baseDuration(discipline, role, race) {
  if (role === 'brick') return LONG_BRICK[race];
  if (role === 'long') return discipline === 'bike' ? LONG_BIKE[race] : (discipline === 'run' ? LONG_RUN[race] : 60);
  if (discipline === 'swim') return role === 'easy' ? 35 : 45;
  if (discipline === 'run') return 50;
  if (discipline === 'bike') return 55;
  return 40;
}

// intensity (the athlete's fitness-level dial, −1 beginner … +2 elite) gates the
// durability finish; derive it from the profile at every call site so a rebuilt
// session keeps the same variant as the one it replaces.
function intensityOf(profile) {
  return (FITNESS[profile && profile.fitness] || FITNESS.intermediate).intensity;
}
function buildWorkout(discipline, type, dur, pc, phase, seed, intensity = 0, raceType) {
  if (discipline === 'run') return buildRun(type, dur, pc, seed, phase, intensity);
  if (discipline === 'bike') return buildBike(type, dur, pc, seed, phase, intensity);
  if (discipline === 'swim') return buildSwim(type, dur, pc, seed);
  if (discipline === 'brick') return buildBrick(dur, pc, phase, seed, raceType);
  if (discipline === 'strength') return buildStrength(phase);
  return { title: 'Session', segments: [], distance: null, unit: '' };
}

// Readiness-driven downgrade: turn a hard session into easy aerobic of the same
// discipline at reduced volume. Keeps the workout id/date so logs & moves still apply.
export const easeWorkout = function (w, plan) {
  const disc = w.discipline;
  if (disc !== 'run' && disc !== 'bike' && disc !== 'swim') return w;
  const easyType = disc === 'swim' ? 'Technique' : (disc === 'bike' ? 'Endurance' : 'Easy');
  const dur = Math.max(25, round5(w.durationMin * 0.65));
  const built = buildWorkout(disc, easyType, dur, plan.paces, w.phase, w.seed != null ? w.seed : w.week, intensityOf(plan.profile));
  return Object.assign({}, w, {
    type: easyType, title: built.title, durationMin: dur,
    distance: built.distance, unit: built.unit, segments: built.segments,
    eased: true, easedFrom: w.type, key: false,
  });
};

// Ramp-guardrail downgrade (Phase 2, docs/ADAPTIVE_ENGINE.md): reduce a session's
// volume without changing its character. Same type, rebuilt at factor × duration
// (floor 20 min) so title/distance/segments stay coherent; the key flag survives —
// a trimmed key session is still the week's key session.
export const trimWorkout = function (w, plan, factor) {
  const disc = w.discipline;
  if (disc !== 'run' && disc !== 'bike' && disc !== 'swim') return w;
  const dur = Math.max(20, round5(w.durationMin * factor));
  if (dur >= w.durationMin) return w;
  const built = buildWorkout(disc, w.type, dur, plan.paces, w.phase, w.seed != null ? w.seed : w.week, intensityOf(plan.profile));
  return Object.assign({}, w, {
    title: built.title, durationMin: dur,
    distance: built.distance, unit: built.unit, segments: built.segments,
    trimmed: true, trimmedFrom: w.durationMin,
  });
};

// The opposite nudge (Phase 3, rule F2): grow a session's volume when the load
// isn't sufficient to drive adaptation. Same rebuild mechanics as trimWorkout.
export const boostWorkout = function (w, plan, factor) {
  const disc = w.discipline;
  if (disc !== 'run' && disc !== 'bike' && disc !== 'swim') return w;
  const dur = round5(w.durationMin * factor);
  if (dur <= w.durationMin) return w;
  const built = buildWorkout(disc, w.type, dur, plan.paces, w.phase, w.seed != null ? w.seed : w.week, intensityOf(plan.profile));
  return Object.assign({}, w, {
    title: built.title, durationMin: dur,
    distance: built.distance, unit: built.unit, segments: built.segments,
    boosted: true, boostedFrom: w.durationMin,
  });
};

/* ---- user-added sessions (outside the generated plan) ---- */

// Build an ad-hoc session from the same library and slot it into the week that
// owns its date, flagged custom. It becomes a first-class plan workout: the
// log, calendar, training-load estimates, watch push and the adaptive engine
// all see it. Returns the new plan plus the workout for follow-up UI.
export const addCustomWorkout = function (plan, { discipline, type, durationMin, dateISO }) {
  const wk = plan.weeks.find(w => dateISO >= w.start && dateISO <= iso(addDays(w.start, 6)))
    || plan.weeks[plan.weeks.length - 1];
  const seed = wk.isRecovery ? 0 : wk.index;
  const built = buildWorkout(discipline, type, durationMin, plan.paces, wk.phase, seed, intensityOf(plan.profile), plan.profile.raceType);
  const dur = built.durationMin || durationMin; // strength fixes its own length
  const key = 'x-' + dateISO.split('-').join('');
  const taken = new Set(wk.workouts.map(x => x.id));
  let n = 0;
  while (taken.has(key + '-' + n)) n++;
  const workout = {
    id: key + '-' + n, week: wk.index, seed: seed, phase: wk.phase, date: dateISO,
    discipline: discipline, role: 'custom', type: type, title: built.title,
    durationMin: dur, distance: built.distance, unit: built.unit,
    segments: built.segments, custom: true,
  };
  const weeks = plan.weeks.map(w => w.index !== wk.index ? w
    : Object.assign({}, w, { workouts: w.workouts.concat([workout]), totalMin: w.totalMin + dur }));
  return { plan: Object.assign({}, plan, { weeks: weeks }), workout: workout };
};

// Take a user-added session out again (plan-generated sessions are never removable).
export const removeCustomWorkout = function (plan, id) {
  const weeks = plan.weeks.map(w => {
    const target = w.workouts.find(x => x.id === id && x.custom);
    if (!target) return w;
    return Object.assign({}, w, {
      workouts: w.workouts.filter(x => x.id !== id),
      totalMin: w.totalMin - (target.durationMin || 0),
    });
  });
  return Object.assign({}, plan, { weeks: weeks });
};

// Has this plan run past its last day? The default-to-no-plan rule
// (docs/NO_PLAN_FLOW.md): a finished plan ends into tracker mode unless the
// user starts a new one. Deterministic from the plan itself — every device
// reaches the same answer without coordination — and false while ANY plan day
// remains. Race plans generated since 2026-07-14 END with a scheduled
// recovery week (Jon: the week after race day belongs to the plan — recover
// first, decide later), so once that week is over the plan is over: no grace.
// LEGACY race plans (cached before the scheduled week existed — their last
// week is race week, not a recovery week) keep a seven-day grace so the
// post-race congratulations banner still gets its window. Maintenance needs
// none: its banner runs for the two weeks before the horizon.
const POST_RACE_GRACE_DAYS = 7;
export const planEnded = function (plan, todayISO) {
  if (!plan || plan.race === 'tracker' || !Array.isArray(plan.weeks) || !plan.weeks.length) return false;
  const race = RACES[plan.race];
  const lastWeek = plan.weeks[plan.weeks.length - 1];
  const grace = race && !race.noRace && !lastWeek.isRecovery ? POST_RACE_GRACE_DAYS : 0;
  return todayISO > iso(addDays(lastWeek.start, 6 + grace));
};

// The tracker sentinel: a plan with no weeks, carrying the athlete's profile
// (fitness history, paces, dials) forward so the next plan and the progress
// trend survive when they end this one. race:'tracker' is the sole predicate
// for the app's no-plan / tracker-only mode; raceDate is nulled so nothing
// counts down to a race that no longer exists.
export const buildTrackerPlan = function (plan, nowISO) {
  return {
    profile: Object.assign({}, plan.profile, { raceDate: null }),
    race: 'tracker',
    createdAt: plan.createdAt,
    updatedAt: nowISO,
    totalWeeks: 0,
    paces: plan.paces,
    weeks: [],
  };
};

// Tracker-safe fitness update: a benchmark between plans (a parkrun IS a 5k
// test) must be recordable without generating a plan. Same contract as a
// retarget — snapshot the OLD baselines into fitnessHistory, merge the new
// fields, recompute paces so recap/review verdicts judge against the new
// numbers — but the sentinel stays a sentinel: race 'tracker', zero weeks.
export const applyTrackerFitness = function (plan, fields, nowISO) {
  const old = plan.profile;
  // Local calendar day, matching retarget's snapshot convention (iso(), not the
  // UTC slice of the timestamp — they differ around midnight).
  const snapshot = { date: iso(new Date(nowISO)), fivekSec: old.fivekSec, css100Sec: old.css100Sec, ftp: old.ftp, fitness: old.fitness };
  // fitnessUpdatedAt lives on the PROFILE (stored verbatim as ProfileJson, so it
  // survives the server round-trip; a top-level plan field would be dropped by
  // toClientState). It exists so Settings can attribute "Fitness updated" to a
  // real update — plan.updatedAt also moves on mere tracker entry.
  const profile = Object.assign({}, old, fields, {
    fitnessHistory: (old.fitnessHistory || []).concat([snapshot]),
    fitnessUpdatedAt: nowISO,
  });
  return Object.assign({}, plan, { profile: profile, paces: computePaces(profile), updatedAt: nowISO });
};

// Bring a cached plan up to the current library schema: segments gained
// zone/blocks data (workout profiles) after older plans were generated.
// Pre-variant plans were built entirely from the canonical templates, so the
// rebuild pins seed 0 unless the workout recorded one — the same shape comes
// back, now carrying the profile data. Race days, tests and anything already
// current are left alone; the whole pass is a no-op on an up-to-date plan.
export const upgradePlanSegments = function (plan) {
  if (!plan || !plan.weeks || !plan.paces) return plan;
  let changed = false;
  const weeks = plan.weeks.map(week => {
    const workouts = week.workouts.map(w => {
      if (w.race || w.test || w.discipline === 'rest' || !w.durationMin) return w;
      const segsNow = w.segments || [];
      // Staleness signal (no schema field): a run/bike session whose segments
      // do not sum to its durationMin drifted under the old sizing, so re-derive
      // it — the fitted rebuild sums to durationMin (repairing the card/watch
      // disagreement and any trim the old builder silently defeated). Swim time
      // is a metre-derived estimate, so it is exempt.
      const driftsRunBike = (w.discipline === 'run' || w.discipline === 'bike')
        && Math.abs(sumMinutes(segsNow) - w.durationMin) > 1.01;
      // A brick always sums (it is a dur split), so it needs its own staleness
      // check: a Peak brick built before the race-scaled anchor still runs its
      // "race pace" leg at the old zone. Re-derive it to the current anchor.
      const brickStale = w.discipline === 'brick' && w.phase === 'Peak'
        && segsNow.some(s => /race pace/i.test(s.label || '')
          && s.zone !== (RACE_RUN_ANCHOR[plan.profile.raceType] || RACE_RUN_ANCHOR.olympic).zone);
      const current = segsNow.some(s => s.zone || s.blocks)
        && !(w.discipline === 'swim' && segsNow.some(s => s.blocks && !s.swim))
        && !driftsRunBike && !brickStale;
      if (current) return w;
      const built = buildWorkout(w.discipline, w.type, w.durationMin, plan.paces, w.phase, w.seed != null ? w.seed : 0, intensityOf(plan.profile), plan.profile.raceType);
      if (!(built.segments || []).some(s => s.zone || s.blocks)) return w; // swims/strength stay as they are
      changed = true;
      return Object.assign({}, w, { segments: built.segments, distance: built.distance });
    });
    return Object.assign({}, week, { workouts: workouts });
  });
  return changed ? Object.assign({}, plan, { weeks: weeks }) : plan;
};

/* ---- phase plan across the whole block ---- */
function computePhases(totalWeeks, taperWeeks) {
  const taper = Math.min(taperWeeks, Math.max(1, totalWeeks - 3));
  const remaining = totalWeeks - taper;
  let peak = Math.max(1, Math.round(remaining * 0.2));
  let build = Math.max(1, Math.round(remaining * 0.4));
  let base = remaining - peak - build;
  // Shrink Build then Peak until Base has at least one week. The guard stops a
  // runaway loop if the duration constants ever change so neither can shrink.
  let guard = 0;
  while (base < 1 && guard++ < 100) { if (build > 1) build--; else if (peak > 1) peak--; else break; base = remaining - peak - build; }
  const phases = [];
  for (let i = 0; i < base; i++) phases.push('Base');
  for (let i = 0; i < build; i++) phases.push('Build');
  for (let i = 0; i < peak; i++) phases.push('Peak');
  for (let i = 0; i < taper; i++) phases.push('Taper');
  return phases;
}

function loadFactor(phase, posInPhase, lenPhase) {
  const frac = lenPhase > 1 ? posInPhase / (lenPhase - 1) : 0;
  if (phase === 'Base') return lerp(0.82, 1.0, frac);
  if (phase === 'Build') return lerp(1.0, 1.12, frac);
  if (phase === 'Peak') return lerp(1.12, 1.18, frac);
  if (phase === 'Taper') return lenPhase === 2 ? (posInPhase === 0 ? 0.8 : 0.55) : 0.55;
  if (phase === 'Maintain') return 0.95; // steady keep-fit volume; recovery weeks make the dips
  return 1.0;
}

/* ---- main entry ---- */
export const generatePlan = function (profile) {
  const race = RACES[profile.raceType];
  const fitness = FITNESS[profile.fitness] || FITNESS.intermediate;
  const pc = computePaces(profile);

  const weekStart0 = startOfWeekMonday(profile.startDate || new Date());
  // Whole weeks from the start Monday THROUGH the race's own week, so race day
  // always lands inside the plan. (Math.round(weeksBetween) truncated a race
  // that fell more than half a week past the last Monday — e.g. the default
  // 84-days-out date on a mid-week start — leaving race day unmarked.)
  // Duration bounds are per race (RACES.minWeeks/maxWeeks). Over max, the
  // plan opens with a Maintain lead-in until the build window begins — race
  // day is always reachable. Under min it is a compressed sharpen-and-arrive
  // plan, flagged so the UI can say so. Maintenance plans are a rolling
  // keep-fit block: every week is Maintain, no race day, horizonWeeks long.
  const maintenance = !!race.noRace;
  let totalWeeks, leadIn = 0, shortRunway = false;
  if (maintenance) {
    totalWeeks = clamp(profile.horizonWeeks || 12, race.minWeeks, race.maxWeeks);
  } else {
    totalWeeks = Math.ceil((daysBetween(weekStart0, profile.raceDate) + 1) / 7);
    totalWeeks = clamp(totalWeeks, 4, 52);
    if (totalWeeks > race.maxWeeks) leadIn = totalWeeks - race.maxWeeks;
    shortRunway = totalWeeks < race.minWeeks;
  }

  // Every race plan ends with a SCHEDULED recovery week after race week (Jon,
  // 2026-07-14): a week of short easy sessions, then the plan is over and the
  // app defaults to tracker mode. buildWeeks = the build-through-race portion;
  // the recovery week is appended after it. Phase is 'Maintain' (the backend's
  // phase catalog has no 'Recovery') with isRecovery carrying the semantics.
  // Appended only while the total stays inside the backend's 40-week cap (a
  // 40-week build previously saved fine and must keep saving); past that the
  // plan behaves like a legacy one — planEnded's post-race grace covers the
  // recovery window instead. The 41..52-week band was ALREADY rejected by the
  // backend before this feature (frontend clamps at 52, the server at 40) — a
  // pre-existing gap, tracked for the backend, not widened here.
  const buildWeeks = totalWeeks;
  const raceRecovery = !maintenance && buildWeeks < 40;
  if (raceRecovery) totalWeeks = buildWeeks + 1;

  const phases = maintenance
    ? Array.from({ length: totalWeeks }, () => 'Maintain')
    : Array.from({ length: leadIn }, () => 'Maintain')
      .concat(computePhases(buildWeeks - leadIn, race.taperWeeks))
      .concat(raceRecovery ? ['Maintain'] : []);
  // Scheduling preference: explicit training weekdays (0=Mon..6=Sun) + a long-session
  // day. Falls back to the legacy fixed layout when a profile predates the preference.
  const prefDays = (profile.trainingDays && profile.trainingDays.length >= 3)
    ? profile.trainingDays.slice().sort((a, b) => a - b) : null;
  const days = prefDays ? prefDays.length : profile.daysPerWeek;
  const template = TEMPLATES[clamp(days, 3, 7)];
  let longDay = profile.longDay;
  if (prefDays && (longDay === undefined || prefDays.indexOf(longDay) < 0)) {
    longDay = prefDays.indexOf(5) >= 0 ? 5 : (prefDays.indexOf(6) >= 0 ? 6 : prefDays[prefDays.length - 1]);
  }

  // Weakest-link bias, derived deterministically from the profile's own
  // baselines (see lib/weakest.js) — {} when the sports are balanced or the
  // data can't say.
  const bias = weakBias(profile);

  // phase position bookkeeping
  const phaseLen = {}, phasePos = {};
  phases.forEach(p => { phaseLen[p] = (phaseLen[p] || 0) + 1; });

  // Place up to 3 benchmark tests (run → bike → swim) spread across the Base/Build
  // weeks — never on recovery / Peak / Taper — so paces recalibrate as fitness grows.
  const eligibleTestWeeks = [];
  for (let w = 0; w < buildWeeks; w++) { // never in the post-race recovery week
    const ph = phases[w];
    // buildWeeks, NOT totalWeeks: the appended recovery week inflated the
    // boundary by one and let the periodic step-back land on the final Peak
    // week, silently deloading the sharpening week (re-verify catch).
    const rec = ((w + 1) % fitness.recoveryEvery === 0) && ph !== 'Taper' && w < buildWeeks - 2;
    if ((ph === 'Base' || ph === 'Build' || ph === 'Maintain') && !rec && w >= 1) eligibleTestWeeks.push(w);
  }
  const testByWeek = {};
  const nTests = Math.min(TEST_ROTATION.length, eligibleTestWeeks.length);
  for (let i = 0; i < nTests; i++) {
    const pos = nTests === 1 ? Math.floor(eligibleTestWeeks.length / 2)
      : Math.round((i + 0.5) / nTests * (eligibleTestWeeks.length - 1));
    testByWeek[eligibleTestWeeks[pos]] = TEST_ROTATION[i];
  }

  const weeks = [];
  for (let w = 0; w < totalWeeks; w++) {
    const phase = phases[w];
    // The appended post-race recovery week: everything easy, race-week legs.
    const postRaceWeek = raceRecovery && w === buildWeeks;
    phasePos[phase] = phasePos[phase] === undefined ? 0 : phasePos[phase] + 1;
    const isRecovery = postRaceWeek || (profile.postRace && w === 0)
      || (((w + 1) % fitness.recoveryEvery === 0) && phase !== 'Taper' && w < buildWeeks - 2); // buildWeeks: see the eligibleTestWeeks note
    let load = loadFactor(phase, phasePos[phase], phaseLen[phase]) * fitness.factor;
    if (isRecovery) load *= fitness.recoveryDepth;
    // Post-race legs want less than a mid-plan step-back: flat recovery volume,
    // off the periodization curve entirely.
    if (postRaceWeek) load = fitness.factor * fitness.recoveryDepth * 0.8;

    const testKind = testByWeek[w] || null;

    // split template into weekend (long/brick) vs weekday slots. The post-race
    // week keeps the athlete's weekly rhythm but every slot becomes an easy
    // session: no longs, no bricks, no quality — just moving again. Slots go
    // through role 'quality' because typeFor's recovery branch maps that to
    // the gentle type per discipline (Technique/Endurance/Easy) — role 'easy'
    // would hand the bike a type buildBike has no branch for.
    const longs = [], mids = [];
    template.forEach(tok => {
      const [disc, role] = tok.split(':');
      if (postRaceWeek) {
        mids.push({ disc: disc === 'brick' ? 'bike' : disc, role: 'quality' });
        return;
      }
      (role === 'long' || role === 'brick' ? longs : mids).push({ disc, role });
    });

    const dayMap = {}; // weekday index -> slot
    if (prefDays) {
      // Long/brick → the preferred long day first, then other weekend days, then weekdays.
      const isWknd = d => d >= 5;
      const longSlots = [longDay]
        .concat(prefDays.filter(d => d !== longDay && isWknd(d)))
        .concat(prefDays.filter(d => d !== longDay && !isWknd(d)));
      const used = {};
      longs.forEach((s, i) => { const d = longSlots[i]; if (d !== undefined) { dayMap[d] = s; used[d] = 1; } });
      const midSlots = prefDays.filter(d => !used[d]);
      mids.forEach((s, i) => { const d = midSlots[i]; if (d !== undefined) dayMap[d] = s; });
    } else {
      const weekdayQueue = WEEKDAY_ORDER.slice();
      // Long/brick sessions take the weekend first; any overflow spills onto a weekday.
      longs.forEach((s, i) => {
        if (WEEKEND[i] !== undefined) dayMap[WEEKEND[i]] = s;
        else { const wd = weekdayQueue.shift(); if (wd !== undefined) dayMap[wd] = s; }
      });
      mids.forEach(s => { const wd = weekdayQueue.shift(); if (wd !== undefined) dayMap[wd] = s; });
    }

    const workouts = [];
    for (let d = 0; d < 7; d++) {
      const date = iso(addDays(weekStart0, w * 7 + d));
      const s = dayMap[d];
      if (!s) {
        workouts.push({ id: w + '-' + d, week: w, phase: phase, date: date, discipline: 'rest', type: 'Rest', title: 'Rest', durationMin: 0, segments: [], distance: null });
        continue;
      }
      const type = typeFor(s.disc, s.role, phase, isRecovery, fitness.intensity);
      // Lead-in Maintain weeks hold fitness, they don't rehearse the race:
      // long sessions cap at maintenance scale (a far-out full would otherwise
      // spend months on 3h+ "maintenance" rides). Standalone maintenance and
      // build phases use their own tables directly.
      const raceScale = baseDuration(s.disc, s.role, race.key);
      const durBase = phase === 'Maintain' && !maintenance
        ? Math.min(raceScale, baseDuration(s.disc, s.role, 'maintenance'))
        : raceScale;
      // Weakest-link bias: the limiting sport earns extra time while building;
      // Peak and Taper keep their race-specific shape untouched.
      // No weakest-link bias in the post-race recovery week: recovery is even
      // by definition — the limiter gets its extra time while building.
      const wb = !postRaceWeek && (phase === 'Base' || phase === 'Build' || phase === 'Maintain') && bias[s.disc] ? bias[s.disc] : 1;
      const dur = round5(durBase * load * wb);
      // Recovery weeks pin the canonical format; every other week rotates.
      const seed = isRecovery ? 0 : w;
      const built = buildWorkout(s.disc, type, dur, pc, phase, seed, fitness.intensity, profile.raceType);
      workouts.push({
        id: w + '-' + d, week: w, phase: phase, date: date, seed: seed,
        discipline: s.disc, role: s.role, type: type, title: built.title,
        durationMin: dur, distance: built.distance, unit: built.unit,
        segments: built.segments, key: s.role === 'long' || s.role === 'brick',
      });
    }

    // mark race day (replace that day's workout) — maintenance has none
    const raceISO = maintenance ? null : iso(profile.raceDate);
    workouts.forEach((wo, i) => {
      if (wo.date === raceISO) {
        workouts[i] = {
          id: wo.id, week: w, phase: 'Taper', date: raceISO, discipline: 'brick',
          type: 'RACE', title: 'RACE DAY — ' + race.name, durationMin: 0, distance: null, unit: '',
          segments: [
            { label: 'Swim ' + race.swim + ' km', detail: 'Steady, sight often, settle into rhythm' },
            { label: 'Bike ' + race.bike + ' km', detail: 'Hold race watts, fuel every 20 min' },
            { label: 'Run ' + race.run + ' km', detail: 'Negative split, finish strong' },
          ], race: true, key: true,
        };
      }
    });

    // Inject the scheduled benchmark test, replacing that discipline's session
    // for the week (keeps the workout id stable so logs/moves still apply).
    if (testKind) {
      const disc = TEST_DISC[testKind];
      let ti = workouts.findIndex(x => x.discipline === disc && x.role === 'quality');
      if (ti < 0) ti = workouts.findIndex(x => x.discipline === disc && !x.race);
      if (ti >= 0) {
        const built = buildTest(testKind, pc);
        workouts[ti] = Object.assign({}, workouts[ti], {
          type: 'Test', title: built.title, durationMin: built.durationMin,
          distance: built.distance, unit: built.unit, segments: built.segments,
          test: true, testKind: testKind, note: built.note, key: true,
        });
      }
    }

    // Add a strength session during Base/Build, stacked as a second session ("double")
    // on the hardest training day — so easy days and (chosen) rest days stay easy/rest.
    if (phase === 'Base' || phase === 'Build') {
      const built = buildStrength(phase);
      const HARD = { 'Fartlek': 2, 'Tempo': 3, 'Threshold': 4, 'VO2 Intervals': 5, 'Sweet Spot': 3, 'CSS Intervals': 3, 'Race Pace': 4 };
      const score = x => (HARD[x.type] || 0) + (x.role === 'quality' ? 1 : 0);
      const hosts = workouts.filter(x => x.discipline !== 'rest' && !x.race && !x.test && x.role !== 'long' && x.discipline !== 'brick');
      hosts.sort((a, b) => score(b) - score(a) || b.durationMin - a.durationMin);
      const host = hosts[0];
      if (host) workouts.push({
        id: w + '-' + host.id.split('-')[1] + '-1', week: w, phase: phase, date: host.date,
        discipline: 'strength', role: 'strength', type: 'Strength', title: built.title,
        durationMin: built.durationMin, distance: null, unit: '', segments: built.segments, second: true,
      });
    }

    const totalMin = workouts.reduce((a, b) => a + (b.durationMin || 0), 0);
    weeks.push({ index: w, phase: phase, isRecovery: isRecovery, start: iso(addDays(weekStart0, w * 7)), totalMin: totalMin, workouts: workouts });
  }

  // Tune-up (B) races: drop each valid one onto its calendar day (replacing
  // whatever was planned there — a rest day included; racing IS the session),
  // then shape the approach and the exit: the two days before ease to the
  // gentlest format at reduced volume (a mini-taper), the day after likewise
  // (recovery). Validity: inside the plan, and — when there is a goal race —
  // at least 10 days before it, so the real taper is never disturbed. Invalid
  // entries are ignored rather than fatal. This pass runs across week
  // boundaries, which is why it happens after the week loop.
  const bValid = (Array.isArray(profile.bRaces) ? profile.bRaces : [])
    .filter(b => b && b.date && B_RACES[b.kind])
    .filter(b => b.date >= iso(weekStart0) && b.date <= iso(addDays(weekStart0, totalWeeks * 7 - 1)))
    .filter(b => maintenance || daysBetween(b.date, iso(profile.raceDate)) >= 10);
  if (bValid.length) {
    const bByDate = {}, easeDates = new Set();
    bValid.forEach(b => {
      bByDate[b.date] = b;
      [-2, -1, 1].forEach(o => easeDates.add(iso(addDays(b.date, o))));
    });
    weeks.forEach(wk => {
      let touched = false;
      wk.workouts = wk.workouts.map(wo => {
        const b = bByDate[wo.date];
        if (b && !wo.race && !wo.second) {
          touched = true;
          const spec = B_RACES[b.kind];
          const legs = RACES[b.kind];
          const segments = legs ? [
            { label: 'Swim ' + legs.swim + ' km', detail: 'Race effort, but settle early — this is a rehearsal too' },
            { label: 'Bike ' + legs.bike + ' km', detail: 'Race watts; practise fuelling exactly as you will on the day' },
            { label: 'Run ' + legs.run + ' km', detail: 'Strong and controlled; note what the legs do off the bike' },
          ] : [
            { label: 'Warm-up', detail: '15 min easy + a few strides' },
            { label: spec.name + ' — race it', detail: 'An honest benchmark; note your finish time' },
            { label: 'Cool-down', detail: '10 min very easy' },
          ];
          return {
            id: wo.id, week: wo.week, phase: wo.phase, date: wo.date, discipline: spec.discipline,
            type: 'RACE', bRace: true, title: 'TUNE-UP — ' + spec.name,
            durationMin: spec.durationMin, distance: null, unit: '', segments: segments, key: true,
          };
        }
        if (b && wo.second) { touched = true; return null; } // no strength double on a race day
        if (easeDates.has(wo.date) && !wo.race && !wo.bRace && !wo.test
          && wo.discipline !== 'rest' && wo.discipline !== 'strength') {
          touched = true;
          const t = typeFor(wo.discipline, wo.role, wo.phase, true, fitness.intensity);
          const dur = Math.max(20, round5(wo.durationMin * 0.6));
          const built = buildWorkout(wo.discipline, t, dur, pc, wo.phase, wo.seed, fitness.intensity, profile.raceType);
          return { ...wo, type: t, title: built.title, durationMin: dur, distance: built.distance, unit: built.unit, segments: built.segments };
        }
        return wo;
      }).filter(Boolean);
      if (touched) wk.totalMin = wk.workouts.reduce((a, x) => a + (x.durationMin || 0), 0);
    });
  }

  return {
    profile: profile, race: race.key, createdAt: new Date().toISOString(),
    totalWeeks: totalWeeks, paces: pc, weeks: weeks,
    leadIn: leadIn || undefined, shortRunway: shortRunway || undefined,
  };
};
