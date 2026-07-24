/* Try — periodized plan generator + structured workout builder */
import { clamp, round5, lerp, fmtPace } from './units.js';
import { iso, addDays, startOfWeekMonday, daysBetween } from './date.js';
import { RACES, B_RACES, FITNESS, ZONES, saneWeightKg, poolFor, DEFAULT_POOL } from './domain.js';
import { roundToPoolLength, poolLabel, unitShort, poolLengthM, pacePer100ForDisplay } from './swim-units.js';
import { swimZoneTargets } from './swim-zones.js';
import { weakBias, weakestLink } from './weakest.js';
import { RIEGEL_EXP } from './runstats.js';

/* ---- paces derived from the athlete's baselines ---- */
function computePaces(profile) {
  const lvl = FITNESS[profile.fitness] || FITNESS.intermediate;
  // Use the athlete's own numbers if given, otherwise estimate from their level.
  const fivek = profile.fivekSec || lvl.est5k;
  const p = fivek / 5;                             // sec per km at 5k effort
  const css = profile.css100Sec || lvl.estCss;
  // Bike watts: the athlete's own FTP, else a level x weight estimate so a new
  // rider sees target ranges instead of RPE-only text. Converting W/kg into
  // absolute watts needs a weight, so no weight still means no watts, exactly
  // as before. The estimate lives ONLY here: profile.ftp stays null until a
  // real number arrives, because weakest.js, eftp.js, tuning.js and the
  // fitness-history trend all read profile.ftp directly and would each be
  // corrupted by a guess (design panel 2026-07-18).
  // An unusable weight means no estimate at all, rather than a confident
  // wrong number projected onto the card as a coached target (500 kg used to
  // read as a 975 W endurance ride).
  const kg = saneWeightKg(profile.weightKg);
  const ftpEstimated = !profile.ftp && !!kg;
  const ftp = profile.ftp || (ftpEstimated ? Math.round(lvl.estWkg * kg) : null);
  return {
    runEstimated: !profile.fivekSec,               // true when paces are level-based guesses
    swimEstimated: !profile.css100Sec,
    // The athlete's pool rides along so buildSwim can round lengths and label
    // in the pool's unit. Display/construction only; it never touches css.
    pool: poolFor(profile),
    ftp: ftp,
    ftpEstimated: ftpEstimated,
    // Watts per kilo, for the distance model's speed scaling. This is already
    // a ratio, so unlike ftp above it needs NO weight to be meaningful: the
    // level rung alone still tells us a beginner and an elite cover different
    // ground (gauntlet catch 2026-07-18 — tying it to weight flattened every
    // weightless plan to one speed).
    bikeWkg: profile.ftp && kg ? profile.ftp / kg : lvl.estWkg,
    // fivekPace rides along for the solo race-pace variants (Riegel needs the
    // raw 5k pace, not an offset); plans stored before it existed simply fall
    // to effort wording via the null guard in racePaceKm.
    run: { recovery: p + 85, easy: p + 70, long: p + 78, tempo: p + 35, threshold: p + 12, interval: p - 8, fivekPace: p },
    // Swim zones are defined once in swim-zones.js; pc.swim carries every
    // zone target keyed by id, plus the legacy easy/steady/fast aliases so the
    // builders and review keep reading the same keys (byte-identical values).
    swim: (() => { const z = swimZoneTargets(css); return { ...z, easy: z.technique, steady: z.aerobic, fast: z.above }; })(),
  };
}

function runDetail(pc, key, zone) {
  const z = ZONES[zone];
  if (pc.runEstimated) return '~' + fmtPace(pc.run[key]) + ' /km · ' + zone + ' · ' + z.rpe;
  return fmtPace(pc.run[key]) + ' /km · ' + zone + ' ' + z.name;
}
function swimDetail(pc, key, zone) {
  const z = ZONES[zone];
  // Pace shown per 100 of the pool's unit, so a yard card reads '/100yd' and
  // never mixes units. Identity for a metre pool ('/100m'); the stored css
  // per 100 m is untouched.
  const pool = pc.pool || DEFAULT_POOL;
  const pace = fmtPace(pacePer100ForDisplay(pc.swim[key], pool));
  const per = ' /100' + unitShort(pool) + ' · ';
  if (pc.swimEstimated) return '~' + pace + per + zone + ' · ' + z.rpe;
  return pace + per + zone;
}
function bikeDetail(pc, lo, hi, zone) {
  const z = ZONES[zone];
  // An estimated FTP keeps the RPE band alongside the watts: the numbers are a
  // starting point to ride by feel against, not a tested target.
  if (pc.ftp && pc.ftpEstimated) return '~' + Math.round(pc.ftp * lo) + '–' + Math.round(pc.ftp * hi) + ' W · ' + zone + ' · ' + z.rpe;
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
// Bike distance from the session's own zone mix, the same shape as
// runDistance: a threshold block covers more ground per minute than a
// recovery spin, so an interval session and an endurance ride of equal
// length no longer read as the same distance (they used to share one flat
// 30 km/h guess). Speeds are km/h for a rider on flat-to-rolling roads,
// scaled by the athlete's watts per kilo. Still an estimate (no terrain,
// wind, draft or position model), so callers keep distEst and the tilde.
const ZONE_KMH = { Z1: 24, Z2: 28, Z3: 32, Z4: 35, Z5: 37 };
const REF_WKG = 2.6; // the intermediate rung ZONE_KMH is written for
function bikeDistance(segs, pc) {
  const wkg = (pc && pc.bikeWkg) || REF_WKG;
  // Speed rises far more slowly than power (aerodynamic drag), so scale on a
  // cube root: double the watts per kilo is about a quarter more speed.
  const scale = Math.pow(wkg / REF_WKG, 1 / 3);
  let km = 0;
  const add = (min, zone) => { km += (min || 0) / 60 * (ZONE_KMH[zone] || ZONE_KMH.Z2) * scale; };
  segs.forEach(s => { if (s.blocks) s.blocks.forEach(b => add(b.min, b.zone)); else add(s.min, s.zone); });
  return Math.round(km);
}
function swimDistance(segs) {
  let m = 0;
  segs.forEach(s => { if (s.swim) m += s.swim.distM != null ? s.swim.distM : (s.swim.n || 0) * (s.swim.repM || 0); });
  return Math.round(m / 100) / 10;
}

// Which disciplines' distances are estimates: the bike is always modelled,
// run distance is honest only when the athlete's own 5k time anchors it, and
// swim is summed prescribed metres (exact).
function distEstFor(disc, pc) {
  if (disc === 'bike') return true;
  if (disc === 'run') return !!(pc && pc.runEstimated);
  return false;
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
  const dm = pc.pool ? roundToPoolLength(distM, pc.pool) : distM;
  return {
    blocks: [{ min: (dm / 100) * (pc.swim[key] + (restPer100 || 0)) / 60, zone: zone }],
    swim: { distM: dm, pct: Math.round(pc.swim.css / pc.swim[key] * 100) },
  };
}
function swimRep(pc, key, zone, n, repM, restSec) {
  const rm = pc.pool ? roundToPoolLength(repM, pc.pool) : repM;
  return {
    blocks: rep(n, (rm / 100) * pc.swim[key] / 60, zone, (restSec || 0) / 60, 'Z1'),
    swim: { n: n, repM: rm, restSec: restSec || 0, pct: Math.round(pc.swim.css / pc.swim[key] * 100) },
  };
}

// Race pace per km straight off the athlete's 5k pace via Riegel: pace(d) =
// p x (d/5)^(exp-1), the same projection Progress shows. Only quoted when the
// 5k is real (a projection of a guess is noise wearing a number); estimated
// paces fall silent to effort wording in the variant below.
function racePaceKm(pc, km, exp) {
  return pc.run && pc.run.fivekPace ? pc.run.fivekPace * Math.pow(km / 5, exp - 1) : null;
}

function buildRun(type, dur, pc, seed, phase, intensity = 0, raceType) {
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
    const menu = [
      [{ label: 'Steady aerobic', min: dur, detail: runDetail(pc, 'long', 'Z2'), zone: 'Z2' }],
      [
        { label: 'Steady aerobic', min: Math.max(5, dur - 15), detail: runDetail(pc, 'long', 'Z2'), zone: 'Z2' },
        { label: 'Fast finish', min: 15, detail: runDetail(pc, 'tempo', 'Z3'), zone: 'Z3' },
      ],
    ];
    if (durability) menu.push([
      { label: 'Steady aerobic', min: Math.max(5, dur - 25), detail: runDetail(pc, 'long', 'Z2'), zone: 'Z2' },
      { label: '4 × (3 min threshold / 2 min easy) — on tired legs', min: 20, detail: runDetail(pc, 'threshold', 'Z4'), zone: 'Z4', blocks: rep(4, 3, 'Z4', 2, 'Z2') },
      { label: 'Ease home', min: 5, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
    ]);
    // Distance specificity for the standalone half and marathon: the long run
    // rehearses race effort in Build and Peak. Recovery weeks pin seed 0 and
    // land on variant 0, the pure steady long, so the gate needs no recovery
    // branch. Pace is quoted (with a tilde: it is a projection) only from a
    // real 5k; estimated paces stay silent and the copy speaks in effort.
    // Race-pace details quote ONE tilde pace, the same 1.06 projection the
    // Progress tab leads with. The 1.15 marathon exponent stays a finish-time
    // bracket only: as a pace band its slow end sat below the card's own
    // steady-aerobic pace (gauntlet catch). Fallback wording per distance:
    // marathon effort sits between long and tempo pace; half effort sits at
    // tempo, and claiming otherwise contradicted the quoted number.
    let hasRacePace = false;
    if (raceType === 'runmarathon' && (phase === 'Build' || phase === 'Peak')) {
      hasRacePace = true;
      const mp = pc.runEstimated ? null : racePaceKm(pc, 42.195, RIEGEL_EXP);
      menu.push([
        { label: 'Steady aerobic', min: Math.max(5, dur - 35), detail: runDetail(pc, 'long', 'Z2'), zone: 'Z2' },
        {
          label: 'Final 35 min at your marathon effort', min: 35, zone: 'Z3',
          detail: mp ? '~' + fmtPace(mp) + ' /km · smooth and controlled'
            : 'Between your long run and tempo pace, smooth and controlled',
        },
      ]);
    } else if (raceType === 'runhalf' && (phase === 'Build' || phase === 'Peak')) {
      hasRacePace = true;
      const hp = pc.runEstimated ? null : racePaceKm(pc, 21.0975, RIEGEL_EXP);
      menu.push([
        { label: 'Steady aerobic', min: Math.max(5, dur - 35), detail: runDetail(pc, 'long', 'Z2'), zone: 'Z2' },
        {
          label: '25 min at your half marathon effort', min: 25, zone: 'Z3',
          detail: hp ? '~' + fmtPace(hp) + ' /km · settle in, do not chase it'
            : 'Around your tempo pace, controlled',
        },
        { label: 'Ease home', min: 10, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
      ]);
    }
    // The recovery-cadence selector trap, third sighting: flat seed % len
    // strands whichever slot the cadence never reaches. Beginners recover
    // every 3rd week, so their non-recovery seeds are never 2 mod 3 and a
    // flat % 3 could NEVER pick the race-pace slot (gauntlet catch). The
    // stepped walk applies whenever the race-pace variant is in the menu;
    // menus without it keep their historic selectors so triathlon and
    // 5k/10k output stays untouched.
    const s0 = seed || 0;
    segs = menu.length === 4 || (menu.length === 3 && hasRacePace)
      ? menu[(s0 + Math.floor(s0 / menu.length)) % menu.length]
      : menu[v(menu.length)];
  } else if (type === 'Easy') {
    title = 'Easy Run';
    const half = Math.round(dur / 2);
    segs = [
      [{ label: 'Relaxed', min: dur, detail: runDetail(pc, 'easy', 'Z2') + ' · quick, light steps', zone: 'Z2' }],
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
        { label: 'Settle in · relaxed', min: third, detail: runDetail(pc, 'easy', 'Z2') + ' · easy rhythm, quick turnover', zone: 'Z2' },
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
        { label: hills + ' × 75 s uphill hard · jog down', min: hills * 4, detail: 'By effort, not pace · ' + ZONES.Z5.rpe + ' · uphill pace reads slower', zone: 'Z5', terrain: 'hill', blocks: rep(hills, 1.25, 'Z5', 2.75, 'Z1') },
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
    const climbs = clamp(Math.round((dur - 25) / 7), 3, 5);
    // The hill circuit rides the same durability gate as the long run's
    // hardest variant: sustained climbing at threshold effort is a
    // Build/Peak tool with real impact load, not a Base or beginner session.
    // Long Z4 climbs, deliberately unlike VO2's short hard hills: aerobic
    // strength versus neuromuscular power (design panel 2026-07-18).
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
    ];
    // The hill circuit joins as a 4th format in Build/Peak. A 4-slot menu
    // under the 4-week recovery cadence has a structural trap: recovery weeks
    // land on (w+1) % 4 === 0 and pin seed 0, so a flat seed % 4 leaves
    // whichever variant owns slot 3 unreachable in a generated plan — first
    // the hill circuit, then, merely moved, the 12-min cruise (gauntlet and
    // re-verify catches 2026-07-18). The selector below breaks the alignment
    // instead of shuffling the victim.
    if (durability) segs.splice(2, 0, [
      { label: 'Warm-up', min: 15, detail: runDetail(pc, 'easy', 'Z2'), zone: 'Z2' },
      { label: climbs + ' × (4 min uphill at threshold effort / jog down)', min: climbs * 7, detail: 'By effort, not pace · ' + ZONES.Z4.rpe + ' · uphill pace reads slower', zone: 'Z4', terrain: 'hill', blocks: rep(climbs, 4, 'Z4', 3, 'Z1') },
      { label: 'Cool-down', min: 10, detail: runDetail(pc, 'easy', 'Z1'), zone: 'Z1' },
    ]);
    // Stepping the index one extra notch every 4 seeds walks all four slots
    // across ordinary building weeks while staying a pure, rebuild-stable
    // function of the stored seed (slot 3 lands on seeds 6, 9, 13...).
    const s0 = seed || 0;
    segs = durability ? segs[(s0 + Math.floor(s0 / 4)) % 4] : segs[v(3)];
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
  return { title: title, segments: segs, distance: bikeDistance(segs, pc), unit: 'km', distEst: true };
}

// The drill catalog Technique sessions rotate through. cue is the one thing
// to think about mid-drill; gear names the kit so a session can say up front
// what to bring; level gates the harder entries (−1 fundamentals for
// everyone, 0 standard, 1 needs an established stroke) against the athlete's
// intensity dial. Backstroke earns its place as active recovery between
// freestyle rep work, not as a scored stroke.
const SWIM_DRILLS = [
  { name: 'Catch-up', cue: 'one arm waits for the other, long body line', level: -1 },
  { name: 'Single-arm', cue: 'off arm by your side, rotate to breathe', level: -1 },
  { name: 'Scull', cue: 'slow figure-eights, feel the water on your palms', level: -1 },
  { name: 'Fingertip drag', cue: 'trail your fingertips forward, high elbow', level: -1 },
  { name: 'Kick on side', cue: 'bottom arm extended, steady relaxed kick', level: -1 },
  { name: 'Backstroke lengths', cue: 'easy backstroke, open the shoulders and reset', level: -1 },
  { name: 'Fist', cue: 'closed fists, press the water with your forearm', level: 0 },
  { name: '6-1-6', cue: 'six kicks on your side, one stroke, six more', level: 0 },
  { name: 'Doggy paddle', cue: 'head up, pull straight back under your body', level: 0 },
  { name: 'Pull buoy swim', cue: 'buoy between thighs, hips high, long strokes', gear: 'pull buoy', level: 0 },
  { name: 'Paddle pull', cue: 'firm catch, no slipping through the water', gear: 'paddles and pull buoy', level: 1 },
  { name: 'Snorkel swim', cue: 'head perfectly still, balanced stroke both sides', gear: 'centre snorkel', level: 1 },
];
// Deterministic rotation over the drills this athlete is ready for: same
// (seed, salt) means same drills, honouring the rebuild-stability contract
// every variant menu in this file honours. The salt is the session's RAW
// duration, which differs between the week's easy and quality Technique
// swims, so the two sessions of one week never draw a byte-identical drill
// list (gauntlet catch 2026-07-18); it moves on a trim/boost exactly like
// the rest of the rebuilt structure does. Not the rep count: the reps clamp
// floors both of a recovery week's swims to the same value and re-collides
// them (re-verify catch, same day). Level −1 keeps six fundamentals in every
// pool.
//   The hole the duration salt could not close (closed 2026-07-18 by the role
// pass): a deep recovery week pins seed 0 and can shrink both swim slots to
// the same round5 duration (a beginner full-distance plan lands both on
// 15 min), so type, seed and duration all matched and the two cards came out
// byte-identical. No salt arithmetic could separate them — the salt IS the
// duration. The fix is a second, independent discriminator: the workout's
// role, threaded into buildSwim from every path that builds or rebuilds a
// session. Role changes the DIRECTION of the rotation, not the start — see
// pickDrills for why no additive offset can do the job.
// How many distinct drills this athlete's level unlocks. buildSwim needs it to
// size a drill block without asking for more rounds than the catalog can fill:
// pickDrills rotates modulo the pool, so an over-long request silently repeats
// a drill (gauntlet catch 2026-07-18 — a beginner's pool is six, and a 70 min
// custom Technique swim asked for seven).
function drillPoolSize(intensity) {
  return SWIM_DRILLS.filter(d => d.level <= (intensity || 0)).length;
}
function pickDrills(seed, intensity, n, salt, role) {
  const pool = SWIM_DRILLS.filter(d => d.level <= (intensity || 0));
  // The salt adds AFTER the multiply ((seed + salt) * n would collapse two
  // odd salts whenever n divides the pool size), and on the round5 grid:
  // durations are multiples of 5, so a raw-minute salt collides whenever a
  // same-week pair differs by exactly the pool size (35 vs 45 min against
  // the 10-drill pool re-collided; second re-verify catch). Divided by 5,
  // same-week gaps of 5-15 min can never hit a pool-size multiple.
  //   Role walks the catalog BACKWARDS for a quality session. Direction, not
  // another offset, because every additive scheme — a role constant, a stride,
  // anything — is a congruence mod pool.length and therefore collides for some
  // (pool size, duration gap) pair; this comment block already records two such
  // re-collisions. A stride cannot even separate the roles in principle: every
  // integer coprime to 6 is 1 or 5 mod 6, so on the beginner pool of six there
  // are only two usable strides and stride 7 IS stride 1. A forward list and a
  // backward list share at most their first entry and differ at the second for
  // every pool larger than two; the pools are 6, 10 and 12, and n is floored at
  // two, so the two lists can never be equal whatever the seed and duration do.
  const back = role === 'quality';
  // The shifted start is cosmetic, not the guarantee: it stops the week's two
  // Technique swims opening on the same drill. Direction is what makes them
  // provably different.
  const start = ((seed || 0) * n + Math.round((salt || 0) / 5) + (back ? 1 : 0)) % pool.length;
  const at = i => pool[(((start + (back ? -i : i)) % pool.length) + pool.length) % pool.length];
  return Array.from({ length: n }, (_, i) => at(i));
}
// One segment per drill, so every drill carries its own focus cue (and names
// its kit) instead of a comma list with nowhere to explain itself.
function drillSegs(pc, drills) {
  const P = pc.pool || DEFAULT_POOL;
  return drills.map(d => ({
    label: '2 × ' + poolLabel(50, P) + ' ' + d.name,
    detail: d.cue + (d.gear ? ' · ' + d.gear : ''),
    ...swimRep(pc, 'easy', 'Z1', 2, 50, 15),
  }));
}
// Classic shoulders whenever the budget can afford them, stepping down when
// the fixed 500 m would eat more than 45% of the session before the main work
// starts. That is a function of budget AND pace, not of phase: a short taper
// swim steps down, but so does an ordinary 25-30 min session for a slow
// swimmer, whose 500 m costs 14+ minutes (gauntlet catch 2026-07-18 — the
// earlier note here claimed taper/recovery only, which the generated plans
// contradict). `floorWu` holds a real warm-up in front of Z4/Z5 work: easing
// into threshold swimming off 100 m is below any coaching floor, so a quality
// session gives the rep count up before it gives up the warm-up.
function swimShoulders(pc, budgetSec, wuM, cdM, floorWu) {
  const steps = [[wuM, cdM], [Math.max(200, floorWu || 0), 100], [floorWu || 100, 100]];
  return steps.find(s => ((s[0] + s[1]) / 100) * pc.swim.easy <= budgetSec * 0.45) || steps[steps.length - 1];
}
// One steady aerobic volume, always within the continuous ceiling: a single
// block when it fits, otherwise the same metres broken into ~1000 m reps.
// Every place a large steady chunk can appear routes through here, so no
// branch can smuggle an uncoachable 6 km continuous swim past the ceiling the
// Race/Endurance main enforces (gauntlet catch 2026-07-18).
const STEADY_CEILING = 3000;
function steadyMetres(pc, m, note) {
  const P = pc.pool || DEFAULT_POOL;
  const detail = swimDetail(pc, 'steady', 'Z2') + (note || '');
  if (m <= STEADY_CEILING) {
    return [{ label: poolLabel(m, P) + ' continuous', detail: detail, ...swimBlock(pc, 'steady', 'Z2', m) }];
  }
  const n = Math.max(2, Math.round(m / 1000));
  const repM = Math.max(100, Math.round(m / n / 100) * 100);
  return [{ label: n + ' × ' + poolLabel(repM, P) + ' steady', detail: detail + ' · 30 s rest', ...swimRep(pc, 'steady', 'Z2', n, repM, 30) }];
}

// `role` is the workout's slot in the week (easy/quality/long, or custom for a
// user-added session). It exists here purely as a discriminator of last resort:
// a recovery week pins seed to 0 and can collapse both swim slots to the same
// type AND the same round5 duration, leaving buildSwim no other input that
// differs. It must be passed by EVERY path that builds or rebuilds a session,
// or a rebuild returns a different session than the one it replaces and the
// rebuild-stability contract breaks.
function buildSwim(type, dur, pc, seed, phase, intensity = 0, role) {
  const v = n => (seed || 0) % n;
  const budget = dur * 60;
  // Pool-aware building: rdm rounds a metre target to whole pool lengths so
  // rep COUNTS derive from the metres actually swum (duration is preserved on
  // a yard pool, not left short), and dl labels in the pool's unit. Both are
  // the identity on the 25 m default pool, so existing output is byte-identical;
  // a 50 m pool matches too except where a rep splits into sub-50 m pieces (the
  // Technique drill/smooth), which correctly become whole 50 m lengths.
  const P = pc.pool || DEFAULT_POOL;
  const rdm = m => roundToPoolLength(m, P);
  const dl = m => poolLabel(m, P);
  // Every type buys its main work from the session's own seconds, the way
  // Long always has: the old shared reps formula ignored the athlete's CSS
  // entirely, so a slow swimmer's stated minutes bought far more built time
  // than the card admitted (sizing catch 2026-07-18). The variant MENU never
  // moves with dur — same seed + same inputs is the same session, and a
  // trim/boost re-sizes inside the same format; only counts and metres flex.
  const perRep = (key, m, rest) => (rdm(m) / 100) * pc.swim[key] + rest;
  const wuSeg = m => ({ label: 'Warm-up ' + dl(m), detail: swimDetail(pc, 'easy', 'Z2'), ...swimBlock(pc, 'easy', 'Z2', m) });
  const cdSeg = m => ({ label: 'Cool-down ' + dl(m), detail: swimDetail(pc, 'recovery', 'Z1'), ...swimBlock(pc, 'recovery', 'Z1', m) });
  let segs = [], title = 'Swim';
  if (type === 'Technique') {
    title = 'Technique Swim';
    const sh = swimShoulders(pc, budget, 300, 200);
    const perDrill = 2 * perRep('easy', 50, 15);
    // Drill volume grows with the session instead of staying at the variant's
    // 3 or 4 rounds: letting the steady set absorb every extra minute turned a
    // long Technique swim into an Endurance session wearing the wrong title
    // (an elite hour built 300 m of drills against 2600 m of steady — gauntlet
    // catch 2026-07-18). Roughly a third of the post-shoulder budget goes to
    // drills, floored at the variant's own count where affordable and at two
    // on the smallest swims, and capped at what the athlete's level actually
    // unlocks so the rotation never wraps and prescribes one drill twice.
    const drillBudget = budget - ((sh[0] + sh[1]) / 100) * pc.swim.easy;
    const base = v(2) === 0 ? 3 : 4;
    const affordable = Math.floor(drillBudget / perDrill);
    const ceiling = Math.min(8, drillPoolSize(intensity), Math.max(2, affordable));
    const nDrills = clamp(Math.max(base, Math.round(drillBudget * 0.35 / perDrill)), 2, Math.max(2, ceiling));
    const mainSec = drillBudget - nDrills * perDrill;
    // Rep distance scales so an elite hour keeps a sane count (the Long
    // precedent: the count never has to lie).
    let repM = 100, rest = 10, reps = Math.round(mainSec / perRep('steady', 100, 10));
    if (reps > 16) { repM = 200; rest = 15; reps = Math.round(mainSec / perRep('steady', 200, 15)); }
    reps = Math.max(0, reps);
    // The drill/smooth split is whole pool lengths that SUM to the rep: on a
    // 25 m pool a 100 m rep reads '25 m drill / 75 m smooth' (byte-identical
    // to before), on a 50 m pool '50 m drill / 50 m smooth' — never the
    // incoherent quarters a 50 m pool cannot swim (gauntlet catch 2026-07-22).
    const splitLabel = () => {
      const rm = rdm(repM), pm = poolLengthM(P);
      if (rm < 2 * pm) return reps + ' × ' + dl(repM) + ' steady'; // too short to split
      let drillM = Math.max(pm, roundToPoolLength(repM / 4, P));
      if (drillM >= rm) drillM = rm - pm;                          // leave a length to swim smooth
      return reps + ' × ' + dl(repM) + ' as ' + poolLabel(drillM, P) + ' drill / ' + poolLabel(rm - drillM, P) + ' smooth';
    };
    const mainLabel = v(2) === 0 ? reps + ' × ' + dl(repM) + ' steady' : splitLabel();
    segs = [
      wuSeg(sh[0]),
      ...drillSegs(pc, pickDrills(seed, intensity, nDrills, dur, role)),
      ...(reps > 0 ? [{ label: mainLabel, detail: swimDetail(pc, 'steady', 'Z3'), ...swimRep(pc, 'steady', 'Z3', reps, repM, rest) }] : []),
      cdSeg(sh[1]),
    ];
  } else if (type === 'Long') {
    title = 'Long Swim';
    // Volume from the session's own duration, not the shared reps formula
    // (which saturates at ~64 min): whatever time remains after the warm-up
    // and cool-down is swum at steady pace, floored to a clean 100 m. Long
    // takes its shoulders from the shared helper like every other type — it
    // was the one branch still hardcoding 500 m, which for a slow swimmer
    // costs 16 min and pushed a trimmed 20-minute session 44% over its own
    // budget (gauntlet catch 2026-07-18). No warm-up floor: this is Z2 work,
    // so there is no threshold effort to ease into.
    const sh = swimShoulders(pc, budget, 300, 200);
    const wuCdSec = ((sh[0] + sh[1]) / 100) * pc.swim.easy;
    const mainSec = budget - wuCdSec;
    // `mainM` is swimming metres only, so it sizes the CONTINUOUS variant
    // exactly. The broken variants must buy their rest out of the same
    // seconds — costing it nowhere pushed a 35-minute long 16% over, because
    // four rests are four minutes nobody budgeted (gauntlet catch
    // 2026-07-18). Each of them re-derives its metres from `mainSec` net of
    // the rest its own shape adds.
    const mainM = Math.max(200, Math.round(mainSec / pc.swim.steady) * 100);
    const metresIn = sec => Math.max(100, Math.round(sec / pc.swim.steady) * 100);
    // The hardest format follows the run/bike long precedent: broken formats
    // with structure arrive in Build for athletes past beginner; Base keeps
    // the honest continuous and gently broken aerobic versions.
    const hard = phase === 'Build' && intensity >= 0;
    const variant = v(hard ? 3 : 2);
    if (variant === 0) {
      // Even rhythm on purpose: the review judges Long laps against the flat
      // steady band, so the session must never coach a split the review would
      // then call hot (gauntlet catch 2026-07-18).
      segs = [
        wuSeg(sh[0]),
        { label: dl(mainM) + ' continuous', detail: swimDetail(pc, 'steady', 'Z2') + ' · settle in and hold a smooth, even rhythm', ...swimBlock(pc, 'steady', 'Z2', mainM) },
        cdSeg(sh[1]),
      ];
    } else if (variant === 1) {
      // Rep size scales with the budget so the rep count never has to lie:
      // the old 2..8 clamp swam double a small budget and truncated a big one
      // (gauntlet catch 2026-07-18). 800s keep an elite 90-min long at a sane
      // rep count; the floor of one rep only appears on tiny custom picks.
      // The COUNT is chosen first and the rep distance follows from what is
      // left after that many rests, so the set actually totals the main:
      // picking the distance first and rounding the count re-inflated a small
      // budget by half a rep (gauntlet catch 2026-07-18).
      const rest = mainM >= 2400 ? 30 : 20;
      const n4 = Math.max(1, Math.round(mainSec / (((mainM >= 2400 ? 800 : 400) / 100) * pc.swim.steady + rest)));
      const repM = metresIn((mainSec - n4 * rest) / n4);
      segs = [
        wuSeg(sh[0]),
        { label: n4 + ' × ' + dl(repM) + ' steady', detail: swimDetail(pc, 'steady', 'Z2') + ' · ' + rest + ' s rest', ...swimRep(pc, 'steady', 'Z2', n4, repM, rest) },
        cdSeg(sh[1]),
      ];
    } else {
      // Pyramid at one steady pace: the shape keeps a long session mentally
      // small without turning aerobic volume into an interval day. Shoulders
      // round to 50 m and the middle step absorbs the remainder, so the total
      // tracks the budget instead of a hard 9-unit grid (gauntlet catch).
      // Five steps means five rests to pay for before any metres are set.
      const pyrM = metresIn(mainSec - 5 * 20);
      const u = Math.max(50, Math.round(pyrM / 9 / 50) * 50);
      const mid = Math.max(u, Math.round((pyrM - 6 * u) / 50) * 50);
      const steps = [u, 2 * u, mid, 2 * u, u];
      segs = [
        wuSeg(sh[0]),
        ...steps.map((m, i) => {
          const rest = m >= 600 ? 30 : 20;
          return {
            label: dl(m) + ' steady', detail: swimDetail(pc, 'steady', 'Z2') + ' · ' + rest + ' s rest' + (i === steps.length - 1 ? ' · hold form to the end' : ''),
            ...swimRep(pc, 'steady', 'Z2', 1, m, rest),
          };
        }),
        cdSeg(sh[1]),
      ];
    }
  } else if (type === 'CSS Intervals') {
    title = 'CSS Intervals';
    const sh = swimShoulders(pc, budget, 400, 200, 200);
    const avail = budget - ((sh[0] + sh[1]) / 100) * pc.swim.easy;
    const variant = v(3);
    let mains;
    if (variant === 0) {
      let repM = 100, rest = 15, n = Math.round(avail / perRep('css', 100, 15));
      if (n > 16) { repM = 200; rest = 20; n = Math.round(avail / perRep('css', 200, 20)); }
      n = Math.max(3, n);
      mains = [{ label: n + ' × ' + dl(repM) + ' @ CSS', detail: swimDetail(pc, 'css', 'Z4') + ' · ' + rest + ' s rest', ...swimRep(pc, 'css', 'Z4', n, repM, rest) }];
    } else if (variant === 1) {
      let repM = 200, rest = 20, n = Math.round(avail / perRep('css', 200, 20));
      if (n > 12) { repM = 400; rest = 30; n = Math.round(avail / perRep('css', 400, 30)); }
      // A "2 × 200" is a warm-up with ambitions, not an interval session: when
      // the budget cannot hold three of the longer rep, drop back to 100s and
      // keep a real set (gauntlet catch 2026-07-18).
      if (n < 3) { repM = 100; rest = 15; n = Math.max(3, Math.round(avail / perRep('css', 100, 15))); }
      mains = [{ label: n + ' × ' + dl(repM) + ' @ CSS + 2 s/100 ' + unitShort(P), detail: swimDetail(pc, 'css', 'Z4') + ' · ' + rest + ' s rest', ...swimRep(pc, 'css', 'Z4', n, repM, rest) }];
    } else {
      // The sprint set caps at 24 × 50 m: past that the residual swims
      // steady — aerobic support after the fast work, never an ever-longer
      // string of all-out 50s.
      const n = clamp(Math.round(avail / perRep('fast', 50, 20)), 4, 24);
      const absorbM = Math.floor((avail - n * perRep('fast', 50, 20)) / pc.swim.steady) * 100;
      mains = [{ label: n + ' × ' + dl(50) + ' fast', detail: swimDetail(pc, 'fast', 'Z5') + ' · 20 s rest', ...swimRep(pc, 'fast', 'Z5', n, 50, 20) }];
      if (absorbM >= 300) mains.push(...steadyMetres(pc, absorbM));
    }
    segs = [wuSeg(sh[0]), ...mains, cdSeg(sh[1])];
  } else if (type === 'Open Water') {
    title = 'Open Water Swim';
    const sh = swimShoulders(pc, budget, 300, 200, 200);
    const avail = budget - ((sh[0] + sh[1]) / 100) * pc.swim.easy;
    // The skills block is a fixed slice of coaching, not the session's
    // remainder: capping the race set at six 200s left an elite peak session
    // two-thirds unstructured filler, in the race-prep swim that matters most
    // (gauntlet catch 2026-07-18). Skills take ~15% of the post-shoulder time
    // within a 6-12 min band, and the race-effort reps lengthen — 200 m to
    // 400 m — so the rest of the session is real race-specific volume at a
    // sane rep count. The block stays unstructured: skills are drilled by
    // feel, not by the clock, but it carries its minutes so the card sums.
    // Skills take a slice of the post-shoulder time within a 6-12 min band,
    // but never more than a third of it: on a starved session the band would
    // otherwise swallow the whole swim. The block carries EXACTLY this slice
    // as its minutes — earlier it took the session residual, which silently
    // rounded to zero at ordinary paces (a coaching block advertising work it
    // did not account for) and ballooned to 17 min at slow ones (gauntlet
    // catches 2026-07-18). Race effort takes ~60%, its reps lengthening 200 to
    // 400 m; whatever the reps and skills leave is aerobic support.
    const skillsSec = Math.min(clamp(avail * 0.15, 6 * 60, 12 * 60), avail / 3);
    const raceSec = Math.min(avail - skillsSec, avail * 0.6);
    let repM = 200, n = Math.round(raceSec / perRep('css', 200, 30));
    if (n > 6) { repM = 400; n = Math.round(raceSec / perRep('css', 400, 30)); }
    n = Math.max(2, n);
    const raceSet = { label: n + ' × ' + dl(repM) + ' @ race effort', detail: swimDetail(pc, 'css', 'Z4') + ' · sight every 6–8 strokes', ...swimRep(pc, 'css', 'Z4', n, repM, 30) };
    const easySec = avail - skillsSec - n * perRep('css', repM, 30);
    const easyM = easySec > 0 ? Math.round(easySec / pc.swim.steady) * 100 : 0;
    // The aerobic block soaks the residual down to 200 m; anything smaller
    // folds into the skills minutes so no time is lost off the card (it would
    // otherwise vanish, a sub-300 m gap that undershot a 45-min swim by 3 min
    // — gauntlet catch 2026-07-18). Skills stays near its band: the fold is at
    // most one steady rep.
    const hasEasy = easyM >= 200;
    const skillsMin = Math.max(3, Math.round((skillsSec + (hasEasy ? 0 : Math.max(0, easySec))) / 60));
    segs = [
      wuSeg(sh[0]),
      raceSet,
      ...(hasEasy ? steadyMetres(pc, easyM, ' · relaxed, keep sighting') : []),
      { label: 'Open-water skills', detail: 'Deep-water start, drafting, buoy turns — practise swimming straight', min: skillsMin },
      cdSeg(sh[1]),
    ];
  } else { // Endurance / Race Pace
    title = type === 'Race Pace' ? 'Race-Pace Swim' : 'Endurance Swim';
    const key = type === 'Race Pace' ? 'css' : 'steady';
    const zone = type === 'Race Pace' ? 'Z4' : 'Z2';
    // Race Pace earns the quality warm-up floor for the same reason CSS
    // Intervals does; Endurance is Z2 and does not need one.
    const sh = swimShoulders(pc, budget, 300, 200, type === 'Race Pace' ? 200 : 0);
    const avail = budget - ((sh[0] + sh[1]) / 100) * pc.swim.easy;
    if (type === 'Endurance' && v(2) === 1) {
      // Round, never floor: flooring the PER-REP metres and then multiplying
      // by three threw away up to 297 m — nine minutes for a slow swimmer, a
      // 20% undershoot on a 45-minute session, which is the exact dishonesty
      // this pass exists to remove (gauntlet catch 2026-07-18). The rep sits
      // on a 50 m grid rather than 100 m because on a short session the
      // coarser grid cannot get close enough: three reps each rounded down a
      // half-length is most of the shortfall on a 20-minute swim, and every
      // pool this prescribes for is 25 m or 50 m anyway. The rep count grows
      // past three once a third of the volume would exceed the continuous
      // ceiling, so a huge custom session never prescribes a 6 km "rep"
      // (gauntlet catch 2026-07-18).
      const reps = Math.max(3, Math.ceil((avail - 90) / pc.swim.steady * 100 / 9000) * 3);
      const third = Math.max(50, Math.round((avail - reps * 30) / pc.swim.steady / reps * 2) * 50);
      segs = [
        wuSeg(sh[0]),
        { label: reps + ' × ' + dl(third) + ' steady · 30 s rest', detail: swimDetail(pc, 'steady', 'Z2'), ...swimRep(pc, 'steady', 'Z2', reps, third, 30) },
        cdSeg(sh[1]),
      ];
    } else {
      const mainM = Math.max(300, Math.round(avail / pc.swim[key]) * 100);
      // A continuous main has a coaching ceiling, and it is much lower at race
      // pace than at steady: CSS is a ~30-40 min sustainable effort, so an
      // unbroken 4100 m of it is not a session anyone can swim. Past the
      // ceiling the same volume is prescribed as long reps with short rest —
      // still race-pace work, now swimmable (gauntlet blocker 2026-07-18; the
      // old shared formula hid this behind a 1600 m cap).
      const ceiling = type === 'Race Pace' ? 1500 : 3000;
      if (mainM <= ceiling) {
        segs = [
          wuSeg(sh[0]),
          { label: dl(mainM) + ' continuous', detail: swimDetail(pc, key, zone), ...swimBlock(pc, key, zone, mainM) },
          cdSeg(sh[1]),
        ];
      } else {
        const repM = type === 'Race Pace' ? 400 : 1000;
        const rest = type === 'Race Pace' ? 20 : 30;
        const n = Math.max(2, Math.round(avail / perRep(key, repM, rest)));
        segs = [
          wuSeg(sh[0]),
          { label: n + ' × ' + dl(repM) + ' ' + (type === 'Race Pace' ? 'at race pace' : 'steady'), detail: swimDetail(pc, key, zone) + ' · ' + rest + ' s rest', ...swimRep(pc, key, zone, n, repM, rest) },
          cdSeg(sh[1]),
        ];
      }
    }
  }
  // Degrade floor, the swim analogue of fitFlex's collapse-to-one-block: on a
  // session too short for its structured shape at the athlete's pace, the
  // fixed-metre floors (a real warm-up, a two-rep minimum, a skills slice)
  // can jointly cost more seconds than the budget holds, and no single one of
  // them yields. Rather than let the card silently swell past its stated
  // minutes (gauntlet blocker 2026-07-18), the whole session collapses to one
  // honest steady swim of its own length — respecting the same continuous
  // ceiling as every other steady block. Deterministic and pure: only reached
  // when the built shape overruns, and sized from dur alone.
  if (sumMinutes(segs) > dur * 1.12) {
    // Keep a warm-up and cool-down around the collapsed main the way fitFlex's
    // run/bike fallback preserves the session's frame: an earlier version
    // dropped straight to one bare block, which deleted the shoulders even on
    // a session with plenty of room for them (gauntlet catch 2026-07-18). The
    // shoulders come from the shared helper, so they step down on a genuinely
    // starved swim; only when even the steady main would fall below a couple
    // of minutes does the whole thing become a single block.
    const dsh = swimShoulders(pc, budget, 300, 200);
    const mainSec = budget - ((dsh[0] + dsh[1]) / 100) * pc.swim.easy;
    if (mainSec >= 2 * 60) {
      const m = Math.max(100, Math.round(mainSec / pc.swim.steady) * 100);
      segs = [wuSeg(dsh[0]), ...steadyMetres(pc, m, ' · steady and relaxed'), cdSeg(dsh[1])];
    } else {
      const m = Math.max(100, Math.round(dur * 60 / pc.swim.steady) * 100);
      segs = steadyMetres(pc, m, ' · steady and relaxed');
    }
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
  // swimCss. The test distances round to whole pool lengths (400/200 in the
  // pool's own unit; a custom 33 m pool gets 396/198), so no time trial ends
  // mid-length, and the manual divisor is derived from the actual distances so
  // it stays exact on any pool. Byte-identical on 25/50 m and 25 yd (all divide
  // 400/200). CSS is normalised from the recorded laps on the watch path.
  const P = pc.pool || DEFAULT_POOL;
  const u = unitShort(P);
  const rnd = d => Math.max(P.length, Math.round(d / P.length) * P.length);
  const d1 = rnd(400), d2 = rnd(200);
  const div = Math.round((d1 - d2) / 100 * 100) / 100;
  return {
    title: 'Fitness Test · Swim CSS', durationMin: 45, distance: 1.4, unit: 'km',
    segments: [
      { label: 'Warm-up ' + d1 + ' ' + u, detail: swimDetail(pc, 'easy', 'Z2') },
      { label: d1 + ' ' + u + ' time trial — all out', detail: 'Note your time (T' + d1 + ').' },
      { label: 'Easy ' + d2 + ' ' + u, detail: 'Recover fully.' },
      { label: d2 + ' ' + u + ' time trial — all out', detail: 'Note your time (T' + d2 + ').' },
      { label: 'Cool-down ' + d2 + ' ' + u, detail: swimDetail(pc, 'easy', 'Z1') },
    ],
    note: 'CSS pace per 100 ' + u + ' = (T' + d1 + ' − T' + d2 + ') ÷ ' + div + '. Enter it in Update fitness; with a connected watch the app can work it out from your recorded laps, whatever the pool.',
  };
}

const TEST_ROTATION = ['run5k', 'bikeFtp', 'swimCss'];
const TEST_DISC = { run5k: 'run', bikeFtp: 'bike', swimCss: 'swim' };

/* ---- base session durations (minutes, intermediate athlete) ---- */
const LONG_RUN = {
  sprint: 55, olympic: 70, half: 95, t100: 100, full: 120, maintenance: 70,
  // Standalone run races. LONG_BIKE/LONG_BRICK/LONG_SWIM deliberately get no
  // entries for these keys: no bike, brick or swim token can ever appear in a
  // run-only template, and the swap machinery is inert on solo plans.
  run5k: 60, run10k: 75, runhalf: 100, runmarathon: 140,
};
// Long runs stop earning past ~3 hours; the volume multiplier chain (level
// factor x week load) is unclamped and elite marathoners would otherwise be
// handed a 235 minute run. Solo plans only, so triathlon output stays
// byte-identical. Mirrors LONG_SWIM_CAP below.
const LONG_RUN_CAP = 180;
// A marathon taper that still schedules a 2 hour run 7 days out is the first
// thing a marathon buyer inspects. Solo Taper weeks before race week cap the
// long run; race week demotes it to a shakeout entirely.
const SOLO_TAPER_LONG_CAP = 90;
const LONG_BIKE = { sprint: 70, olympic: 100, half: 160, t100: 170, full: 210, maintenance: 100 };
const LONG_BRICK = { sprint: 70, olympic: 95, half: 135, t100: 145, full: 165, maintenance: 90 };
// The long swim only enters a week via the limiter frequency swap (no base
// template carries swim:long), so these sit deliberately under the run/bike
// longs: it is a third swim for a swim-limited athlete, not a weekend anchor.
const LONG_SWIM = { sprint: 40, olympic: 50, half: 60, t100: 60, full: 75, maintenance: 50 };
// Pool sessions stop earning past ~90 min for the athletes this app serves;
// the volume multiplier chain (level factor × week load × limiter bias) is
// unclamped and swim-limited elites would otherwise be handed 2h+ swims.
const LONG_SWIM_CAP = 90;

const TEMPLATES = {
  3: ['swim:quality', 'bike:long', 'run:long'],
  4: ['swim:easy', 'bike:quality', 'run:quality', 'brick:long'],
  5: ['swim:easy', 'run:quality', 'bike:quality', 'run:long', 'bike:long'],
  6: ['swim:easy', 'run:quality', 'bike:quality', 'swim:quality', 'run:long', 'bike:long'],
  7: ['swim:easy', 'run:quality', 'bike:quality', 'swim:quality', 'run:long', 'bike:long', 'brick:long'],
};

// Injured-state templates (profile.excludedDiscipline, design panel
// 2026-07-16): the same hand-authored style, discipline swapped, role kept,
// and never the same discipline+role twice in a week — the seed is per week,
// so a duplicate pair would generate two byte-identical sessions.
//
// No running: bricks become genuine long rides (a brick without its run leg
// is just a ride, and LONG_BIKE runs longer than the brick's deliberately
// shortened bike leg). Swim only carries {easy, quality} roles (no swim-long
// table exists, and Peak forces Open Water onto every swim slot — a third
// swim would duplicate), so swim+bike tops out at FIVE distinct sessions:
// days 6 and 7 reuse the 5-slot table and the surplus days stay free rather
// than being filled with padding. Onboarding says so out loud.
const TEMPLATES_NO_RUN = {
  3: ['swim:quality', 'bike:quality', 'bike:long'],
  4: ['swim:easy', 'swim:quality', 'bike:quality', 'bike:long'],
  5: ['swim:easy', 'swim:quality', 'bike:easy', 'bike:quality', 'bike:long'],
  6: ['swim:easy', 'swim:quality', 'bike:easy', 'bike:quality', 'bike:long'],
  7: ['swim:easy', 'swim:quality', 'bike:easy', 'bike:quality', 'bike:long'],
};
// No swimming: run+bike (and the brick keeps both its legs) fill every slot.
const TEMPLATES_NO_SWIM = {
  3: ['bike:quality', 'bike:long', 'run:long'],
  4: ['run:easy', 'bike:quality', 'run:quality', 'brick:long'],
  5: ['bike:easy', 'run:quality', 'bike:quality', 'run:long', 'bike:long'],
  6: ['bike:easy', 'run:quality', 'bike:quality', 'run:easy', 'run:long', 'bike:long'],
  7: ['bike:easy', 'run:quality', 'bike:quality', 'run:easy', 'run:long', 'bike:long', 'brick:long'],
};
// Run-only templates (solo race types). These are the first templates to
// carry duplicate disc:role tokens, so the house invariant is restated: the
// rule is "never two byte-identical sessions in a week"; token uniqueness was
// the old mechanism, occurrence differentiation (type rung + duration ladder)
// plus the week-level dedupe pass is the new one. One long run always; two
// quality sessions from 4 days up (a 5-day runner with 3 runs is not a
// credible run app). 7 days means 7 runs: the user's day count is a promise,
// and the fourth easy is a shakeout jog by the duration ladder.
const TEMPLATES_RUN_ONLY = {
  3: ['run:quality', 'run:easy', 'run:long'],
  4: ['run:quality', 'run:quality', 'run:easy', 'run:long'],
  5: ['run:quality', 'run:quality', 'run:easy', 'run:easy', 'run:long'],
  6: ['run:quality', 'run:quality', 'run:easy', 'run:easy', 'run:easy', 'run:long'],
  7: ['run:quality', 'run:quality', 'run:easy', 'run:easy', 'run:easy', 'run:easy', 'run:long'],
};
// Unrecognised values fall back to the full template: fail safe, never crash.
// solo is checked before excluded: a stale injured flag must never resolve a
// run race to TEMPLATES_NO_RUN, which would be a run plan with zero runs.
function disciplineTemplate(days, excluded, solo) {
  const t = solo === 'run' ? TEMPLATES_RUN_ONLY
    : excluded === 'run' ? TEMPLATES_NO_RUN
    : excluded === 'swim' ? TEMPLATES_NO_SWIM : TEMPLATES;
  return t[clamp(days, 3, 7)];
}

// Frequency swap — the second half of limiter treatment (Jon, 2026-07-16):
// through Base and Build the athlete's strongest sport donates one weekly
// session slot to the limiter, the way a coach adds a weak-sport session
// instead of only stretching the existing ones. The duration bias (weakBias)
// composes on top. Deterministic safety rules, each one load-bearing:
//   - donor is the strongest sport's easy slot, else its quality slot; never
//     a long or brick (the weekend anchors keep their race-specific shape)
//   - the strongest sport keeps at least one other session in the week, or
//     the swap skips (donating its only slot would detrain it); a brick
//     counts as presence for run and bike, since it trains both legs — the
//     3-day template still never swaps (all its non-swim slots are longs)
//   - the incoming slot takes a role the limiter does not already hold that
//     week; the per-week seed makes duplicate discipline+role pairs
//     byte-identical, so if both roles are taken the swap skips
//   - the caller excludes recovery weeks, post-race weeks, weeks hosting the
//     strongest sport's benchmark test (the test would otherwise replace the
//     donated slot's LONG via its findIndex fallback), and injured-state
//     plans (onboarding promises the remaining sports build normally)
export function swapForLimiter(template, wl, phase) {
  if (!wl || !wl.weakest || !wl.strongest || wl.weakest === wl.strongest) return template;
  if (phase !== 'Base' && phase !== 'Build') return template;
  const has = tok => template.indexOf(tok) >= 0;
  const donor = has(wl.strongest + ':easy') ? wl.strongest + ':easy'
    : has(wl.strongest + ':quality') ? wl.strongest + ':quality' : null;
  if (!donor) return template;
  const keeps = template.some(t => t !== donor && (t.indexOf(wl.strongest + ':') === 0
    || ((wl.strongest === 'run' || wl.strongest === 'bike') && t.indexOf('brick:') === 0)));
  if (!keeps) return template;
  //   - when the limiter already holds both easy and quality (swim on the 6/7
  //     day templates — the only sport capped at two slots), the swap grants a
  //     LONG instead of skipping (design panel 2026-07-18). Swim-only: run and
  //     bike longs are in every template that trains them, so has() already
  //     blocks the fallback there, and a swim long is the coaching-correct
  //     third swim for a swim-limited athlete.
  const role = !has(wl.weakest + ':easy') ? 'easy' : !has(wl.weakest + ':quality') ? 'quality'
    : wl.weakest === 'swim' && !has('swim:long') ? 'long' : null;
  if (!role) return template;
  const out = template.slice();
  if (role === 'long') {
    // Append rather than substitute in place: the day assigner hands weekend
    // slots to long/brick tokens in array order, and the donor's (earlier)
    // index would let the new swim long steal a weekend from the run or bike
    // long. Appended last, the original anchors keep Saturday and Sunday and
    // the swim long overflows onto a weekday (design panel catch 2026-07-18).
    out.splice(out.indexOf(donor), 1);
    out.push(wl.weakest + ':long');
    return out;
  }
  out[out.indexOf(donor)] = wl.weakest + ':' + role;
  return out;
}

// Rediscover the swap verdict a plan was BUILT with, from its own structure.
// The stamped plan.limiterSwap does not survive the backend's typed plan DTO
// (hydration rebuilds the plan field by field), and retargets must hold the
// swap steady across reloads — so the structure itself is the source of
// truth: find a building week whose discipline:role tokens differ from the
// profile's template in exactly the way one (weakest, strongest) swap would
// produce. Weeks that skipped the swap (recovery, strongest-test weeks)
// match the plain template and prove nothing; tune-up races carry no role
// and custom sessions keep their x- ids, so both fall out of the token list;
// strength doubles fall out by discipline.
export function detectLimiterSwap(plan) {
  if (!plan || plan.race === 'tracker' || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const profile = plan.profile || {};
  // Solo plans have one discipline: every week signature equals the base
  // template and the search below correctly proves "no swap".
  const template = disciplineTemplate(profile.daysPerWeek, profile.excludedDiscipline,
    (RACES[profile.raceType] || {}).solo || null);
  if (!template) return null;
  const sig = a => a.slice().sort().join('|');
  const base = sig(template);
  const pairs = [];
  ['swim', 'bike', 'run'].forEach(w => ['swim', 'bike', 'run'].forEach(s => { if (w !== s) pairs.push({ weakest: w, strongest: s }); }));
  for (const wk of plan.weeks) {
    if ((wk.phase !== 'Base' && wk.phase !== 'Build') || wk.isRecovery) continue;
    const toks = wk.workouts.filter(x => x && x.role && !x.custom && !x.second && !x.race && !x.bRace
      && x.discipline !== 'rest' && x.discipline !== 'strength' && String(x.id).indexOf('x-') !== 0)
      .map(x => x.discipline + ':' + x.role);
    const s = sig(toks);
    if (s === base) continue;
    // A swap changes exactly one token, so the (removed, added) pair — and
    // therefore the signature — identifies the verdict uniquely.
    for (const pair of pairs) {
      const cand = swapForLimiter(template, pair, wk.phase);
      if (cand !== template && sig(cand) === s) return pair;
    }
  }
  return null;
}

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
// Distance flavour for solo run plans, applied to the primary quality slot
// only: a 5k or 10k plan climbs one extra rung (an intermediate 5k plan peaks
// at VO2 Intervals, genuinely 5k work; Threshold is genuinely 10k work). The
// half peaks at Threshold, correct for the distance; the marathon keeps
// Tempo/Threshold and gets its specificity from the long run instead.
const RACE_QUALITY_BIAS = { run5k: 1, run10k: 1, runhalf: 0, runmarathon: 0 };
// occ and raceBias are only ever non-zero for solo plans (the caller gates
// them), so every triathlon plan builds byte-identically. occ 1 is the second
// quality of the week: one rung adjacent to the first, easier when possible.
function typeFor(discipline, role, phase, isRecovery, intensity, occ = 0, raceBias = 0) {
  // Templates encode bricks as 'brick:long' — the discipline, not the role,
  // is the brick signal, so it must win before the generic long check.
  if (discipline === 'brick') return 'Brick';
  if (role === 'long') return 'Long';
  // Peak swims become race-specific open-water sessions (any role, but not recovery weeks).
  // Only the QUALITY swim goes race-specific in Peak: forcing every slot to
  // Open Water made two-swim weeks byte-identical (pre-existing, widened by
  // the injured-state templates); the easy slot keeps its technique work.
  if (discipline === 'swim' && phase === 'Peak' && !isRecovery && role !== 'easy') return 'Open Water';
  // bike has no 'Easy' builder branch (falling through would hand it the
  // Threshold else-branch, the recovery-week lesson) — Endurance IS its easy
  if (role === 'easy') return discipline === 'swim' ? 'Technique' : discipline === 'bike' ? 'Endurance' : 'Easy';
  // role === 'quality'
  if (isRecovery) return discipline === 'swim' ? 'Technique' : (discipline === 'bike' ? 'Endurance' : 'Easy');
  const ladder = INTENSITY_LADDER[discipline] || ['Easy'];
  const anchor = LADDER_ANCHOR[phase] != null ? LADDER_ANCHOR[phase] : LADDER_ANCHOR.Peak;
  const idx = clamp(anchor + (intensity || 0) + (raceBias || 0), 0, ladder.length - 1);
  if (occ) return ladder[idx > 0 ? idx - 1 : idx + 1];
  return ladder[idx];
}

// occ is read only by the run branch (solo plans are the only source of
// duplicate tokens; the caller passes 0 everywhere else). The easy ladder
// reads standard easy, aerobic, recovery jog, shakeout; the quality gap
// mirrors the bike easy/quality precedent below.
function baseDuration(discipline, role, race, occ = 0) {
  if (discipline === 'brick') return LONG_BRICK[race];
  if (role === 'long') return discipline === 'bike' ? LONG_BIKE[race] : (discipline === 'run' ? LONG_RUN[race] : LONG_SWIM[race] || 60);
  if (discipline === 'swim') return role === 'easy' ? 35 : 45;
  if (discipline === 'run') return role === 'easy' ? [40, 35, 30, 25][Math.min(occ, 3)] : (occ ? 45 : 50);
  // An easy spin is shorter than a quality ride, and the gap also keeps a
  // recovery week's collapsed types (both map to Endurance there) from
  // producing two byte-identical sessions (injured-state templates carry
  // bike:easy; the classic templates never did).
  if (discipline === 'bike') return role === 'easy' ? 45 : 55;
  return 40;
}

// intensity (the athlete's fitness-level dial, −1 beginner … +2 elite) gates the
// durability finish; derive it from the profile at every call site so a rebuilt
// session keeps the same variant as the one it replaces.
function intensityOf(profile) {
  return (FITNESS[profile && profile.fitness] || FITNESS.intermediate).intensity;
}
// `role` is appended last so every existing positional call stays valid; only
// buildSwim reads it today (see its note). Any new rebuild path MUST pass the
// stored w.role — omitting it silently rebuilds a quality swim as an easy one.
function buildWorkout(discipline, type, dur, pc, phase, seed, intensity = 0, raceType, role) {
  if (discipline === 'run') return buildRun(type, dur, pc, seed, phase, intensity, raceType);
  if (discipline === 'bike') return buildBike(type, dur, pc, seed, phase, intensity);
  if (discipline === 'swim') return buildSwim(type, dur, pc, seed, phase, intensity, role);
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
  const built = buildWorkout(disc, easyType, dur, plan.paces, w.phase, w.seed != null ? w.seed : w.week, intensityOf(plan.profile), plan.profile.raceType, w.role);
  return Object.assign({}, w, {
    type: easyType, title: built.title, durationMin: dur,
    distance: built.distance, distEst: !!built.distEst, unit: built.unit, segments: built.segments,
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
  // raceType must ride along: the solo race-pace Long's variant menu is
  // sized by it, and a rebuild without it would flip a stored session's
  // format (the same class of bug as omitting w.role).
  const built = buildWorkout(disc, w.type, dur, plan.paces, w.phase, w.seed != null ? w.seed : w.week, intensityOf(plan.profile), plan.profile.raceType, w.role);
  return Object.assign({}, w, {
    title: built.title, durationMin: dur,
    distance: built.distance, distEst: !!built.distEst, unit: built.unit, segments: built.segments,
    trimmed: true, trimmedFrom: w.durationMin,
  });
};

// The opposite nudge (Phase 3, rule F2): grow a session's volume when the load
// isn't sufficient to drive adaptation. Same rebuild mechanics as trimWorkout.
export const boostWorkout = function (w, plan, factor) {
  const disc = w.discipline;
  if (disc !== 'run' && disc !== 'bike' && disc !== 'swim') return w;
  // The pool ceiling holds on every rebuild path, not just generation: a
  // capped swim long boosted by the F2 nudge must not creep past it
  // (gauntlet catch 2026-07-18).
  const soloRun = (RACES[plan.race] || {}).solo === 'run';
  const cap = disc === 'swim' && w.role === 'long' ? LONG_SWIM_CAP
    : soloRun && disc === 'run' && w.role === 'long'
      ? (w.phase === 'Taper' ? SOLO_TAPER_LONG_CAP : LONG_RUN_CAP) : Infinity;
  const dur = Math.min(round5(w.durationMin * factor), cap);
  if (dur <= w.durationMin) return w;
  // raceType must ride along: the solo race-pace Long's variant menu is
  // sized by it, and a rebuild without it would flip a stored session's
  // format (the same class of bug as omitting w.role).
  const built = buildWorkout(disc, w.type, dur, plan.paces, w.phase, w.seed != null ? w.seed : w.week, intensityOf(plan.profile), plan.profile.raceType, w.role);
  return Object.assign({}, w, {
    title: built.title, durationMin: dur,
    distance: built.distance, distEst: !!built.distEst, unit: built.unit, segments: built.segments,
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
  // A user-added session has no slot in the week's template, so it takes the
  // same literal 'custom' role it is stored with — never undefined, or the
  // rebuild paths above (which read w.role) would disagree with this build.
  const built = buildWorkout(discipline, type, durationMin, plan.paces, wk.phase, seed, intensityOf(plan.profile), plan.profile.raceType, 'custom');
  const dur = built.durationMin || durationMin; // strength fixes its own length
  const key = 'x-' + dateISO.split('-').join('');
  const taken = new Set(wk.workouts.map(x => x.id));
  let n = 0;
  while (taken.has(key + '-' + n)) n++;
  const workout = {
    id: key + '-' + n, week: wk.index, seed: seed, phase: wk.phase, date: dateISO,
    discipline: discipline, role: 'custom', type: type, title: built.title,
    durationMin: dur, distance: built.distance, distEst: !!built.distEst, unit: built.unit,
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
// The client-side tracker sentinel from a STANDALONE profile (Phase 2 of
// docs/NO_PLAN_WORKFLOW.md): server-side the state is "no plan + profile";
// this sentinel is the in-memory representation the component tree keeps
// using, synthesized at hydrate and NEVER pushed to the server. The server
// profile is a plan-independent subset (no raceType/raceDate/startDate), so
// only derivable fields are defaulted here; race fields stay absent and the
// plan editor refuses to build until a race is chosen.
export const trackerFromProfile = function (profile, nowISO) {
  const p = profile || {};
  const daysPerWeek = p.daysPerWeek != null ? p.daysPerWeek
    : (Array.isArray(p.trainingDays) ? p.trainingDays.length : 5);
  const full = Object.assign({}, p, { raceDate: null, daysPerWeek });
  return {
    profile: full,
    race: 'tracker', createdAt: nowISO || new Date().toISOString(),
    updatedAt: nowISO || new Date().toISOString(),
    totalWeeks: 0, paces: computePaces(full), weeks: [], limiterSwap: null,
  };
};

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
      // bRace included: a tune-up's race-day instructions must never be
      // rebuilt into training content (sim catch 2026-07-17 — every app load
      // was silently corrupting them, 'RACE' being no builder's type).
      if (w.race || w.bRace || w.test || w.discipline === 'rest' || !w.durationMin) return w;
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
      // Bike distances built under the old flat 30 km/h guess never drift on
      // minutes (distance was computed independently of the segments), so
      // they would never rebuild on their own. Compare the stored number
      // against what the zone-mix model says now and treat any whole-km gap
      // as stale, so one calendar cannot mix both models (design panel
      // 2026-07-18). Both models return integers, so a half-km tolerance
      // catches every real difference without churning on rounding.
      const bikeDistStale = w.discipline === 'bike' && w.distance != null
        && segsNow.some(s => s.zone || s.blocks)
        && Math.abs(w.distance - bikeDistance(segsNow, plan.paces)) > 0.51;
      const current = segsNow.some(s => s.zone || s.blocks)
        && !(w.discipline === 'swim' && segsNow.some(s => s.blocks && !s.swim))
        && !driftsRunBike && !brickStale && !bikeDistStale;
      // distEst is not stored server-side: the plan DTO drops it, so a synced
      // workout comes back with the flag missing and its distance silently
      // loses the tilde. It is fully derivable, so backfill it here rather
      // than teaching the wire format a new field (gauntlet catch
      // 2026-07-18; run had the same latent gap).
      if (current) {
        // Two derivable flags the wire may have dropped (the segment DTO
        // predates them): distEst on the workout, terrain on hill segments.
        // Hill labels are deterministic builder output, so the tag re-derives
        // from them exactly — without it the review would quietly go back to
        // grading hill reps against flat pace after any sync (gauntlet catch
        // 2026-07-18, the same class as the bike pass's distEst).
        let out = w;
        const needsTerrain = w.discipline === 'run'
          && (w.segments || []).some(s => s && !s.terrain && (s.zone || s.blocks) && /uphill/i.test(s.label || ''));
        if (needsTerrain) {
          changed = true;
          out = Object.assign({}, out, {
            segments: out.segments.map(s => (s && !s.terrain && /uphill/i.test(s.label || '')) ? Object.assign({}, s, { terrain: 'hill' }) : s),
          });
        }
        if (out.distance == null) return out;
        const want = distEstFor(out.discipline, plan.paces);
        if (!!out.distEst === want) return out;
        changed = true;
        return Object.assign({}, out, { distEst: want });
      }
      // w.role rides along so this rebuild and generatePlan feed buildSwim
      // the same role: the drill catalog draws in opposite directions for the
      // easy and quality slots, and a roleless rebuild would quietly swap a
      // session for the other slot's (swim sizing pass 2026-07-18). A workout
      // somehow missing role rebuilds forwards, as the roleless code did.
      const built = buildWorkout(w.discipline, w.type, w.durationMin, plan.paces, w.phase, w.seed != null ? w.seed : 0, intensityOf(plan.profile), plan.profile.raceType, w.role);
      if (!(built.segments || []).some(s => s.zone || s.blocks)) return w; // swims/strength stay as they are
      changed = true;
      return Object.assign({}, w, { segments: built.segments, distance: built.distance, distEst: !!built.distEst });
    });
    return Object.assign({}, week, { workouts: workouts });
  });
  return changed ? Object.assign({}, plan, { weeks: weeks }) : plan;
};

// The plan's contiguous phase groups: the app's honest notion of a training
// BLOCK (progression spec section 3.3; a block is where the plan already
// changes character, never a new scheduling layer). Includes PlanView's
// Recovery relabel of a scheduled final recovery week, so every consumer
// shares one boundary definition (design panel 2026-07-21: two independent
// reimplementations had already begun to drift).
export function weekPhaseLabel(plan, week) {
  // The one place the terminal post-race week earns its 'Recovery' label
  // (the backend phase catalog has no 'Recovery'; the raw phase stays
  // 'Maintain'). Mid-plan recovery weeks keep their real phase: relabelling
  // them would shatter contiguous blocks.
  if (!week || !plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return week ? week.phase : null;
  const race = RACES[plan.race] || {};
  const hasRecoveryWeek = !race.noRace && plan.weeks[plan.weeks.length - 1].isRecovery;
  return hasRecoveryWeek && week.index === plan.weeks.length - 1 ? 'Recovery' : week.phase;
}

export function phaseGroups(plan) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return [];
  const g = [];
  plan.weeks.forEach(w => {
    const disp = weekPhaseLabel(plan, w);
    const last = g[g.length - 1];
    if (last && last.phase === disp) { last.weeks++; last.min += w.totalMin; }
    else g.push({ phase: disp, weeks: 1, min: w.totalMin, start: w.index });
  });
  return g;
}

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
export const generatePlan = function (profile, opts) {
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
  const template = disciplineTemplate(days, profile.excludedDiscipline, race.solo || null);
  let longDay = profile.longDay;
  if (prefDays && (longDay === undefined || prefDays.indexOf(longDay) < 0)) {
    longDay = prefDays.indexOf(5) >= 0 ? 5 : (prefDays.indexOf(6) >= 0 ? 6 : prefDays[prefDays.length - 1]);
  }

  // Weakest-link bias, derived deterministically from the profile's own
  // baselines (see lib/weakest.js) — {} when the sports are balanced or the
  // data can't say.
  // Solo plans have no cross-sport comparison to bias by; a stale triathlon
  // baseline must never stretch or shrink the only discipline's sessions.
  const bias = race.solo ? {} : weakBias(profile);
  // The frequency-swap verdict (see swapForLimiter). It changes WHICH
  // discipline sits at a workout id, so it must never flip on a mid-plan
  // retarget: ids are positional and the log/moves overlays join on them, so
  // a flipped verdict would retroactively turn a logged run into a swim
  // (gauntlet catch, reproduced). retarget() passes the plan's own stamped
  // verdict via opts.lockedSwap (null for legacy plans: locked to no swap);
  // onboarding and reshapePlan omit it, taking a fresh verdict — a reshape
  // already re-lays the structure and clears structure-bound overlays.
  // Injured-state plans never swap: onboarding promises the remaining two
  // sports keep building normally, and the swap would cut the stronger one.
  // The injured guard outranks a locked verdict: a stale lock naming the
  // excluded discipline would otherwise swap a session of it straight into
  // an injured-state plan (re-verify catch).
  // The solo guard outranks a locked verdict for the same reason the injured
  // guard does: a stale lock naming swim or bike would otherwise splice a
  // session of it straight into a run-only template.
  const swapWl = race.solo || profile.excludedDiscipline ? null
    : opts && opts.lockedSwap !== undefined
      ? opts.lockedSwap
      : (() => {
        const wl = weakestLink({ profile });
        return wl && wl.weakest ? { weakest: wl.weakest, strongest: wl.strongest } : null;
      })();

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
  // No benchmark for a discipline the plan does not train (injured state):
  // same spread logic over the two remaining tests.
  const TEST_DISC = { run5k: 'run', bikeFtp: 'bike', swimCss: 'swim' };
  // Solo plans only ever test their one discipline, and with room they test
  // it twice (early and late): the 5k is the sole pace source on a run plan,
  // and the existing spread math puts two tests at roughly one quarter and
  // three quarters of the eligible window.
  let rotation = race.solo
    ? TEST_ROTATION.filter(t => TEST_DISC[t] === race.solo)
    : TEST_ROTATION.filter(t => TEST_DISC[t] !== profile.excludedDiscipline);
  if (race.solo && eligibleTestWeeks.length >= 6) rotation = rotation.concat(rotation);
  const nTests = Math.min(rotation.length, eligibleTestWeeks.length);
  for (let i = 0; i < nTests; i++) {
    const pos = nTests === 1 ? Math.floor(eligibleTestWeeks.length / 2)
      : Math.round((i + 0.5) / nTests * (eligibleTestWeeks.length - 1));
    testByWeek[eligibleTestWeeks[pos]] = rotation[i];
  }

  // Which week hosts race day (solo taper rules read it; -1 when no race).
  const raceWeekIdx = maintenance ? -1 : Math.floor(daysBetween(iso(weekStart0), iso(profile.raceDate)) / 7);

  // Solo quality spacing: token order alone cannot space two qualities on
  // both day-assignment paths (qualities-first lands Tue/Thu on the legacy
  // queue but stacks Mon+Tue for a Mon-to-Fri prefDays athlete). Rule, both
  // paths: first quality on the earliest available day; the second on the
  // day maximising its minimum calendar distance from the first quality AND
  // from any long day (ties to the earlier day); easies fill the rest in
  // day order. Deterministic, no seed.
  const assignSoloMids = (midDays, mids, dayMap, longDays) => {
    const days = midDays.slice().sort((a, b) => a - b).slice(0, mids.length);
    const qs = mids.filter(m => m.role === 'quality');
    const es = mids.filter(m => m.role !== 'quality');
    const usedD = new Set();
    if (qs[0] && days.length) { dayMap[days[0]] = qs[0]; usedD.add(days[0]); }
    if (qs[1]) {
      let best = null, bestDist = -1;
      let bestQ1 = -1;
      days.forEach(d => {
        if (usedD.has(d)) return;
        const dq1 = Math.abs(d - days[0]);
        const dist = Math.min.apply(null, [dq1].concat(longDays.map(ld => Math.abs(d - ld))));
        // ties break by MORE distance from the first quality, then by the
        // earlier day: min-distance alone stacked Mon+Tue qualities for a
        // four-consecutive-day athlete (gauntlet catch)
        if (dist > bestDist || (dist === bestDist && dq1 > bestQ1)) { best = d; bestDist = dist; bestQ1 = dq1; }
      });
      if (best != null) { dayMap[best] = qs[1]; usedD.add(best); }
    }
    days.filter(d => !usedD.has(d)).forEach((d, i) => { if (es[i]) dayMap[d] = es[i]; });
  };

  // The week-level uniqueness pass for solo plans. Duplicate disc:role tokens
  // are first differentiated by type rung and the duration ladder, but round5
  // buckets are 5 minutes wide and the load multiplier can collapse two bases
  // into one bucket (recovery weeks collapse types too). Rule restated: never
  // two byte-identical sessions in a week. Same type + same duration at the
  // week's pinned-or-shared seed IS byte-identical, so nudge the later one
  // down in 5s (floor 20), then up, to the first free slot. Runs again after
  // the B-race easing pass, which can floor two runs to 20.
  const dedupeSoloWeek = wk => {
    if (!race.solo) return;
    const seen = [];
    const taken = (t, m) => seen.some(x => x.t === t && x.m === m);
    wk.workouts.forEach((wo, i) => {
      if (wo.discipline !== race.solo || wo.race || wo.bRace || wo.test || wo.second) return;
      let cur = wo;
      if (taken(cur.type, cur.durationMin)) {
        let m = null;
        for (let d2 = cur.durationMin - 5; d2 >= 20; d2 -= 5) if (!taken(cur.type, d2)) { m = d2; break; }
        for (let d2 = cur.durationMin + 5; m == null; d2 += 5) if (!taken(cur.type, d2)) m = d2;
        const built = buildWorkout(cur.discipline, cur.type, m, pc, cur.phase, cur.seed, fitness.intensity, profile.raceType, cur.role);
        cur = { ...cur, durationMin: m, title: built.title, distance: built.distance, distEst: !!built.distEst, unit: built.unit, segments: built.segments };
        wk.workouts[i] = cur;
      }
      seen.push({ t: cur.type, m: cur.durationMin });
    });
    wk.totalMin = wk.workouts.reduce((a, x) => a + (x.durationMin || 0), 0);
  };

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
    // Limiter frequency swap: only in real building weeks — recovery weeks
    // (including the post-race one) stay even by definition, and a week
    // hosting the strongest sport's benchmark test keeps its quality slot,
    // or the test's findIndex fallback would consume the long instead.
    const weekTemplate = (isRecovery || postRaceWeek
      || (testKind && swapWl && TEST_DISC[testKind] === swapWl.strongest))
      ? template : swapForLimiter(template, swapWl, phase);
    const longs = [], mids = [];
    weekTemplate.forEach(tok => {
      const [disc, role] = tok.split(':');
      if (postRaceWeek) {
        // ONE gentle session per discipline: the recovery week pins the seed
        // and collapses every role, so a second slot of the same discipline
        // would be byte-identical (pre-existing on 6-7 day plans, widened by
        // the injured-state templates; gauntlet catch 2026-07-16).
        const d2 = disc === 'brick' ? 'bike' : disc;
        // Solo plans have one discipline, so one-per-discipline degenerated
        // the whole post-race week to a single jog; the occ duration ladder
        // plus the dedupe pass now keep up to three gentle runs distinct.
        // Extras carry role 'easy': the day assigner places at most two
        // QUALITY slots, and the quality-role requirement here is a bike
        // typing concern that cannot apply to a run-only week (re-verify
        // catch: three quality-role slots yielded two runs and a rest day).
        const capN = race.solo ? 3 : 1;
        const have = mids.filter(m => m.disc === d2).length;
        if (have < capN) mids.push({ disc: d2, role: have === 0 ? 'quality' : 'easy' });
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
      if (race.solo) assignSoloMids(midSlots, mids, dayMap, Object.keys(used).map(Number));
      else mids.forEach((s, i) => { const d = midSlots[i]; if (d !== undefined) dayMap[d] = s; });
    } else {
      const weekdayQueue = WEEKDAY_ORDER.slice();
      // Long/brick sessions take the weekend first; any overflow spills onto a weekday.
      longs.forEach((s, i) => {
        if (WEEKEND[i] !== undefined) dayMap[WEEKEND[i]] = s;
        else { const wd = weekdayQueue.shift(); if (wd !== undefined) dayMap[wd] = s; }
      });
      if (race.solo) {
        // The queue holds five weekdays; a 7-day run plan has six mids, so
        // Sunday joins the pool (7 days means 7 runs, the day count is a
        // promise). Preference order first, then the spacing rule places.
        const longDays2 = Object.keys(dayMap).map(Number);
        const pool = WEEKDAY_ORDER.concat([5, 6]).filter(d => longDays2.indexOf(d) < 0);
        assignSoloMids(pool.slice(0, mids.length), mids, dayMap, longDays2);
      } else {
        mids.forEach(s => { const wd = weekdayQueue.shift(); if (wd !== undefined) dayMap[wd] = s; });
      }
    }

    const workouts = [];
    // Per-week occurrence counter for duplicate disc:role tokens (solo
    // templates are the only source). Positional in day order, independent of
    // seed, so nothing needs to survive the wire: type and durationMin are
    // stored per workout and segment rebuilds read the stored values.
    const occCount = {};
    for (let d = 0; d < 7; d++) {
      const date = iso(addDays(weekStart0, w * 7 + d));
      const s = dayMap[d];
      if (!s) {
        workouts.push({ id: w + '-' + d, week: w, phase: phase, date: date, discipline: 'rest', type: 'Rest', title: 'Rest', durationMin: 0, segments: [], distance: null });
        continue;
      }
      const okey = s.disc + ':' + s.role;
      const occ0 = occCount[okey] || 0;
      occCount[okey] = occ0 + 1;
      // occ and raceBias reach typeFor/baseDuration only on solo plans, so
      // triathlon weeks build byte-identically whatever the counter says.
      const occ = race.solo ? occ0 : 0;
      // Race week demotes the solo long to a shakeout jog: the race is the
      // week's key session, and a long run days before it is the first thing
      // a marathon buyer inspects. If the race lands on the long day itself,
      // the race-day replacement below overwrites this slot anyway.
      const soloShakeout = race.solo && s.role === 'long' && w === raceWeekIdx;
      const roleOut = soloShakeout ? 'easy' : s.role;
      const type = soloShakeout ? 'Easy'
        : typeFor(s.disc, s.role, phase, isRecovery, fitness.intensity, occ,
          race.solo ? (RACE_QUALITY_BIAS[race.key] || 0) : 0);
      // Lead-in Maintain weeks hold fitness, they don't rehearse the race:
      // long sessions cap at maintenance scale (a far-out full would otherwise
      // spend months on 3h+ "maintenance" rides). Standalone maintenance and
      // build phases use their own tables directly.
      const raceScale = baseDuration(s.disc, s.role, race.key, occ);
      const durBase = phase === 'Maintain' && !maintenance
        ? Math.min(raceScale, baseDuration(s.disc, s.role, 'maintenance', occ))
        : raceScale;
      // Weakest-link bias: the limiting sport earns extra time while building;
      // Peak and Taper keep their race-specific shape untouched.
      // No weakest-link bias in the post-race recovery week: recovery is even
      // by definition — the limiter gets its extra time while building.
      const wb = !postRaceWeek && (phase === 'Base' || phase === 'Build' || phase === 'Maintain') && bias[s.disc] ? bias[s.disc] : 1;
      // The swim long is the one long the multiplier chain can push somewhere
      // silly (see LONG_SWIM_CAP); tri run/bike longs keep their historic
      // scaling. Solo run longs cap at LONG_RUN_CAP always, and at
      // SOLO_TAPER_LONG_CAP in Taper weeks before race week.
      let cap = s.disc === 'swim' && s.role === 'long' ? LONG_SWIM_CAP : Infinity;
      let dur;
      if (race.solo && s.disc === 'run' && s.role === 'long') {
        cap = Math.min(cap, LONG_RUN_CAP);
        if (phase === 'Taper' && w !== raceWeekIdx) cap = Math.min(cap, SOLO_TAPER_LONG_CAP);
        // The solo long is distance-driven, not level-driven: a beginner
        // marathon long scaled by the 0.75 volume factor peaked at 2 hours,
        // which any marathon shopper would call under-built. The marathon
        // long floors at the full base (the distance does not shrink for a
        // beginner; their midweek runs stay scaled); shorter races floor at
        // 0.9. Levels at or above the floor keep their own scaling.
        const lf = Math.max(fitness.factor, race.key === 'runmarathon' ? 1 : 0.9) / fitness.factor;
        // Cap BEFORE the recovery reduction so a step-back week still steps
        // back: applied after, the cap swallowed the reduction and elite
        // recovery longs sat at the 180 ceiling like peak weeks.
        const recDepth = isRecovery ? fitness.recoveryDepth : 1;
        dur = soloShakeout ? 25
          : round5(Math.min(round5(durBase * (load / recDepth) * lf * wb), cap) * recDepth);
      } else {
        dur = soloShakeout ? 25 : Math.min(round5(durBase * load * wb), cap);
      }
      // No solo run session under 20 minutes: beginner 7-day recovery weeks
      // otherwise generate 10 and 15 minute jogs (the dedupe pass separates
      // any collisions this floor creates).
      if (race.solo && s.disc === 'run' && !soloShakeout) dur = Math.max(20, dur);
      // Recovery weeks pin the canonical format; every other week rotates.
      const seed = isRecovery ? 0 : w;
      const built = buildWorkout(s.disc, type, dur, pc, phase, seed, fitness.intensity, profile.raceType, roleOut);
      workouts.push({
        id: w + '-' + d, week: w, phase: phase, date: date, seed: seed,
        discipline: s.disc, role: roleOut, type: type, title: built.title,
        durationMin: dur, distance: built.distance, distEst: !!built.distEst, unit: built.unit,
        segments: built.segments, key: !soloShakeout && (s.role === 'long' || s.role === 'brick'),
      });
    }

    // mark race day (replace that day's workout) — maintenance has none
    const raceISO = maintenance ? null : iso(profile.raceDate);
    workouts.forEach((wo, i) => {
      if (wo.date === raceISO) {
        // Solo race day: one honest leg, discipline stamped as the real
        // sport (keeps it out of brick styling and inside the watch-export
        // race bucket). The marathon card carries a fuelling cue; the wider
        // fuelling surface stays a deferred panel of its own.
        if (race.solo) {
          const segs = race.key === 'runmarathon' ? [
            { label: 'Warm-up', detail: 'A few minutes of easy jogging, no more' },
            { label: 'Run ' + race.run + ' km', detail: 'Start easier than feels right, fuel from the first 20 minutes, not when you fade' },
          ] : race.key === 'runhalf' ? [
            { label: 'Warm-up', detail: '10 min easy with a couple of strides' },
            { label: 'Run ' + race.run + ' km', detail: 'Settle into your pace early and take fuel from the first station' },
          ] : [
            { label: 'Warm-up', detail: '15 min easy with a few strides' },
            { label: 'Run ' + race.run + ' km', detail: 'Even early, strong late' },
            { label: 'Cool-down', detail: '10 min very easy' },
          ];
          workouts[i] = {
            id: wo.id, week: w, phase: 'Taper', date: raceISO, discipline: race.solo,
            type: 'RACE', title: 'RACE DAY — ' + race.name, durationMin: 0, distance: null, unit: '',
            segments: segs, race: true, key: true,
          };
          return;
        }
        workouts[i] = {
          id: wo.id, week: w, phase: 'Taper', date: raceISO, discipline: 'brick',
          type: 'RACE', title: 'RACE DAY — ' + race.name, durationMin: 0, distance: null, unit: '',
          // Every leg always renders: race day is the real event, independent
          // of what was trained (deliberate; the injured-state onboarding says
          // so). An untrained leg earns a caution instead of vanishing
          // (design panel 2026-07-18).
          segments: [
            { label: 'Swim ' + race.swim + ' km', detail: 'Steady, sight often, settle into rhythm' + (profile.excludedDiscipline === 'swim' ? ' · untrained in this plan, pace it very conservatively' : '') },
            { label: 'Bike ' + race.bike + ' km', detail: 'Hold race watts, fuel every 20 min' },
            { label: 'Run ' + race.run + ' km', detail: 'Negative split, finish strong' + (profile.excludedDiscipline === 'run' ? ' · untrained in this plan, walk-run is a fine plan' : '') },
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
          distance: built.distance, distEst: !!built.distEst, unit: built.unit, segments: built.segments,
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
      // Tie-break by weekday order, NOT duration: durations wear the limiter
      // bias, which a fitness-only retarget legitimately changes, and a moved
      // host re-ids the double and orphans its log entry (sim catch
      // 2026-07-17). Weekday order is stable for a stable schedule.
      hosts.sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1));
      const host = hosts[0];
      if (host) workouts.push({
        id: w + '-' + host.id.split('-')[1] + '-1', week: w, phase: phase, date: host.date,
        discipline: 'strength', role: 'strength', type: 'Strength', title: built.title,
        durationMin: built.durationMin, distance: null, unit: '', segments: built.segments, second: true,
      });
    }

    const totalMin = workouts.reduce((a, b) => a + (b.durationMin || 0), 0);
    const wkObj = { index: w, phase: phase, isRecovery: isRecovery, start: iso(addDays(weekStart0, w * 7)), totalMin: totalMin, workouts: workouts };
    dedupeSoloWeek(wkObj);
    weeks.push(wkObj);
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
      // A raced half is not a parkrun: long run tune-ups (90 min and up)
      // ease a second day on the way out. Gated on discipline so the olympic
      // tune-up (150 min, brick) keeps its historic window.
      const spec = B_RACES[b.kind];
      const win = spec.discipline === 'run' && spec.durationMin >= 90 ? [-2, -1, 1, 2] : [-2, -1, 1];
      win.forEach(o => easeDates.add(iso(addDays(b.date, o))));
    });
    weeks.forEach(wk => {
      let touched = false;
      wk.workouts = wk.workouts.map(wo => {
        const b = bByDate[wo.date];
        if (b && !wo.race && !wo.second) {
          touched = true;
          const spec = B_RACES[b.kind];
          // Solo RACES entries share keys with run B races (run5k, run10k,
          // runhalf): without the solo check, every parkrun tune-up in every
          // triathlon plan would flip to the three-leg branch and render
          // 'Swim 0 km'. Run tune-ups always take the race-it shape.
          const legs = RACES[b.kind] && !RACES[b.kind].solo ? RACES[b.kind] : null;
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
          const built = buildWorkout(wo.discipline, t, dur, pc, wo.phase, wo.seed, fitness.intensity, profile.raceType, wo.role);
          return { ...wo, type: t, title: built.title, durationMin: dur, distance: built.distance, distEst: !!built.distEst, unit: built.unit, segments: built.segments };
        }
        return wo;
      }).filter(Boolean);
      if (touched) wk.totalMin = wk.workouts.reduce((a, x) => a + (x.durationMin || 0), 0);
      // Easing can floor two solo runs into the same type and duration; the
      // uniqueness pass re-runs to keep the never-byte-identical invariant.
      if (touched) dedupeSoloWeek(wk);
    });
  }

  return {
    profile: profile, race: race.key, createdAt: new Date().toISOString(),
    totalWeeks: totalWeeks, paces: pc, weeks: weeks,
    leadIn: leadIn || undefined, shortRunway: shortRunway || undefined,
    // The swap verdict this plan was built with, so retargets can hold it
    // steady (see the swapWl note above). null means "built with no swap".
    limiterSwap: swapWl,
  };
};
