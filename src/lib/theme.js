/* Try — the two materials, and which one this device shows.
 *
 * The preference is DEVICE-LOCAL and un-namespaced on purpose: the theme must
 * apply before Clerk knows who is signed in (index.html reads it inline,
 * pre-paint, so the app never flashes the wrong material), and a per-user key
 * would leave the sign-in screen unthemed. Cross-device sync is deliberately
 * not attempted — the profile wire is typed, and this is not worth a backend
 * ask.
 *
 * index.html carries a copy of the read-and-apply logic as an inline script
 * (it cannot import modules before the bundle loads). The two must agree;
 * theme.test.js pins the contract they share.
 */
export const THEME_KEY = 'try:theme';
export const THEME_DEFAULT = 'smoked';
export const THEMES = [
  { key: 'moulded', name: 'Moulded glass', blurb: 'Lit from above — frosted panes on a bright field' },
  { key: 'smoked', name: 'Smoked glass', blurb: 'The night build — edge light, black wells, one glow' },
];

// The PWA chrome colour follows the page, or the browser bar sits on the
// wrong black. Values match --bg in each theme's token block.
const META_COLOR = { moulded: '#0e1217', smoked: '#05070a' };

export function readTheme(store) {
  const s = store || (typeof localStorage !== 'undefined' ? localStorage : null);
  let v = null;
  try { v = s && s.getItem(THEME_KEY); } catch (e) { /* storage denied: default */ }
  return THEMES.some(t => t.key === v) ? v : THEME_DEFAULT;
}

export function applyTheme(key, doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d) return;
  d.documentElement.dataset.theme = key;
  const meta = d.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLOR[key] || META_COLOR[THEME_DEFAULT]);
}

export function saveTheme(key, store) {
  const s = store || (typeof localStorage !== 'undefined' ? localStorage : null);
  try { s && s.setItem(THEME_KEY, key); } catch (e) { /* storage denied: session-only */ }
}
