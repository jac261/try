/* Try — the durability SHAPE, per sport.
 *
 * durability.js answers "how did this session end" as one verdict. This
 * answers "what did the fade look like", which the Durability design doc
 * argues is a different chart per sport:
 *
 *   "Three shapes for one question, because the x-axis differs by sport: the
 *    bike measures fade against work done (kJ), the run against distance with
 *    heart rate as the tell, and the swim against distance with stroke count
 *    as the tell."
 *
 * Every entry point runs the session through usableDurabilityLaps first, so
 * the buckets are built from exactly the laps the verdict used. A card and
 * the verdict above it can therefore never disagree about which laps counted.
 *
 * Each returns null rather than a partial shape. A chart drawn from half a
 * session is worse than no chart: it looks like evidence.
 */
import { usableDurabilityLaps, durabilityRead, DURABILITY_GATES } from './durability.js';
import { lapStrokeMetrics } from './swim-strokes.js';

/* A shape may not outlive its read. usableDurabilityLaps is only the FIRST
   half of the read's gates — the window checks (maxLapShare, and the need for
   a usable first and last third) live in durabilityRead itself. Skipping them
   let a shape be built for a session the verdict refused: found on a real long
   ride whose 18-minute opening lap breaks maxLapShare, where the read was null
   and the shape was a full four buckets.

   Nothing could ever have drawn it — the card lists entries with a read — so
   this was storage for charts with no home, and worse, it let the shape and
   the verdict disagree about whether a session is readable at all. */
const readable = (rows, discipline, movingTimeSec) =>
  durabilityRead({ rows, discipline, movingTimeSec }) != null;

// Four buckets is the doc's own resolution (fresh + three), and it is about
// as fine as auto-laps support: below this the buckets stop holding enough
// laps each to mean anything.
export const SHAPE_BUCKETS = 4;
// A bucket built from fewer laps than this is arithmetic, not a reading.
export const MIN_LAPS_PER_BUCKET = 1;

const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);

/* Split laps into N buckets along a cumulative axis (kJ for the bike, metres
   for the run and swim), in recorded order. Buckets are equal spans of the
   axis, not equal lap counts: the doc's x-axis is the work done, so a bucket
   is "the stretch between 1 000 and 2 000 kJ" and may hold any number of
   laps. A bucket that ends up empty collapses the shape to null — an absent
   middle would be drawn as a straight line through it, inventing a fade or
   hiding one. */
function bucketBy(laps, axisOf) {
  const spans = laps.map(axisOf);
  const total = sum(spans, x => x);
  if (!(total > 0)) return null;
  const width = total / SHAPE_BUCKETS;
  const buckets = Array.from({ length: SHAPE_BUCKETS }, () => []);
  let acc = 0;
  laps.forEach((l, i) => {
    // place by the lap's MIDPOINT on the axis, so a long lap straddling a
    // boundary lands where most of it happened rather than where it started
    const mid = acc + spans[i] / 2;
    const idx = Math.min(SHAPE_BUCKETS - 1, Math.floor(mid / width));
    buckets[idx].push(l);
    acc += spans[i];
  });
  if (buckets.some(b => b.length < MIN_LAPS_PER_BUCKET)) return null;
  return { buckets, width, total };
}

// Time-weighted mean, the same convention durability.js uses: a mean of lap
// averages overweights short laps.
const timeMean = (w, f) => {
  const rows = w.filter(l => f(l) != null);
  const t = sum(rows, l => l.movingTimeSec);
  return t > 0 ? sum(rows, l => f(l) * l.movingTimeSec) / t : null;
};

const pct1 = v => Math.round(v * 10) / 10;

/* THE BIKE — threshold power as work accumulates.
 *
 * kJ is watts x seconds / 1000, which is why this is the bike's axis and
 * nobody else's: it is the only sport here where the device reports the work
 * directly. A rider fading at 3 000 kJ has a different problem from one
 * fading at 90 minutes, and the kJ number is the one that transfers to a
 * race plan ("Vichy sits at 2 400 kJ"). */
export function bikeDurabilityShape({ rows, movingTimeSec }) {
  if (!readable(rows, 'bike', movingTimeSec)) return null;
  const gated = usableDurabilityLaps({ rows, discipline: 'bike', movingTimeSec });
  if (!gated) return null;
  const laps = gated.usable.filter(l => l.averageWatts > 0);
  if (laps.length < DURABILITY_GATES.minLaps) return null;

  const kJ = l => (l.averageWatts * l.movingTimeSec) / 1000;
  const split = bucketBy(laps, kJ);
  if (!split) return null;

  const points = split.buckets.map((b, i) => ({
    // the axis value is the END of the bucket: "by 2 000 kJ", not "at 1 500"
    kJ: Math.round(split.width * (i + 1)),
    watts: Math.round(timeMean(b, l => l.averageWatts)),
    laps: b.length,
  }));
  if (points.some(p => !(p.watts > 0))) return null;

  const first = points[0].watts, last = points[points.length - 1].watts;
  return {
    sport: 'bike',
    axis: 'kJ',
    points,
    totalKJ: Math.round(split.total),
    // the headline: the doc's "−12 % at 3 000 kJ"
    dropPct: pct1((1 - last / first) * 100),
    holdPct: points.map(p => Math.round((p.watts / first) * 100)),
  };
}

/* THE RUN — pace held against a rising heart rate.
 *
 * Distance is the axis because that is how a run is planned and raced, and
 * heart rate is the tell: pace alone cannot separate "still running 4:55"
 * from "running 4:55 and paying much more for it". Decoupling is the two
 * read together, which is why this returns null without heart rate rather
 * than drawing pace on its own — a pace-only chart would be answering an
 * easier question while looking like it answered this one. */
export function runDurabilityShape({ rows, movingTimeSec }) {
  if (!readable(rows, 'run', movingTimeSec)) return null;
  const gated = usableDurabilityLaps({ rows, discipline: 'run', movingTimeSec });
  if (!gated) return null;
  const laps = gated.usable.filter(l => l.averageHeartrate > 0);
  if (laps.length < DURABILITY_GATES.minLaps) return null;

  const split = bucketBy(laps, l => l.distance);
  if (!split) return null;

  const points = split.buckets.map((b, i) => {
    const dist = sum(b, l => l.distance), sec = sum(b, l => l.movingTimeSec);
    return {
      metres: Math.round(split.width * (i + 1)),
      // seconds per km, the unit the app formats runs in
      pace: sec / (dist / 1000),
      hr: Math.round(timeMean(b, l => l.averageHeartrate)),
      laps: b.length,
    };
  });
  if (points.some(p => !(p.pace > 0) || !(p.hr > 0))) return null;

  const p1 = points[0], p2 = points[points.length - 1];
  // Aerobic decoupling: the pace-per-beat cost at the end against the start.
  // Positive means the same pace is costing more, which is the whole point.
  const cost1 = p1.pace * p1.hr, cost2 = p2.pace * p2.hr;
  return {
    sport: 'run',
    axis: 'm',
    points,
    totalM: Math.round(split.total),
    decouplingPct: pct1((cost2 / cost1 - 1) * 100),
    hrDriftPct: pct1((p2.hr / p1.hr - 1) * 100),
  };
}

/* THE SWIM — pace and stroke over the set.
 *
 * The 2x gap between the two stroke derivations turned out to be a UNIT
 * relationship, not an ambiguity — cadence counts full cycles, stride counts
 * arm strokes, measured at exactly 2.0000 across 43 real laps on two Garmin
 * models (2026-08-04). swim-strokes.js recognises it now and reports arm
 * strokes, so this reads a real count rather than refusing every swim, which
 * is what it did before that was measured.
 *
 * What this draws is still the WEAKER claim: the SHAPE within one session on
 * one device. The unit is known; the device's own definition of a stroke
 * still is not, and no cross-device comparison is made anywhere. So:
 *
 *   - it never quotes a stroke count as authoritative, and the card says
 *     "as your watch counts them";
 *   - ANY lap on a relationship swim-strokes.js does not recognise kills the
 *     whole shape, not just that lap. A chart missing its unreadable laps
 *     would silently be a different chart.
 *
 * Without a pool length there is no stroke reading at all, so no shape. */
export function swimDurabilityShape({ rows, movingTimeSec, poolLengthM }) {
  if (!poolLengthM) return null;
  if (!readable(rows, 'swim', movingTimeSec)) return null;
  const gated = usableDurabilityLaps({ rows, discipline: 'swim', movingTimeSec });
  if (!gated) return null;

  const withStrokes = [];
  for (const l of gated.usable) {
    const m = lapStrokeMetrics(l, { poolLengthM });
    if (!m) continue;
    // the refusal: one ambiguous lap and the session is unreadable
    if (m.mismatch) return null;
    if (m.strokes == null) continue;
    withStrokes.push({ lap: l, m });
  }
  if (withStrokes.length < DURABILITY_GATES.minLaps) return null;

  const laps = withStrokes.map(x => x.lap);
  const split = bucketBy(laps, l => l.distance);
  if (!split) return null;
  const metricFor = new Map(withStrokes.map(x => [x.lap, x.m]));

  const points = split.buckets.map((b, i) => {
    const dist = sum(b, l => l.distance), sec = sum(b, l => l.movingTimeSec);
    // strokes per length, so buckets of unequal distance stay comparable
    const spl = b.map(l => metricFor.get(l).strokesPerLength).filter(v => v != null);
    return {
      metres: Math.round(split.width * (i + 1)),
      pace100: sec / (dist / 100),
      strokesPerLength: spl.length ? Math.round((sum(spl, v => v) / spl.length) * 10) / 10 : null,
      laps: b.length,
    };
  });
  if (points.some(p => !(p.pace100 > 0) || p.strokesPerLength == null)) return null;

  const p1 = points[0], p2 = points[points.length - 1];
  return {
    sport: 'swim',
    axis: 'm',
    points,
    totalM: Math.round(split.total),
    // the doc's "+5 s per 100 by the last 500"
    paceDriftSec: Math.round((p2.pace100 - p1.pace100) * 10) / 10,
    strokeDrift: Math.round((p2.strokesPerLength - p1.strokesPerLength) * 10) / 10,
    // never an absolute claim; the card labels it as the device's own count
    deviceCounted: true,
  };
}

/* One entry point, so a caller does not have to know which sport reads which
   axis. The backfill uses this; it is also the seam a future sport plugs
   into. */
export function durabilityShape({ rows, discipline, movingTimeSec, poolLengthM }) {
  if (discipline === 'bike') return bikeDurabilityShape({ rows, movingTimeSec });
  if (discipline === 'run') return runDurabilityShape({ rows, movingTimeSec });
  if (discipline === 'swim') return swimDurabilityShape({ rows, movingTimeSec, poolLengthM });
  return null;
}
