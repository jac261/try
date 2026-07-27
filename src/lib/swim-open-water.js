/* Try — phase 6: the open-water module.
 *
 * Open Water was one fixed template that Peak substituted onto the quality
 * swim. This turns it into five race-specific session categories, each with
 * the skills it drills, a pool equivalent that exists whether or not the
 * athlete can get to open water, and the safety wording that has to sit
 * alongside any session Try prescribes outdoors.
 *
 * Coaching CONTENT lives here; the engine helpers that turn a shape into
 * segments stay in plan.js, the same split swim-drills.js uses. Nothing in
 * this file knows about paces, pools or minutes.
 */

/* §1: the skills an open-water session can drill. Each carries the pool
   equivalent from §4, because the fallback is not a lesser session — it is
   the same objective done between walls. */
export const OW_SKILLS = {
  sighting: {
    label: 'Sighting',
    cue: 'eyes forward every six to eight strokes, hips stay high',
    pool: 'lift the eyes to sight twice a length without breaking rhythm',
  },
  turns: {
    label: 'Buoy turns',
    cue: 'tight turn, two hard strokes out of it, then settle',
    pool: 'change direction mid-lane where it is safe, then two hard strokes',
  },
  drafting: {
    label: 'Drafting',
    cue: 'sit on a hip or on the feet, breathe away from the wash',
    pool: 'swim close behind a lane partner, but only with an organised group',
  },
  start: {
    label: 'Deep-water start',
    cue: 'hard for fifteen strokes, then find race rhythm without stopping',
    pool: 'push off and go hard for fifteen strokes, then settle without a break',
  },
  surges: {
    label: 'Surges',
    cue: 'lift for ten strokes, then recover while still swimming',
    pool: 'ten hard strokes mid-length, then settle: recover swimming, not resting',
  },
  exit: {
    label: 'Exit and orientation',
    cue: 'accelerate to the exit, stand tall, get your bearings before you run',
    pool: 'finish hard, climb out, and rehearse the walk to your bike',
  },
  entry: {
    label: 'Entry',
    cue: 'wade or dolphin in, get flat and swimming as early as you can',
    pool: 'start from the wall and get to full stroke rate within a length',
  },
  massStart: {
    label: 'Mass-start simulation',
    cue: 'start beside others, hold your line, breathe both sides',
    pool: 'share a lane and start together, holding your own line',
  },
  wetsuit: {
    label: 'Wetsuit familiarity',
    cue: 'feel the buoyancy change your body position and your stroke rate',
    pool: 'no pool equivalent: most pools do not permit wetsuits',
    poolNone: true,
  },
  tempo: {
    label: 'Variable tempo',
    cue: 'change gear on demand, the way a race asks you to',
    pool: 'alternate steady and strong by length, changing gear on the turn',
  },
};

/* §2: the five session categories. `blocks` is a SHAPE, not segments: each
   block takes a share of the session's available time, and plan.js turns it
   into real reps at the athlete's paces and pool. Shares within a category
   sum to 1. */
export const OW_CATEGORIES = [
  {
    id: 'skills', title: 'Open-Water Skills',
    why: 'Navigation and race craft, so the swim costs you nothing on race day.',
    blocks: [
      { kind: 'skill', share: 0.35, skills: ['sighting', 'turns'] },
      { kind: 'reps', share: 0.4, repM: 200, key: 'css', zone: 'Z4', rest: 30, label: '@ race effort', skill: 'sighting' },
      { kind: 'steady', share: 0.25, skill: 'drafting' },
    ],
  },
  {
    id: 'race-pace', title: 'Open-Water Race Pace',
    why: 'Sustained race intensity in the kit and the water you will race in.',
    blocks: [
      { kind: 'reps', share: 0.65, repM: 400, key: 'css', zone: 'Z4', rest: 30, label: '@ race effort', skill: 'sighting' },
      { kind: 'skill', share: 0.15, skills: ['wetsuit'] },
      { kind: 'steady', share: 0.2, skill: 'sighting' },
    ],
  },
  {
    id: 'starts', title: 'Open-Water Starts and Surges',
    why: 'The first two minutes of a race, and learning to recover while still swimming.',
    blocks: [
      { kind: 'skill', share: 0.2, skills: ['start', 'massStart'] },
      { kind: 'reps', share: 0.35, repM: 100, key: 'fast', zone: 'Z5', rest: 20, label: 'fast from a deep-water start', skill: 'start' },
      { kind: 'reps', share: 0.25, repM: 200, key: 'css', zone: 'Z4', rest: 30, label: '@ race effort', skill: 'surges' },
      { kind: 'steady', share: 0.2, skill: 'surges' },
    ],
  },
  {
    id: 'long', title: 'Long Open-Water Swim',
    why: 'Time in the water at race distance, so the distance stops being a question.',
    blocks: [
      { kind: 'steady', share: 0.25, skill: 'sighting' },
      { kind: 'reps', share: 0.6, repM: 800, key: 'steady', zone: 'Z2', rest: 45, label: 'continuous', skill: 'tempo' },
      { kind: 'skill', share: 0.15, skills: ['wetsuit', 'drafting'] },
    ],
  },
  {
    id: 'transition', title: 'Open-Water to Bike',
    why: 'The last two minutes of the swim and the first minute on land.',
    blocks: [
      { kind: 'reps', share: 0.45, repM: 300, key: 'css', zone: 'Z4', rest: 40, label: '@ race effort, hard final 50', skill: 'sighting' },
      { kind: 'skill', share: 0.3, skills: ['exit', 'entry'] },
      { kind: 'steady', share: 0.25, skill: 'tempo' },
    ],
  },
];

/* §5. Deliberately phrased so nothing here reads as permission: the session
   is a plan, the water is a judgement, and the athlete's is the one that
   counts. Kept short enough to actually be read. */
// The most of a session that may be unstructured skill work. Won by the
// 2026-07-18 sizing gauntlet against the old single template and kept as a
// hard ceiling here: an open-water session is race preparation first.
export const OW_SKILL_CEILING = 0.25;

export const OW_SAFETY = 'Open water: never swim alone, use a supervised venue and follow its rules, wear a bright cap and a tow float, and check conditions before you get in. Cold, current, weather or poor visibility all outrank this session. If the water is not safe today, swim the pool version instead.';

// Which category a session gets. Deterministic on the same (seed, salt,
// role) inputs the rest of the swim builder uses, so a rebuild is stable and
// a week's two swims cannot land on the same one (role walks the list the
// other way, the same argument pickDrills uses).
export function owCategory(seed, role) {
  const list = OW_CATEGORIES;
  // Deliberately NOT salted on duration. buildSwim's own contract is that
  // the variant menu never moves with dur, because trim, boost and the
  // de-collision resize all re-length a session and must return the SAME
  // session, shorter. Salting on duration rotated the category on every
  // five-minute step, so a 10% trim handed the athlete a different workout
  // with different skills and a different intent (review catch 2026-07-27).
  const base = (seed || 0) % list.length;
  // The role offsets the pick by exactly one. A reversed walk (the trick
  // pickDrills uses) does NOT work here, because only one item is chosen and
  // reversal collides whenever 2i is congruent to the list length minus one:
  // with five categories that is every i of 4. An offset of one can never
  // collide, since one is not congruent to zero for any list longer than one.
  const idx = (base + (role === 'quality' ? 1 : 0)) % list.length;
  return list[idx];
}

/* §4: the pool equivalent of a whole session. Same objective, same shape,
   between walls. Returned as display lines rather than a second workout:
   the athlete swaps the water, not the plan, so nothing about their week
   changes and no state has to be stored for it. */
export function poolFallback(workout) {
  if (!workout || workout.type !== 'Open Water') return null;
  const skills = (workout.segments || [])
    .map(s => s.ow && s.ow.skills).filter(Boolean)
    .reduce((all, list) => all.concat(list), []);
  const seen = new Set();
  const lines = [];
  skills.forEach(id => {
    const sk = OW_SKILLS[id];
    // A skill with no pool equivalent is left OUT rather than printed as an
    // instruction that instructs nothing (review catch 2026-07-27).
    if (!sk || seen.has(id) || sk.poolNone) return;
    seen.add(id);
    lines.push(sk.label + ': ' + sk.pool);
  });
  return {
    title: 'Same session in the pool',
    lead: 'Same objective, between walls. Swim the set as written and bring the open-water skills into it.',
    lines,
  };
}

/* §6: what open water the athlete has actually done. Reads recordings, not
   intentions, and reports only what it can see. Every field is derived, so
   nothing has to be stored and nothing can go stale. */
export const OW_EXPOSURE = { recentDays: 42 };
export function openWaterExposure({ activities, todayISO, days, workouts, logged }) {
  const window = days || OW_EXPOSURE.recentDays;
  const list = (activities || []).filter(a => a && a.type === 'OpenWaterSwim' && a.date);
  const recent = list.filter(a => {
    const d = daysBetweenISO(a.date, todayISO);
    return d >= 0 && d <= window;
  });
  const longest = recent.reduce((m, a) => Math.max(m, a.movingTimeSec || 0), 0);
  // Which open-water WORK the athlete has actually done, from the sessions
  // they logged against the plan. Counted per skill so race readiness can
  // say what is missing rather than only how much was swum.
  const drilled = {};
  let racePace = 0;
  (workouts || []).forEach(w => {
    if (!w || w.type !== 'Open Water' || !logged || !logged[w.id]) return;
    const seen = new Set();
    (w.segments || []).forEach(sg => {
      ((sg.ow && sg.ow.skills) || []).forEach(k => seen.add(k));
      // race-pace exposure is a property of the SET, not of a skill: a
      // session counts once if it held race effort at threshold or above
    });
    if ((w.segments || []).some(sg => (sg.blocks || []).some(b => b.zone === 'Z4' || b.zone === 'Z5'))) racePace++;
    seen.forEach(k => { drilled[k] = (drilled[k] || 0) + 1; });
  });
  const latest = list.map(a => a.date).sort().pop() || null;
  return {
    sessions: recent.length,
    minutes: Math.round(recent.reduce((t, a) => t + (a.movingTimeSec || 0), 0) / 60),
    longestMin: longest ? Math.round(longest / 60) : 0,
    longestM: recent.reduce((m, a) => Math.max(m, a.distance || 0), 0) || 0,
    lastDate: latest,
    daysSince: latest ? daysBetweenISO(latest, todayISO) : null,
    windowDays: window,
    // §6's remaining bullets, each counted from sessions actually completed
    wetsuitSessions: drilled.wetsuit || 0,
    sightingSessions: drilled.sighting || 0,
    startSessions: (drilled.start || 0) + (drilled.surges || 0),
    racePaceSessions: racePace,
    skills: drilled,
  };
}
function daysBetweenISO(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
