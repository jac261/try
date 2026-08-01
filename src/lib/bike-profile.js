/* Try — what the curve says about the rider (phase 7 §3, §4).
 *
 * §3 lists five descriptive categories and then, in one line, says the thing
 * that actually governs this module: "Avoid reducing the athlete to one rigid
 * phenotype." That is not a stylistic preference. Phenotype labels — sprinter,
 * all-rounder, diesel — are sticky in a way that numbers are not: an athlete
 * told they are a diesel stops sprinting, and the label then makes itself
 * true. They also describe a rider on the day they were measured, against a
 * threshold that moves.
 *
 * So there is NO single label anywhere in this module, and a test asserts
 * that no field of the returned object could be used as one. What comes back
 * is five scores on a spectrum, the ends of that spectrum named as relative
 * strengths and relative limiters, and copy that says "relative to your own
 * threshold" every time — because that is all a curve read against one's own
 * FTP can honestly mean.
 *
 * §4's boundary is enforced the same way: implications are RETURNED, never
 * applied. Nothing here writes to a plan, and the one function that produces
 * training suggestions returns text for a human to accept or ignore.
 */
import { CURVE_DURATIONS, CURVE_LABELS, POWER_CURVE_RULES, QUALITY_ORDER, FTP_FROM_20MIN } from './bike-power-curve.js';

/* What a rider whose curve is unremarkable relative to their OWN threshold
   holds at each duration, as a fraction of FTP. These are shape references,
   not targets and not norms: the whole read is "where does this rider sit
   against their own threshold", so a rider with a low FTP and a low sprint is
   balanced, not weak. */
const SHAPE = {
  // short end: typical trained-cyclist multiples of threshold
  5: 4.0, 15: 3.0, 30: 2.4, 60: 1.8, 180: 1.38, 300: 1.25, 720: 1.10,
  /* long end, derived rather than chosen. FTP is defined here as 0.95 of a
     twenty-minute best, so a rider whose twenty-minute power is exactly what
     their FTP implies must read ZERO, not positive. Forty minutes sits just
     above threshold and an hour just below it. The first cut picked these by
     eye and every rider came out above shape at the long durations, which
     ranked durability and VO2 at the top of everyone's profile. */
  1200: 1 / FTP_FROM_20MIN,
  2400: 1.00,
  3600: 0.97,
};

/* The same reference as a curve, so the chart can draw it beside the rider's
   own. Exported instead of SHAPE itself: the table is a model detail, and a
   caller that reaches into it can start treating a shape reference as a
   target, which is exactly what these numbers are not. */
export function expectedShapeCurve(ftpWatts) {
  if (!ftpWatts) return [];
  return CURVE_DURATIONS
    .filter(d => SHAPE[d] != null)
    .map(d => ({ durationSec: d, watts: Math.round(SHAPE[d] * ftpWatts) }));
}

/* §3's five categories, each reading the durations that actually train it. */
/* `short` is for places where the full label does not fit or does not read:
   the spider's axis ring, where "Long-duration durability" ran off both
   edges of the chart, and the shape label, where the sentence is about a
   curve rather than a capability being formally named. */
export const CAPABILITIES = {
  sprint: { label: 'Sprint strength', short: 'Sprint', durations: [5, 15], why: 'what you can produce in a few seconds' },
  anaerobic: { label: 'Anaerobic capacity', short: 'Anaerobic', durations: [30, 60], why: 'how much you can spend above threshold before it costs you' },
  vo2: { label: 'VO2 power', short: 'VO2', durations: [180, 300], why: 'the ceiling your hardest intervals work against' },
  threshold: { label: 'Threshold strength', short: 'Threshold', durations: [720, 1200], why: 'the effort you can hold when it stops being fun' },
  durability: { label: 'Long-duration durability', short: 'Endurance', durations: [2400, 3600], why: 'whether the number still holds when the ride is long' },
};

export const PROFILE_RULES = {
  strongPct: 6,    // this far above your own shape = a relative strength
  limiterPct: -6,  // this far below = a relative limiter
  minDurationsPerCapability: 1,
};

/* §3: the profile. Five scores, no label, or null when there is not enough to
   say anything — which today is always, because the curve is gated. */
export function riderProfile({ curve, ftpWatts }) {
  if (!curve || !ftpWatts) return null;
  const usable = curve.points.filter(p =>
    QUALITY_ORDER.indexOf(p.quality) >= QUALITY_ORDER.indexOf(POWER_CURVE_RULES.minQuality));
  if (usable.length < POWER_CURVE_RULES.minPointsForProfile) return null;
  const byDuration = new Map(usable.map(p => [p.durationSec, p]));

  /* NORMALISED, so this describes a SHAPE and not a threshold.
   *
   * Every raw score is (watts/ftp - shape)/shape, so a uniform error in the
   * FTP moves all five capabilities by the same amount and the module cannot
   * tell a rider's shape from a mis-set threshold. The spread between a
   * ramp-test FTP and a twenty-minute-test FTP for the same rider is larger
   * than the +/-6% strength band, so a stale or differently-measured
   * threshold could manufacture five strengths or five limiters at once.
   * Subtracting the rider's own mean deviation removes exactly that common
   * term: what is left is where they sit RELATIVE TO THEMSELVES, which is the
   * only thing §3 asks for and the only thing a curve over one number can
   * honestly support. */
  const raw = {};
  Object.entries(CAPABILITIES).forEach(([key, cap]) => {
    const have = cap.durations.filter(d => byDuration.has(d));
    if (have.length < PROFILE_RULES.minDurationsPerCapability) return;
    const devs = have.map(d => (byDuration.get(d).watts / ftpWatts - SHAPE[d]) / SHAPE[d] * 100);
    raw[key] = { have, mean: devs.reduce((t, x) => t + x, 0) / devs.length };
  });
  const keys = Object.keys(raw);
  if (!keys.length) return null;
  const level = keys.reduce((t, k) => t + raw[k].mean, 0) / keys.length;

  const scores = {};
  Object.entries(CAPABILITIES).forEach(([key, cap]) => {
    if (!raw[key]) return;
    const have = raw[key].have;
    scores[key] = {
      key,
      label: cap.label,
      why: cap.why,
      /* Relative to the rider's own average, so the FTP's OFFSET cancels.
         Its SCALE does not: substituting k x ftp multiplies every score by
         1/k, so a stale high threshold flattens the shape toward even and a
         low one exaggerates it. Ordering is preserved either way, which is
         why the shape survives a wrong threshold and the magnitudes do not.
         This is why shapeLabel carries the threshold it used. */
      pct: Math.round((raw[key].mean - level) * 10) / 10,
      durations: have,
      // a capability read from one duration is a weaker claim than one read
      // from both, and says so rather than being quietly equivalent
      confidence: have.length === cap.durations.length ? 'medium' : 'low',
    };
  });
  if (!Object.keys(scores).length) return null;

  const ranked = Object.values(scores).sort((a, b) => b.pct - a.pct);
  return {
    scores,
    /* How far the whole curve sits from the reference, before normalisation.
       Kept because it is the honest place to notice a threshold that no
       longer matches the riding: a rider whose entire curve is 12% above
       shape has a stale FTP, not five strengths. */
    levelPct: Math.round(level * 10) / 10,
    ranked,
    strengths: ranked.filter(s => s.pct >= PROFILE_RULES.strongPct).map(s => s.key),
    limiters: ranked.filter(s => s.pct <= PROFILE_RULES.limiterPct).map(s => s.key),
    /* NO `phenotype`, NO `type`, NO `label` FOR THE RIDER. The absence is the
       feature, and the test that guards it is the point of §3. A profile with
       nothing above or below the bands is a rider who is even across the
       range, which is a real and common answer rather than a missing one. */
    /* Only claimable when the range was actually covered. With five points
       all at the short end, three capabilities scored and the module told the
       athlete their power was "even across the range" having seen one end of
       it. */
    even: Object.keys(scores).length === Object.keys(CAPABILITIES).length
      && ranked.every(s => s.pct < PROFILE_RULES.strongPct && s.pct > PROFILE_RULES.limiterPct),
    covered: Object.keys(scores).length,
    capabilities: Object.keys(CAPABILITIES).length,
    text: profileText(ranked, Object.keys(scores).length, Object.keys(CAPABILITIES).length),
  };
}

/* §3 REVISITED (Jon, 2026-08-01). Phase 7 shipped five scores and refused a
 * label, on the argument that "an athlete told they are a diesel stops
 * sprinting, and the label makes itself true". That reasoning is about a
 * particular KIND of label, and this is the other kind.
 *
 * The eight rules below are what separate them, and each one has a test:
 *
 *  1. The subject is the CURVE, never the rider. A state description does not
 *     become an identity the way "you are a sprinter" does.
 *  2. It carries its own coverage, so it never reads as more than it saw.
 *  3. It never renders without the five scores beside it (enforced at the
 *     render site, asserted here by the card's test).
 *  4. It states the margin that would change it, so it arrives with its exit.
 *  5. It says what it changed from, so the athlete watches it move.
 *  6. It returns null below the coverage floor.
 *  7. Nothing keys on it. No plan write, no coach input, no prescription.
 *  8. It names thin evidence rather than hiding it.
 *
 * The vocabulary is deliberately shape-descriptive and never a race
 * archetype. A capability here is measured against the rider's OWN
 * threshold, so "sprinter" would import a competitive meaning the data
 * cannot support: a 180 W rider with a relatively good sprint is not a
 * sprinter in any race. Those archetypes are also the stickiest words
 * available, which is the other half of the reason.
 *
 * ftpUsed rides along because the normalisation removes the FTP OFFSET but
 * not its SCALE: substituting k*ftp multiplies every score by 1/k, so a
 * stale high threshold flattens the shape toward even and a low one
 * exaggerates it. A label without its threshold is not reproducible.
 */
export const LABEL_RULES = {
  minCovered: 4,          // of five capabilities, before anything is named
};

/* Lowercased for mid-sentence use, except where the short name is an
   acronym: "leans toward vo2" reads like a typo. */
export function capabilityShort(key) {
  const short = CAPABILITIES[key] ? CAPABILITIES[key].short : key;
  return /\d/.test(short) ? short : short.toLowerCase();
}
const capShort = capabilityShort;

export function shapeLabel(profile, opts = {}) {
  if (!profile || !profile.scores) return null;
  const { ftpWatts = null, history = [] } = opts;
  if (profile.covered < LABEL_RULES.minCovered) return null;   // rule 6

  const strong = profile.ranked.filter(s => s.pct >= PROFILE_RULES.strongPct);
  const weak = profile.ranked.filter(s => s.pct <= PROFILE_RULES.limiterPct);

  /* The decider is what the sentence is ABOUT, and rule 4's margin is that
     capability's distance from the band it just cleared. An even curve has
     no decider, so its margin is the nearest approach from either side. */
  let text, decider = null, margin = null;
  if (strong.length) {
    decider = strong[0];
    text = strong.length > 1
      ? 'This curve leans toward ' + strong.slice(0, 2).map(s => capShort(s.key)).join(' and ')
      : 'This curve leans toward ' + capShort(decider.key);
    margin = Math.round((decider.pct - PROFILE_RULES.strongPct) * 10) / 10;
  } else if (weak.length) {
    decider = weak[weak.length - 1];
    text = 'This curve is held back at ' + capShort(decider.key);
    margin = Math.round((PROFILE_RULES.limiterPct - decider.pct) * 10) / 10;
  } else {
    text = 'This curve is even across the range';
    const nearest = profile.ranked.reduce((best, s) => {
      const d = Math.min(PROFILE_RULES.strongPct - s.pct, s.pct - PROFILE_RULES.limiterPct);
      return best && best.d <= d ? best : { s, d };
    }, null);
    if (nearest) { decider = nearest.s; margin = Math.round(nearest.d * 10) / 10; }
  }

  /* Rule 5. history is append-on-change, oldest first. If the newest entry
     matches, it records when this reading began and the one before it is
     what it replaced. If it does not match, the label has just moved and the
     newest entry IS what it moved from; the caller stamps the new one. */
  const last = history.length ? history[history.length - 1] : null;
  const changedFrom = !last ? null : (last.text === text
    ? (history.length > 1 ? history[history.length - 2].text : null)
    : last.text);
  const changedOn = last && last.text === text ? last.at : null;

  return {
    text,
    decider: decider ? decider.key : null,
    // rule 8: thin evidence is named, not hidden, and never silently averaged
    // in with a capability read from both its durations
    confidence: decider ? decider.confidence : null,
    marginToChange: margin,
    covered: profile.covered,
    capabilities: profile.capabilities,
    ftpUsed: ftpWatts,
    changedFrom,
    changedOn,
  };
}

function profileText(ranked, covered, total) {
  const strong = ranked.filter(s => s.pct >= PROFILE_RULES.strongPct);
  const weak = ranked.filter(s => s.pct <= PROFILE_RULES.limiterPct);
  const bits = [];
  if (!strong.length && !weak.length) {
    bits.push(covered === total
      ? 'Your power is even across the range, relative to your own threshold. That is a genuine result rather than a missing one, and it means no one duration is holding you back.'
      : 'Nothing stands out in the part of your range you have bests for, but ' + (total - covered)
        + ' of the ' + total + ' areas have no recent best to read, so this is a partial picture.');
  } else {
    /* The subject is the CURVE here too (2026-08-01). "You are strongest at
       vo2 power" sat directly above a label reading "this curve leans toward
       VO2", which is two voices for one fact, and the second-person one is
       the sticky formulation the label rules exist to avoid. Also fixes the
       acronym: the old copy lowercased the whole label and produced "vo2". */
    if (strong.length) bits.push('Against your own threshold this curve is strongest at '
      + strong.map(s => capabilityShort(s.key)).join(' and ') + '.');
    if (weak.length) bits.push('There is more room at ' + weak.map(s => capabilityShort(s.key)).join(' and ')
      + ' than elsewhere in the range.');
  }
  // said every time, because it is the only thing that makes the numbers mean
  // what they appear to mean
  bits.push('All of this is measured against your own threshold, so it describes the shape of your riding rather than how you compare to anybody else.');
  return bits.join(' ');
}

/* §4: what the profile suggests, as suggestions.
 *
 * Returned and never applied. §4 says the curve "should not automatically
 * rewrite the plan without review and explanation", so this produces the
 * explanation and stops; there is no code path from here to a plan, and the
 * no-caller guard in the tests is what keeps that honest in both directions. */
export function trainingImplications(profile) {
  if (!profile) return [];
  const OUT = {
    sprint: 'Your sprint is ahead of the rest of your range, so it needs maintaining rather than building.',
    anaerobic: 'You have more above-threshold capacity than your range suggests, which is worth spending in races rather than training further.',
    vo2: 'Your top end is ahead of your threshold, so the gains are in raising what you can hold, not in raising the ceiling.',
    threshold: 'Your threshold is the strong part of your range, which usually means the top end is where the next improvement is.',
    durability: 'You hold your numbers deep into long rides, which is the hardest of these to build and the most useful to have.',
  };
  const IN = {
    sprint: 'Short maximal efforts are the least developed part of your range. On a long-course plan that may not matter at all; it matters if your racing has surges in it.',
    anaerobic: 'Repeated efforts above threshold cost you more than the rest of your range suggests, which shows up on rolling courses and in group riding.',
    vo2: 'Your top end sits close to your threshold, so threshold work has little headroom above it. VO2 intervals are likely to move you more than more sweet spot would.',
    threshold: 'Your threshold sits low relative to your top end, which usually means more time at and just below it rather than more intervals above it.',
    durability: 'Your numbers fall away over long durations more than the rest of your range suggests. That is a fuelling and long-ride problem more often than a fitness one.',
  };
  const out = [];
  profile.strengths.forEach(k => out.push({ capability: k, kind: 'strength', text: OUT[k] }));
  profile.limiters.forEach(k => out.push({ capability: k, kind: 'limiter', text: IN[k] }));
  if (!out.length) {
    out.push({
      capability: null, kind: 'even',
      text: 'Nothing in your range stands out as a strength or a limiter, so the plan you are on is the right one: build everything, and let a gap appear before chasing it.',
    });
  }
  /* Every implication is explainable by construction: each one names the
     capability it came from, so §7's "training implications are explainable"
     is a property of the shape rather than a promise about the copy. */
  return out;
}

/* §6: the athlete-facing summary of one duration, with everything needed to
   judge it. Kept here rather than in a component so the wording and the
   caveats travel together. */
export function durationSummary({ point, ftpWatts, stale }) {
  if (!point) return null;
  return {
    durationSec: point.durationSec,
    label: CURVE_LABELS[point.durationSec] || (point.durationSec + ' sec'),
    watts: point.watts,
    pctOfFtp: ftpWatts ? Math.round(point.watts / ftpWatts * 100) : null,
    date: point.date,
    source: point.source,
    indoor: point.indoor,
    quality: point.quality,
    stale: !!stale,
    note: stale ? 'Set long enough ago that it may not describe you now.'
      : point.quality === 'low' ? 'Recorded, but not trusted well enough to read anything into.'
        : null,
  };
}

