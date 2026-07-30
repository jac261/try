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

export function Splash({ messages }) {
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

  // The message rotation. Shuffled once per mount so repeated plan updates
  // do not always open on the same line; keyed so each line re-runs the
  // entrance animation.
  const [order] = useState(() =>
    (messages && messages.length ? [...messages].sort(() => Math.random() - 0.5) : null));
  const [msg, setMsg] = useState(0);
  useEffect(() => {
    if (!order || order.length < 2) return undefined;
    const t = setInterval(() => setMsg(m => m + 1), 700);
    return () => clearInterval(t);
  }, [order]);

  const sync = { animationDelay: delay };
  return (
    <div className="splash" role="status" aria-label={order ? 'Updating your plan' : 'Try is loading'}>
      <Icon name="logo" size={64} style={sync} />
      <h1 style={sync}>Try</h1>
      {order && <div key={msg} className="splash-msg">{order[msg % order.length]}</div>}
    </div>
  );
}
