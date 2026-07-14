import { useMemo } from 'react';
import { useAuth, useUser, SignInButton } from '@clerk/react';
import { storageForUser } from '@/app/storage.js';
import { Icon } from '@/components/Icon.jsx';
import { Splash } from '@/components/Splash.jsx';
import { APP_BASE_URL } from '@/config/env.js';
import { App } from './App.jsx';

// Centred card used for every signed-out / loading / misconfigured state.
export function GateShell({ title, message, children }) {
  return (
    <div className="authgate">
      <div className="authgate-inner">
        <Icon name="logo" size={34} />
        <h1>{title}</h1>
        <p>{message}</p>
        {children && <div className="authgate-actions">{children}</div>}
      </div>
    </div>
  );
}

// Gates the app behind a Clerk session and hands App a per-user storage instance.
export function AuthGate() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const storage = useMemo(() => (user ? storageForUser(user.id) : null), [user?.id]);

  // Session loading shows THE startup splash — the same screen App shows while
  // hydrating, so startup reads as one continuous screen, not a gate sequence.
  if (!isLoaded) {
    return <Splash />;
  }
  if (!isSignedIn || !user || !storage) {
    return (
      <GateShell title="Sign in to Try" message="Your training plan is stored in your signed-in workspace on this browser.">
        <SignInButton
          mode="modal"
          forceRedirectUrl={APP_BASE_URL}
          fallbackRedirectUrl={APP_BASE_URL}
          signUpForceRedirectUrl={APP_BASE_URL}
          signUpFallbackRedirectUrl={APP_BASE_URL}>
          <button className="btn primary" type="button">Sign in</button>
        </SignInButton>
      </GateShell>
    );
  }
  // key={user.id} → App remounts (fresh per-user state) when the account changes.
  return <App key={user.id} storage={storage} getToken={getToken} user={user} />;
}
