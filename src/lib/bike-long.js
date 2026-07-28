/* Try — what a Long ride is FOR (phase 6 §1).
 *
 * A Long ride has always been a duration with a block bolted on, and every
 * one of them said the same thing: build endurance, practise your fuelling.
 * §1 asks that they rotate between purposes, and that "not every Long ride
 * should become harder" — which is the more important half, because the easy
 * failure mode of a durability system is that every long ride grows a harder
 * block until the athlete is doing threshold work at hour four every week.
 *
 * OBJECTIVES ARE DERIVED, NOT GENERATED. The builder already rotates three
 * structurally different Long rides, and they already ARE different purposes:
 * tempo surges, sweet-spot blocks, and threshold efforts explicitly "on tired
 * legs". Reading the purpose back off the session that was built costs no
 * change to anybody's plan, cannot drift from what the card actually says,
 * and survives a trim, a boost and a rebuild for free. Inventing a parallel
 * objective field and storing it would have to survive the wire, and the wire
 * drops what it does not type.
 *
 * The REHEARSAL focus is the part that rotates independently: fuelling,
 * position and terrain are things you practise during a long ride whatever
 * its block is doing, so they cycle on the week index and are never all
 * demanded at once.
 */

export const LONG_OBJECTIVES = {
  'pure-endurance': {
    label: 'Pure endurance',
    why: 'Time in the saddle, nothing more. This is the ride that builds the base everything else sits on, and it is meant to feel unremarkable.',
  },
  'aerobic-durability': {
    label: 'Aerobic durability',
    why: 'Steady riding with sustained blocks late enough to matter. The point is holding the same output when the ride is no longer fresh.',
  },
  'late-ride-stability': {
    label: 'Late-ride stability',
    why: 'Harder efforts deliberately placed on tired legs. Race day asks for your best work after hours of riding, and this is the only session that rehearses it.',
  },
  'race-power': {
    label: 'Race-power blocks',
    why: 'Blocks at the effort you intend to hold on race day, inside a ride long enough to make it honest.',
  },
  'brick-preparation': {
    label: 'Brick preparation',
    why: 'Ridden as the setup for the run that follows. How this one finishes decides how the run starts.',
  },
};

/* Rehearsal focuses cycle so each long ride practises one properly rather
   than listing all three and getting none. Three is coprime with neither
   recovery cadence in use, but that does not matter here: this is not a
   progression ladder, nothing resets it, and it is indexed on the week, so
   every focus comes round. */
export const LONG_FOCUSES = {
  fuelling: {
    label: 'Fuelling rehearsal',
    cue: 'Eat and drink to the plan below from the first twenty minutes, not when you start to feel it. This is a dress rehearsal for the stomach.',
  },
  position: {
    label: 'Position practice',
    cue: 'Spend real time in the position you intend to race in, and break it up before it breaks you. Note afterwards how it held.',
  },
  terrain: {
    label: 'Terrain preparation',
    cue: 'Pick roads that look like your race. Flat if it is flat, rolling if it rolls, and stay on the effort over the top of rises rather than easing every time the road tips up.',
  },
};

const FOCUS_ORDER = ['fuelling', 'position', 'terrain'];

/* The objective this particular Long ride serves, read off what was built. */
export function longRideObjective({ workout, seed, brickFollows }) {
  if (!workout || workout.discipline !== 'bike' || workout.type !== 'Long') return null;
  const segs = workout.segments || [];
  const quality = segs.filter(s => s.zone && s.zone !== 'Z1' && s.zone !== 'Z2');
  let primary;
  if (brickFollows) primary = 'brick-preparation';
  // the builder writes this one's intent into the label, and it is the only
  // variant that puts hard efforts deliberately late
  else if (segs.some(s => /tired legs/i.test(s.label || '')) || quality.some(s => s.zone === 'Z4')) primary = 'late-ride-stability';
  else if (!quality.length) primary = 'pure-endurance';
  else {
    // a long sustained block trains durability; shorter surges rehearse race
    // power. The split is the block's own length, not its zone.
    const longest = Math.max(...quality.map(s => s.min || 0));
    primary = longest >= 20 ? 'aerobic-durability' : 'race-power';
  }
  const focus = FOCUS_ORDER[(seed == null ? 0 : seed) % FOCUS_ORDER.length];
  return {
    primary,
    label: LONG_OBJECTIVES[primary].label,
    why: LONG_OBJECTIVES[primary].why,
    focus,
    focusLabel: LONG_FOCUSES[focus].label,
    focusCue: LONG_FOCUSES[focus].cue,
    // §1's real constraint, answered per session rather than asserted once
    harder: primary === 'late-ride-stability' || primary === 'race-power',
  };
}

/* §1: "Not every Long ride should become harder."
 *
 * A property of a SEQUENCE, not of a session, so there is nothing here to
 * compute at read time and nothing for the app to render: the check belongs
 * to the tests, which ask the generated plans directly. The ceiling is
 * recorded here because it is a design constraint worth stating next to the
 * objectives it constrains, and `harder` is on every objective so the check
 * has something to count.
 */
export const MAX_HARD_LONG_SHARE = 0.7;
