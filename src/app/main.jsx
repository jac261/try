/* Try — app entry point (Vite). Wires Clerk auth around the React shell:
   redirect to the /try/ base if needed, then mount <AuthGate/> inside a
   <ClerkProvider/> (falling back to a config notice when no key is set), all
   under the top-level <ErrorBoundary/>. */
import '@/styles.css';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { AuthGate, GateShell } from './AuthGate.jsx';
import { CLERK_PUBLISHABLE_KEY, AUTH_ENABLED, APP_BASE_URL, SHOULD_REDIRECT_TO_BASE } from '@/config/env.js';

// GitHub Pages can land the user on a deep path; bounce to the app base so Clerk
// redirects resolve consistently.
if (SHOULD_REDIRECT_TO_BASE) {
  window.location.replace(APP_BASE_URL + window.location.search + window.location.hash);
} else {
  // Reuse one root across hot-reloads (avoids the "createRoot() on a container that
  // has already been passed to createRoot()" warning and double-mount churn in dev).
  const _container = document.getElementById('root');
  const _root = _container.__try_root || (_container.__try_root = createRoot(_container));
  _root.render(
    <ErrorBoundary>
      {AUTH_ENABLED ? (
        <ClerkProvider
          publishableKey={CLERK_PUBLISHABLE_KEY}
          signInForceRedirectUrl={APP_BASE_URL}
          signInFallbackRedirectUrl={APP_BASE_URL}
          signUpForceRedirectUrl={APP_BASE_URL}
          signUpFallbackRedirectUrl={APP_BASE_URL}
          afterSignOutUrl={APP_BASE_URL}>
          <AuthGate />
        </ClerkProvider>
      ) : (
        <GateShell title="Clerk is not configured" message="Set VITE_CLERK_PUBLISHABLE_KEY in the frontend environment and restart Vite." />
      )}
    </ErrorBoundary>,
  );
}
