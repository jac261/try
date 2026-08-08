import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon.jsx';

/* THE brand screen — the mark and the name, centred, softly pulsing. Shown at
   startup by both gates (Clerk session loading in AuthGate, plan hydration in
   App) so the whole startup reads as one screen, not several (Jon, 2026-07-14),
   and again whenever the plan is generated, changed or updated (Jon,
   2026-07-30), where it cycles through one-line messages.

   One screen has to mean one ANIMATION (Jon, 2026-07-30: "the first rotation
   of the logo repeats twice"). The two startup gates mount two different DOM
   nodes, and a CSS animation starts from zero on every fresh node — so the
   tumble played its first face during the Clerk gate and again at the
   AuthGate->App handoff. The fix anchors every mount to the moment the splash
   first appeared in the current EPISODE: a negative animation-delay equal to
   the time already shown makes a remounted splash continue mid-tumble instead
   of restarting. The pulse (infinite) continues its phase the same way; the
   tumble ('both', finite) holds its end frame late in a long episode, which
   is what a long startup should look like: a resting mark, not a looping one.

   An EPISODE ends when the splash has been off screen for more than a moment.
   Startup's gate handoff is a same-commit swap (gap ~0), so it continues; a
   plan update minutes later is a new appearance, and the mark tumbles again —
   without this reset the plan-work splash would open on a motionless mark,
   the resting end frame of an animation that finished at startup.

   The delay is fixed once per MOUNT (useState initializer), not recomputed
   per render: changing animation-delay on a running animation shifts its
   phase, so a re-render of a mounted splash would make the mark jump. */
let firstShownAt = null;
let lastSeenAt = null;
const EPISODE_GAP_MS = 800;

/* Quick-resume status copy (design 1b, 2026-08-07): shown by the STARTUP
   splash, rotating in AUTHORED order — "Almost there" is a closer, not an
   opener, so this set is never shuffled. Deliberately three lines: the
   design's whole point is a short read while real work happens beneath. */
export const RESUME_MESSAGES = [
  'Waking up your plan',
  "Checking today's session",
  'Almost there',
];

/* Plan-work theatre (Jon, 2026-07-30). One-liners, cycled while the splash
   covers a plan build or update. Deliberately whimsical and deliberately
   free of anything that describes how the plan is actually made. */
export const PLAN_WORK_MESSAGES = [
  'Tying laces',
  'Pumping tyres',
  'Varying HRV',
  'Filling bottles',
  'Adjusting goggles',
  'Counting lengths',
  'Racking the bike',
  'Checking the forecast',
  'Mixing the fuel',
  'Charging the watch',
  'Folding the wetsuit',
  'Numbering the buoys',
  'Taping the gels',
  'Airing the trainers',
];

/* How long the startup splash has been on screen, across both gates. App's
   splash hold subtracts this, so "long enough for the tumble" is measured
   from the splash's first appearance rather than from App's mount. */
export function splashShownForMs() {
  return firstShownAt == null ? 0 : performance.now() - firstShownAt;
}

/* Design 1b (quick resume), 2026-08-07. Everything MODE-dependent keys on
   the `messages` PROP — plan work passes PLAN_WORK_MESSAGES (App:979),
   startup passes nothing (AuthGate, App's hydrate hold) and gets the
   RESUME trio by default. It must be the prop and not the resolved list:
   both modes now always have lines, so "do I have lines" can no longer
   tell the label, the cadence or the shuffle apart. */
export function Splash({ messages }) {
  const planWork = !!(messages && messages.length);
  const [delay] = useState(() => {
    const now = performance.now();
    if (firstShownAt == null || (lastSeenAt != null && now - lastSeenAt > EPISODE_GAP_MS)) {
      firstShownAt = now;                        // a new episode: tumble again
    }
    return Math.round(firstShownAt - now) + 'ms';
  });
  // Record when this splash left the screen, so the next mount can tell a
  // same-commit gate handoff (continue) from a fresh appearance (restart).
  // Render initializers run before the outgoing splash's cleanup, so during
  // the startup handoff lastSeenAt is still unset and the episode continues.
  useEffect(() => () => { lastSeenAt = performance.now(); }, []);

  /* The message rotation. Plan work shuffles once per mount so repeated
     plan updates do not always open on the same line, and keeps its quick
     700ms theatre cadence (Jon, 2026-07-30). The startup trio keeps its
     authored order at the design's 1.2s cadence. Keyed so each line
     re-runs the entrance animation. */
  const [order] = useState(() =>
    (planWork ? [...messages].sort(() => Math.random() - 0.5) : RESUME_MESSAGES));
  const [msg, setMsg] = useState(0);
  useEffect(() => {
    if (!order || order.length < 2) return undefined;
    const t = setInterval(() => setMsg(m => m + 1), planWork ? 700 : 1200);
    return () => clearInterval(t);
  }, [order, planWork]);

  const sync = { animationDelay: delay };
  return (
    <div className="splash" role="status" aria-label={planWork ? 'Updating your plan' : 'Try is loading'}>
      {/* ambient orbs: the design's two blurred drifting fields */}
      <div className="splash-orb a" style={sync} />
      <div className="splash-orb b" style={sync} />
      {/* the mark stage: glow behind, land-scale on the wrapper, tumble on
          the svg — the design's own structure, because the land pulse
          overlaps the rotation's travel and one transform list cannot
          carry both timings */}
      <div className="splash-stage">
        <div className="splash-glow" style={sync} />
        <div className="splash-mark" style={sync}>
          <Icon name="logo" size={96} style={sync} />
        </div>
      </div>
      <h1>Try</h1>
      {/* aria-hidden: a role=status region re-announcing a rotating line
          every cycle would chatter; the container's label carries the one
          stable fact a screen reader needs */}
      <div key={msg} className="splash-msg" aria-hidden="true">{order[msg % order.length]}</div>
      {/* the build number, dim, for support screenshots (design note).
          __APP_VERSION__ is vite's define off package.json — supplied in
          dev, build and vitest alike, so no runtime guard. */}
      <div className="splash-ver" aria-hidden="true">{'v' + __APP_VERSION__}</div>
    </div>
  );
}
