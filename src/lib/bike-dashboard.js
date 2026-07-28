/* Try — phase 8: the bike dashboard.
 *
 * One question, the same one the swim dashboard answers: what is limiting my
 * bike, and what is the plan doing about it? Everything here is a pure read
 * over what phases 1 to 7 already built — the power anchor, the review
 * engine, durability, fuelling, bricks, position, the curve. Nothing
 * generates, nothing writes, nothing is stored.
 *
 * THREE RULES RUN THROUGH IT, and two of them are scars.
 *
 * Every number says where it came from, so a derived figure can never be read
 * as a measured one, and 'missing' is a first-class answer rather than a zero
 * pretending to be data (§9's "conclusions expose confidence").
 *
 * EVERY WINDOW IS THE WINDOW THE CARD CLAIMS. The swim dashboard shipped an
 * all-time completion rate inside a card headed "last 6 weeks", which is the
 * kind of error nobody notices because both halves are individually true.
 * Anything rolling here is computed over BIKE_DASH_RULES.weeks and nothing
 * else.
 *
 * AND A PLAN ON ITS FIRST DAY ACCUSES NOBODY. The same dashboard told
 * athletes they had completed 0% of their sessions before a single one had
 * come due. A rate over zero opportunities is not zero, it is absent.
 */
import { bikePowerAnchor, bikeThresholdHistory, RACES } from './domain.js';
import { daysBetween, iso, startOfWeekMonday, addDays } from './date.js';
import { metric } from './swim-dashboard.js';
import { isTrainingRide } from './bikeschema.js';
import { isIndoor, activityFor } from './autolog.js';
import { bikeDistance } from './bike-distance.js';
import { plannedBikeEfforts } from './bike-review.js';
import { bikeFuellingPlan, FUEL_LEVEL_GRAMS, FUELLING_RULES } from './bike-fuelling.js';
import { longRideObjective, LONG_OBJECTIVES } from './bike-long.js';
import { positionRead, positionTolerance } from './bike-position.js';
import { brickHistory } from './brick.js';

export const BIKE_DASH_RULES = {
  weeks: 6,              // the window every rolling figure uses
  completionFloor: 0.7,  // below this, consistency is the limiter
  minSessions: 4,        // below this there is no completion rate worth naming
  /* Mirrors BIKE_REVIEW_RULES.fadeSoftPct, and is written out rather than
     imported. Reading another module's constant AT MODULE SCOPE inside a
     circular import graph resolves to undefined — the review engine is still
     initialising when this file evaluates — which is the same temporal dead
     zone the phase 5 rep table hit. A test asserts the two stay equal, so the
     duplication cannot drift. */
  fadeConcern: 3,
  driftConcern: 5,       // heart-rate drift, percent
  indoorHeavy: 0.8,      // riding this much indoors is worth naming
};

const QUALITY_TYPES = ['Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'];

/* Rides in the window. `to` is EXCLUSIVE of today by default: a session
   scheduled for today has not come due, and counting it as a missed
   opportunity is the same error as the day-one 0% this module's header
   promises not to repeat. */
function ridesIn({ plan, moves, from, to, bikeOnly }) {
  return (plan && plan.weeks ? plan.weeks.flatMap(w => w.workouts) : [])
    .filter(w => (isTrainingRide(w) || (!bikeOnly && w.discipline === 'brick' && !w.race)))
    .map(w => ({ w, date: (moves && moves[w.id]) || w.date }))
    .filter(x => x.date >= from && x.date < to);
}

/* How many weeks of the window the plan actually covers. Dividing by six
   regardless meant an athlete two weeks into a plan read a third of their
   real weekly volume, and one past their race read a fraction of it — both
   under labels saying "a week". */
function weeksCovered({ plan, from, to }) {
  const dates = (plan && plan.weeks ? plan.weeks.flatMap(w => w.workouts) : []).map(w => w.date);
  if (!dates.length) return BIKE_DASH_RULES.weeks;
  const lo = dates.reduce((a, b) => (a < b ? a : b));
  const hi = dates.reduce((a, b) => (a > b ? a : b));
  const start = lo > from ? lo : from;
  const end = hi < to ? hi : to;
  const days = (Date.parse(end) - Date.parse(start)) / 86400000;
  return Math.max(1, Math.min(BIKE_DASH_RULES.weeks, Math.round(days / 7) || 1));
}

/* §2: where the athlete is now.
 *
 * §9's first acceptance criterion lives here: real and estimated FTP are
 * never conflated. They are different FIELDS, not one field with a flag, so
 * a caller cannot render an estimate in the place a measurement belongs by
 * forgetting to check something. */
function status({ plan, log, moves, activities, todayISO }) {
  const profile = (plan && plan.profile) || {};
  const anchor = bikePowerAnchor(profile);
  const meta = profile.ftpMeta || {};
  const from = iso(addDays(startOfWeekMonday(new Date(todayISO)), -7 * (BIKE_DASH_RULES.weeks - 1)));
  const window = ridesIn({ plan, moves, from, to: todayISO });
  const done = window.filter(x => log && log[x.w.id]);
  /* Bike-only for anything that describes RIDING. A brick is a ride, a
     transition and a run, and counting its whole duration credited the run
     leg as cycling — a 90-minute brick could win "longest ride" on the
     strength of a 30-minute run inside it. */
  const bikeDone = ridesIn({ plan, moves, from, to: todayISO, bikeOnly: true })
    .filter(x => log && log[x.w.id]);
  const weeks = weeksCovered({ plan, from, to: todayISO });

  // recordings matched to this window, so the indoor split is about the
  // athlete's actual riding rather than about what was planned
  const recs = (activities || []).filter(a => a && /Ride/i.test(a.type || '')
    && a.date >= from && a.date <= todayISO && a.movingTimeSec != null);
  const indoorMin = recs.filter(isIndoor).reduce((t, a) => t + a.movingTimeSec / 60, 0);
  const outdoorMin = recs.filter(a => !isIndoor(a)).reduce((t, a) => t + a.movingTimeSec / 60, 0);
  const outdoorShare = (indoorMin + outdoorMin) > 0 ? outdoorMin / (indoorMin + outdoorMin) : 1;

  return {
    // real, or null. NEVER filled in from the estimate.
    ftpWatts: anchor.kind === 'real' ? metric(anchor.ftpWatts, 'recorded', 'W') : metric(null, 'missing'),
    ftpSource: anchor.kind === 'real' ? metric(anchor.source, 'recorded') : metric(null, 'missing'),
    ftpDate: anchor.kind === 'real' && meta.measuredAt ? metric(meta.measuredAt, 'recorded') : metric(null, 'missing'),
    ftpConfidence: anchor.kind === 'real' ? metric(meta.confidence || 'unknown', 'derived') : metric(null, 'missing'),
    /* Shown SEPARATELY and only when there is no real one, which is §2's own
       wording and the whole of §9's first criterion. */
    estimatedFtpWatts: anchor.kind === 'estimated' ? metric(anchor.ftpWatts, 'estimated', 'from your level and weight') : metric(null, 'missing'),
    wkg: profile.ftp && profile.weightKg
      ? metric(Math.round(profile.ftp / profile.weightKg * 100) / 100, 'derived', 'W/kg')
      : metric(null, 'missing'),
    ridesPerWeek: window.length
      ? metric(Math.round(done.length / weeks * 10) / 10, 'derived')
      : metric(null, 'missing'),
    weeklyMinutes: bikeDone.length
      ? metric(Math.round(bikeDone.reduce((t, x) => t + (x.w.durationMin || 0), 0) / weeks), 'derived')
      : metric(null, 'missing'),
    /* §8: OUTDOOR only, and estimated. Indoor virtual distance never enters
       an outdoor figure — a trainer's kilometres are its wheel model's
       opinion, and mixing them into a distance trend makes the trend a
       statement about how often somebody rode inside. */
    /* Scaled by the share actually ridden OUTSIDE. The figure is modelled
       from planned segments, and the plan carries no indoor flag, so a rider
       who did every session on a turbo was shown "~420 km outdoors" beside
       copy insisting indoor rides never contribute distance. */
    outdoorDistanceKm: bikeDone.length && outdoorShare > 0
      ? metric(Math.round(bikeDone.reduce((t, x) => t + bikeDistance(x.w.segments || [], plan.paces), 0) * outdoorShare),
        'estimated', 'modelled from each session’s zone mix and how much of your riding was outdoors, not measured')
      : metric(null, 'missing', recs.length ? 'you have ridden entirely indoors in this window' : null),
    indoorMinutes: recs.length ? metric(Math.round(indoorMin), 'recorded') : metric(null, 'missing'),
    outdoorMinutes: recs.length ? metric(Math.round(outdoorMin), 'recorded') : metric(null, 'missing'),
    indoorShare: (indoorMin + outdoorMin) > 0
      ? metric(Math.round(indoorMin / (indoorMin + outdoorMin) * 100), 'derived', '% of your riding time')
      : metric(null, 'missing'),
    /* §1 asks "can I complete the prescribed work?", and the answer is about
       ALL of it. Judging consistency on quality sessions alone let an athlete
       who skipped every endurance ride read as consistent — and in a base
       block, where there may be no quality rides scheduled at all, it left
       the question unanswerable for weeks. */
    completion: window.length >= BIKE_DASH_RULES.minSessions
      ? metric(Math.round(done.length / window.length * 100) / 100, 'derived')
      : metric(null, 'missing', 'not enough rides have come due yet'),
    /* §1's FIRST question is "is my FTP improving?", and the status block
       answered where it is rather than where it came from. bikeThresholdHistory
       was written in phase 2 for exactly this — its own comment cites the swim
       dashboard's history bug — and had no consumer anywhere until now. */
    ftpTrend: (() => {
      const hist = bikeThresholdHistory(profile).filter(h => h.ftpWatts);
      if (hist.length < 2) {
        return metric(null, 'missing', 'one measurement so far, so there is no trend to read yet');
      }
      const first = hist[0], last = hist[hist.length - 1];
      const delta = last.ftpWatts - first.ftpWatts;
      return metric(delta, 'recorded',
        'W since ' + (first.date ? first.date : 'your first measurement')
        + ' (' + first.ftpWatts + ' W to ' + last.ftpWatts + ' W)');
    })(),
    ftpHistory: bikeThresholdHistory(profile),
    sessions: done.length,
    planned: window.length,
    windowFrom: from,
  };
}

/* §3: the quality work, and whether it is landing.
 *
 * Time in zone counts EFFORTS, not sessions. A ninety-minute threshold ride
 * is fifteen minutes of threshold and seventy-five of everything else, and
 * counting the session would make the number about how long the athlete rode
 * rather than about how much work they did. */
function quality({ plan, log, moves, todayISO, retest }) {
  const from = iso(addDays(startOfWeekMonday(new Date(todayISO)), -7 * (BIKE_DASH_RULES.weeks - 1)));
  const window = ridesIn({ plan, moves, from, to: todayISO }).filter(x => QUALITY_TYPES.includes(x.w.type));
  const done = window.filter(x => log && log[x.w.id]);
  const minutesIn = zone => done.reduce((t, x) =>
    t + plannedBikeEfforts(x.w).filter(e => e.zone === zone).reduce((s, e) => s + e.min, 0), 0);

  /* STORED reviews are the only honest source, exactly as the swim dashboard
     decided. They ride on the log entry, the way swimReview does, and that
     column is still an open backend ask — so today this is empty and the
     dashboard SAYS SO rather than guessing adherence from whole-ride
     averages, which is the very thing the phase 5 engine exists to avoid.
     A caller-supplied array was the first cut and it was worse than nothing:
     App had no reviews to give, so it passed an empty one, and every metric
     here read "missing" while the plumbing looked complete. */
  const rv = (plan.weeks ? plan.weeks.flatMap(w => w.workouts) : [])
    .filter(w => log && log[w.id] && log[w.id].bikeReview)
    .map(w => ({
      ...log[w.id].bikeReview,
      date: (log[w.id].at || '').slice(0, 10) || (moves && moves[w.id]) || w.date,
    }))
    .filter(r => r.date >= from && r.date <= todayISO)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const adh = rv.filter(r => r.powerAdherence != null);
  const fades = rv.filter(r => r.intervalFadePercent != null);

  return {
    // Z3 holds both tempo and sweet spot; they are separated by TYPE, since
    // the zone alone cannot tell them apart
    sweetSpotMin: done.length ? metric(Math.round(done.filter(x => x.w.type === 'Sweet Spot')
      .reduce((t, x) => t + plannedBikeEfforts(x.w).reduce((s, e) => s + e.min, 0), 0)), 'derived') : metric(null, 'missing'),
    thresholdMin: done.length ? metric(Math.round(minutesIn('Z4')), 'derived') : metric(null, 'missing'),
    vo2Min: done.length ? metric(Math.round(minutesIn('Z5')), 'derived') : metric(null, 'missing'),
    /* A rate needs opportunities. With nothing due yet this is MISSING, not
       zero: the swim dashboard told day-one athletes they had completed 0%
       of sessions that had not come round. */
    completion: window.length >= BIKE_DASH_RULES.minSessions
      ? metric(Math.round(done.length / window.length * 100) / 100, 'derived')
      : metric(null, 'missing', 'not enough quality sessions have come due yet'),
    adherence: adh.length
      ? metric(Math.round(adh.reduce((t, r) => t + r.powerAdherence, 0) / adh.length * 10) / 10, 'recorded', '% from the prescription')
      : metric(null, 'missing'),
    fade: fades.length
      ? metric(Math.round(fades.reduce((t, r) => t + r.intervalFadePercent, 0) / fades.length * 10) / 10, 'recorded', '% in the closing efforts')
      : metric(null, 'missing'),
    outcomes: rv.length ? rv.reduce((m, r) => { m[r.outcome] = (m[r.outcome] || 0) + 1; return m; }, {}) : null,
    reviews: rv.length,
    reviewNote: rv.length ? null
      : 'Per-session review needs your rides matched to recordings with lap data, and those reviews stored. Nothing here is guessed from ride averages in the meantime.',
    nextFtp: retest ? metric(retest.headline, 'derived', retest.why) : metric(null, 'missing'),
    sessions: done.length,
    planned: window.length,
  };
}

/* §4: whether it holds up when the ride is long. */
function durability({ plan, log, moves, activities, todayISO, durabilityReads, fuelLog, positionLog, paces }) {
  const from = iso(addDays(startOfWeekMonday(new Date(todayISO)), -7 * (BIKE_DASH_RULES.weeks - 1)));
  const window = ridesIn({ plan, moves, from, to: todayISO });
  const done = window.filter(x => log && log[x.w.id]);
  const bikeDone = ridesIn({ plan, moves, from, to: todayISO, bikeOnly: true })
    .filter(x => log && log[x.w.id]);
  const reads = (durabilityReads || []).filter(r => r && r.discipline === 'bike'
    && r.date >= from && r.date <= todayISO);
  const fades = reads.filter(r => r.read && r.read.outputDropPct != null);
  const drifts = reads.filter(r => r.read && r.read.hrDriftPct != null);

  // §3's fuelling half: did the athlete take in what the session asked for?
  const fuelled = done.map(x => {
    const fp = bikeFuellingPlan({ workout: x.w, profile: plan.profile, fuelLog });
    if (!fp) return null;
    /* The CANONICAL matcher, not the first ride of the day. Taking the first
       recording meant a fifteen-minute commute logged before a five-hour ride
       either erased the long ride's fuel answer or, worse, scored the
       commute's honest "nothing" against the long ride's carbohydrate target
       — turning an athlete who fuelled every long ride at race level into one
       reading 0% compliance, with fuelling named as their limiter. */
    const act = activityFor({ workout: x.w, activities: activities || [], moves });
    const lvl = act && fuelLog && fuelLog[act.id] && fuelLog[act.id].level;
    if (!lvl) return null;
    // the shortfall rule belongs to bike-fuelling, boundary included: a
    // deficit of exactly the shortfall IS short, and duplicating it here with
    // a flipped comparison made the two modules disagree about the same ride
    return !(FUEL_LEVEL_GRAMS[lvl] - fp.carbsPerHour <= -FUELLING_RULES.shortfallGrams);
  }).filter(v => v !== null);

  /* NEWEST FIRST, and windowed. positionTolerance takes the first few of what
     it is given, and the store appends — so handing it Object.values gave it
     the OLDEST answers, and a rider whose position had been fine for months
     was told they keep coming out of it because of four answers from the
     spring. The other caller sorts; this one did not, and the two disagreed
     about the same athlete on the same screen. */
  const posReads = Object.values(positionLog || {})
    .map(r => positionRead(r)).filter(Boolean)
    .filter(r => !r.date || (r.date.slice(0, 10) >= from && r.date.slice(0, 10) <= todayISO))
    .sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
  const tolerance = positionTolerance(posReads);

  const objectives = done.map(x => longRideObjective({ workout: x.w, seed: x.w.seed }))
    .filter(Boolean);

  return {
    longestRideMin: bikeDone.length
      ? metric(Math.max(...bikeDone.map(x => x.w.durationMin || 0)), 'derived') : metric(null, 'missing'),
    lateFadePct: fades.length
      ? metric(Math.round(fades.reduce((t, r) => t + r.read.outputDropPct, 0) / fades.length * 10) / 10, 'recorded', '% down in the closing third')
      : metric(null, 'missing'),
    hrDriftPct: drifts.length
      ? metric(Math.round(drifts.reduce((t, r) => t + r.read.hrDriftPct, 0) / drifts.length * 10) / 10, 'recorded', '%')
      : metric(null, 'missing'),
    fuellingMet: fuelled.length
      ? metric(Math.round(fuelled.filter(Boolean).length / fuelled.length * 100), 'reported', '% of long rides fuelled to plan')
      : metric(null, 'missing', 'no fuelling answers logged yet'),
    /* §4 asks for "aero duration". There is no position channel, so what
       exists is the athlete's own tolerance read, which is reported as such
       and never dressed up as a measured aero time. */
    positionTolerance: tolerance.verdict === 'unknown'
      ? metric(null, 'missing', tolerance.text)
      : metric(tolerance.verdict, 'reported', tolerance.text),
    longestPositionMin: tolerance.longestMin ? metric(tolerance.longestMin, 'reported') : metric(null, 'missing'),
    objectives: objectives.length
      ? metric(objectives.reduce((m, o) => { m[o.primary] = (m[o.primary] || 0) + 1; return m; }, {}), 'derived')
      : metric(null, 'missing'),
    objectiveLabels: LONG_OBJECTIVES,
    reads: reads.length,
  };
}

/* §5: ONE primary limiter, with the evidence for it and §6's plan response.
 *
 * One, not a ranked list: a dashboard that names five limiters has named
 * none, and the athlete cannot act on five things at once. The order below is
 * the order these things actually block progress in. */
/* §5: ONE primary limiter, with the evidence for it and §6's plan response.
 *
 * One, not a ranked list: a dashboard that names five limiters has named
 * none, and the athlete cannot act on five things at once.
 *
 * ORDER IS BY URGENCY OF EVIDENCE, NOT BY SEVERITY OF TOPIC. Missing data
 * used to rank second, above every branch that fires on something actually
 * measured, so a rider with a recorded brick pattern, a fade and 5% fuelling
 * compliance was told only that their targets were guesses. Absence now
 * yields to presence: things that are HAPPENING outrank things that are
 * unknown.
 *
 * AND EVERY RESPONSE HAS TO BE TRUE. These render under "What the plan does
 * about it", and four of them described behaviour no phase ever built — the
 * plan holding intensity before a brick, prescribing position work, adding
 * long-ride duration off a durability read. Where the plan genuinely does
 * something, it is named; where it does not, the response says the action is
 * the athlete's, which is a useful sentence and an honest one. */
export function bikeLimiter(d) {
  const out = (id, headline, evidence, response) => ({ id, headline, evidence, response });
  const comp = d.status.completion.value;

  if (comp != null && comp < BIKE_DASH_RULES.completionFloor) {
    return out('consistency', 'Consistency is limiting your bike',
      ['You have completed ' + Math.round(comp * 100) + '% of your planned rides in the last '
        + BIKE_DASH_RULES.weeks + ' weeks.',
        'Progression needs the sessions to happen before it can ask for more.'],
      ['Missed sessions are never made up: the week moves on rather than piling up behind you.',
        'Nothing else on this page can mean much until the sessions are happening.']);
  }
  if (d.brick && d.brick.pattern) {
    return out('bike-to-run', 'Your bike pacing is costing you the run',
      [d.brick.pattern.text],
      ['This one is yours to act on: nothing in the plan changes the bike leg automatically.',
        'Ride it easier than feels right. The time you give up on the bike is smaller than the time the run takes back.']);
  }
  if (d.durability.lateFadePct.value != null && d.durability.lateFadePct.value > BIKE_DASH_RULES.fadeConcern) {
    return out('durability', 'Durability is limiting your bike',
      ['Your output falls about ' + d.durability.lateFadePct.value + '% in the closing third of long rides.',
        d.durability.hrDriftPct.value != null
          ? 'Heart rate drifts ' + d.durability.hrDriftPct.value + '% over the same window.'
          : 'No heart-rate data on those rides, so the cardiac half of this is unread.'],
      ['Your long rides already rotate through late-ride stability work, which rehearses exactly this.',
        'If the fade deepens and your heart rate confirms it, the coach holds your progression rather than building on top of it.']);
  }
  if (d.durability.fuellingMet.value != null && d.durability.fuellingMet.value < 50) {
    return out('fuelling', 'Fuelling is limiting your long rides',
      ['You hit the fuelling plan on ' + d.durability.fuellingMet.value + '% of your long rides.',
        'On a ride over three hours that gap is usually what the last hour felt like.'],
      ['Every long ride carries a carbohydrate target, and it only ever moves one step above what you have logged managing.',
        'That step is the training: the gut adapts to it the way the legs adapt to the riding.']);
  }
  if (d.quality.adherence.value != null && d.quality.adherence.value <= -BIKE_DASH_RULES.fadeConcern) {
    return out('threshold', 'Threshold is limiting your bike',
      ['Recent quality efforts are coming in below their targets.',
        'That usually means the targets are set too high rather than that you are unfit.'],
      ['When several sessions agree, the plan recommends a fresh FTP test rather than moving the number on its own.',
        'Your targets are all built from that one figure, so it is the thing worth getting right.']);
  }
  if (d.durability.positionTolerance.value === 'back-off') {
    return out('aero-tolerance', 'Position tolerance is limiting your race setup',
      [d.durability.positionTolerance.note],
      ['This one is yours: the plan does not prescribe time in position, it only asks you about it afterwards.',
        'Ride the position in shorter blocks and build the time back up. This says nothing about your bike fit.']);
  }
  /* Missing data ranks BELOW everything measurable, and above nothing else,
     because it is the reason the rest of the page is quiet. */
  if (d.status.ftpWatts.value == null) {
    return out('data-confidence', 'Your bike targets are guesses',
      ['No FTP has been measured, so every watt target is derived from your level.',
        'Nothing on this page can judge your riding until that changes.'],
      [d.testAhead
        ? 'Your plan has a bike test on ' + d.testAhead + ': twenty minutes as hard as you can hold, and your FTP is 95% of the average.'
        : 'Your plan’s bike test has already passed. You can ride the twenty-minute effort any time and enter the number under Update fitness.',
        'Once there is a real number, every bike target re-anchors to you.']);
  }
  const hasQuality = d.quality.adherence.value != null;
  /* An all-clear and an absence-of-data are different answers and used to
     share a headline: "Nothing is obviously holding your bike back" sat in
     the largest text on the card above its own evidence line saying there was
     not enough data to name a limiter. */
  if (comp == null && !hasQuality) {
    return out('too-early', 'Not enough riding yet to name a limiter',
      ['Your plan has not been running long enough for the figures below to mean much.',
        'They fill in as sessions are completed and recordings are matched.'],
      ['The plan progresses as written in the meantime.']);
  }
  return out('none', 'Nothing is obviously holding your bike back',
    ['You are completing your planned rides.',
      ...(hasQuality ? ['Your quality efforts are landing on target.']
        : ['Per-session review data would let this page say more about how they land.'])],
    ['The plan continues to progress as written.']);
}

/* The whole model. One call, one pure object. */
export function bikeDashboard({
  plan, log, moves, activities, todayISO, retest,
  durabilityReads, fuelLog, positionLog,
}) {
  if (!plan || !plan.weeks) return null;
  const today = todayISO || iso(new Date());
  const st = status({ plan, log, moves, activities, todayISO: today });
  const ql = quality({ plan, log, moves, todayISO: today, retest });
  const du = durability({
    plan, log, moves, activities, todayISO: today, durabilityReads, fuelLog, positionLog, paces: plan.paces,
  });
  const brick = brickHistory({
    plan, activities: activities || [], log, moves, paces: plan.paces, fuelLog, limit: 3,
  });
  const d = {
    windowWeeks: BIKE_DASH_RULES.weeks,
    status: st, quality: ql, durability: du, brick,
    race: RACES[(plan.profile || {}).raceType] || null,
    // the race date lives on the PROFILE; the top-level field does not exist,
    // so this was permanently null
    daysToRace: (plan.profile || {}).raceDate ? daysBetween(today, plan.profile.raceDate) : null,
  };
  /* Whether a bike test actually remains ahead of the athlete, so the
     response can stop promising one that has already gone past. */
  const tests = plan.weeks.flatMap(w => w.workouts)
    .filter(w => w.test && w.testKind === 'bikeFtp' && !(log && log[w.id]))
    .map(w => (moves && moves[w.id]) || w.date)
    .filter(dt => dt >= today).sort();
  d.testAhead = tests.length ? tests[0] : null;
  d.limiter = bikeLimiter(d);
  return d;
}
