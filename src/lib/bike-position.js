/* Try — aero position tolerance (phase 6 §5).
 *
 * §5 asks for total aero time, longest continuous aero block and power
 * retained in aero. None of them can be computed: the activity feed carries
 * aggregates only, with no position channel, no cadence and no streams, so
 * there is nothing that knows whether the rider was on the bars or on the
 * hoods. Inventing aero time from, say, a speed threshold would be a guess
 * about the one variable this whole section is about.
 *
 * So it is a SELF-REPORT, on the same pattern as the fuel tap that already
 * works: one question after a long ride, answered in the athlete's own terms,
 * accumulating into a tolerance the plan can progress against.
 *
 * §5's own boundary is the important one and is enforced here rather than
 * hoped for: "This should guide progression, not diagnose bike fit." A run of
 * bad answers means ride shorter in position and build up, never "your saddle
 * is too high". Symptoms are recorded because they are what an athlete
 * actually notices, and they are reported back to the athlete as something to
 * take to a fitter, never interpreted.
 *
 * IT IS KEPT SEPARATE FROM FTP, which §5 asks for and §6's acceptance
 * criteria repeat. An athlete who can hold 250 W on the hoods and 215 W on
 * the bars does not have a threshold problem, and folding the two together
 * would produce a number that describes neither. Nothing here touches the
 * power anchor, and a test asserts it.
 */

export const AERO_COMFORT = {
  easy: 'Comfortable throughout',
  ok: 'Fine, but I moved about',
  hard: 'Had to sit up',
  bad: 'Could not hold it',
};
export const AERO_COMFORT_SCORE = { easy: 3, ok: 2, hard: 1, bad: 0 };

/* The places a time-trial position actually complains, in the order riders
   tend to notice them. Recorded, never diagnosed. */
export const AERO_SYMPTOMS = {
  neck: 'Neck',
  shoulders: 'Shoulders',
  hands: 'Hands or arms',
  saddle: 'Saddle',
  back: 'Lower back',
};

export const POSITION_RULES = {
  minRideMin: 90,        // shorter than this and position was never the limiter
  window: 4,             // reads considered for a tolerance verdict
  minReads: 3,
  buildScore: 2.5,       // average at or above this = ready for more
  backOffScore: 1,       // at or below this = shorten the position work
  repeatSymptomReads: 2, // the same complaint this often is a pattern
};

/* Whether this session is even worth asking about. A forty-minute ride tells
   you nothing about position tolerance, and asking anyway trains athletes to
   dismiss the question. */
export function positionAsk(workout) {
  if (!workout || workout.discipline !== 'bike') return false;
  if (!['Long', 'Endurance', 'Threshold', 'Sweet Spot'].includes(workout.type)) return false;
  return (workout.durationMin || 0) >= POSITION_RULES.minRideMin;
}

/* One stored answer: { comfort, symptoms: [], minutes } against a recording. */
export function positionRead({ comfort, symptoms, minutes, date }) {
  if (!comfort || AERO_COMFORT_SCORE[comfort] == null) return null;
  return {
    comfort,
    score: AERO_COMFORT_SCORE[comfort],
    symptoms: (symptoms || []).filter(s => AERO_SYMPTOMS[s]),
    minutes: minutes || null,
    date: date || null,
  };
}

/* §5: tolerance over a window of reads, and what to do about it.
 *
 * One ride is never a verdict here for the same reason it is never a verdict
 * anywhere else in this module: a bad day in the heat, a new saddle, a hard
 * week. The pattern is the product. */
export function positionTolerance(reads) {
  const usable = (reads || []).filter(r => r && AERO_COMFORT_SCORE[r.comfort] != null)
    .slice(0, POSITION_RULES.window);
  if (usable.length < POSITION_RULES.minReads) {
    return {
      verdict: 'unknown', reads: usable.length,
      text: 'Not enough long rides answered yet to say how your position is holding up.',
    };
  }
  const avg = usable.reduce((t, r) => t + AERO_COMFORT_SCORE[r.comfort], 0) / usable.length;
  const longest = Math.max(...usable.map(r => r.minutes || 0));

  // a complaint that keeps coming back, named but never explained
  const counts = {};
  usable.forEach(r => (r.symptoms || []).forEach(s => { counts[s] = (counts[s] || 0) + 1; }));
  const recurring = Object.keys(counts).filter(s => counts[s] >= POSITION_RULES.repeatSymptomReads);

  const verdict = avg >= POSITION_RULES.buildScore ? 'build'
    : avg <= POSITION_RULES.backOffScore ? 'back-off' : 'hold';
  const bits = [];
  if (verdict === 'build') {
    bits.push('Your position has been comfortable across your recent long rides'
      + (longest ? ', the longest of them ' + Math.round(longest) + ' minutes' : '')
      + '. Worth extending the time you spend in it.');
  } else if (verdict === 'back-off') {
    bits.push('You have been coming out of position on your recent long rides. Ride the position in shorter blocks and build the time back up, rather than trying to hold it and failing later in the ride.');
  } else {
    bits.push('Your position is holding, but not comfortably. Keep the time in it where it is for now rather than extending it.');
  }
  if (recurring.length) {
    // §5's boundary, in the copy: reported, not diagnosed
    bits.push(recurring.map(s => AERO_SYMPTOMS[s].toLowerCase()).join(' and ')
      + ' came up on more than one ride. That is worth mentioning to a bike fitter, who can see things the plan cannot.');
  }
  return { verdict, reads: usable.length, avgScore: Math.round(avg * 10) / 10, longestMin: longest || null, recurring, text: bits.join(' ') };
}
