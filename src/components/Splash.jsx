import { useState } from 'react';
import { Icon } from '@/components/Icon.jsx';

/* THE startup screen — the mark and the name, centred, softly pulsing. Used by
   both gates (Clerk session loading in AuthGate, plan hydration in App) so the
   whole startup reads as one screen, not several (Jon, 2026-07-14).

   One screen has to mean one ANIMATION (Jon, 2026-07-30: "the first rotation
   of the logo repeats twice"). The two gates mount two different DOM nodes,
   and a CSS animation starts from zero on every fresh node — so the tumble
   played its first face during the Clerk gate and again at the AuthGate->App
   handoff. The fix anchors every mount to the moment the splash FIRST
   appeared: a negative animation-delay equal to the time already shown makes
   a remounted splash continue mid-tumble instead of restarting. The pulse
   (infinite) continues its phase the same way; the tumble ('both', finite)
   holds its end frame if the remount lands after 4.2s, which is what a long
   startup should look like: a resting mark, not a looping one.

   The delay is fixed once per MOUNT (useState initializer), not recomputed
   per render: changing animation-delay on a running animation shifts its
   phase, so a re-render of a mounted splash would make the mark jump. */
let firstShownAt = null;

/* How long the startup splash has been on screen, across both gates. App's
   splash hold subtracts this, so "long enough for the tumble" is measured
   from the splash's first appearance rather than from App's mount. */
export function splashShownForMs() {
  return firstShownAt == null ? 0 : performance.now() - firstShownAt;
}

export function Splash() {
  const [delay] = useState(() => {
    if (firstShownAt == null) firstShownAt = performance.now();
    return Math.round(firstShownAt - performance.now()) + 'ms';
  });
  const sync = { animationDelay: delay };
  return (
    <div className="splash" role="status" aria-label="Try is loading">
      <Icon name="logo" size={64} style={sync} />
      <h1 style={sync}>Try</h1>
    </div>
  );
}
