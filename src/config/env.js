/* Try — runtime config from Vite env + the deploy base path.
 *
 * Lives outside the layered tree (app/lib/components/features) on purpose: both
 * the app shell AND feature components (e.g. the Settings API card) read it, and
 * the layer rule forbids a feature importing from app/. Config is a leaf anyone
 * may import. */

export const CLERK_PUBLISHABLE_KEY = String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();
export const AUTH_ENABLED = !!CLERK_PUBLISHABLE_KEY && !CLERK_PUBLISHABLE_KEY.startsWith('<');

// The app is served under /try/ on GitHub Pages; Clerk redirects come back to it.
export const APP_BASE_URL = new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString();
export const APP_BASE_PATH = new URL(import.meta.env.BASE_URL || '/', window.location.origin).pathname;
export const SHOULD_REDIRECT_TO_BASE = APP_BASE_PATH !== '/' && !window.location.pathname.startsWith(APP_BASE_PATH);
