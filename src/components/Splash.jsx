import { Icon } from '@/components/Icon.jsx';

/* THE startup screen — the mark and the name, centred, softly pulsing. Used by
   both gates (Clerk session loading in AuthGate, plan hydration in App) so the
   whole startup reads as one screen, not several (Jon, 2026-07-14). */
export function Splash() {
  return (
    <div className="splash" role="status" aria-label="Try is loading">
      <Icon name="logo" size={64} />
      <h1>Try</h1>
    </div>
  );
}
