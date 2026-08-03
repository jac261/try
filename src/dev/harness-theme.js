/* Dev harnesses run their own HTML entries, which do NOT carry index.html's
 * pre-paint theme script — without this they would silently keep testing
 * whichever material happened to be the CSS default. Every harness calls
 * initHarnessTheme() before mounting: ?theme=moulded|smoked wins, else the
 * device's stored choice, else the app default (smoked), exactly like the
 * real app. A floating chip flips the material in place, because the whole
 * point of a harness is looking at both.
 */
import { THEMES, readTheme, applyTheme } from '@/lib/theme.js';

export function initHarnessTheme() {
  const q = new URLSearchParams(window.location.search).get('theme');
  let theme = THEMES.some(t => t.key === q) ? q : readTheme();
  applyTheme(theme);

  const btn = document.createElement('button');
  btn.type = 'button';
  Object.assign(btn.style, {
    position: 'fixed', top: '10px', right: '10px', zIndex: 999,
    padding: '7px 13px', borderRadius: '999px', border: '1px dashed rgba(255,255,255,.35)',
    background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: '11px', fontWeight: '700',
    fontFamily: 'inherit', cursor: 'pointer',
  });
  const label = () => { btn.textContent = 'theme: ' + theme; };
  label();
  btn.onclick = () => {
    theme = theme === 'smoked' ? 'moulded' : 'smoked';
    applyTheme(theme);   // deliberately NOT saved: a harness flip must not retheme the app
    label();
  };
  document.body.appendChild(btn);
}
