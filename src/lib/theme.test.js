// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEME_KEY, THEME_DEFAULT, THEMES, readTheme, applyTheme, saveTheme } from './theme.js';

/* The theme is applied twice: by this module once the bundle is up, and by an
   inline script in index.html that runs pre-paint and cannot import anything.
   These tests pin the contract the two share, so an edit to one that forgets
   the other fails here instead of flashing the wrong material in production. */

describe('the theme preference', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });

  it('defaults to smoked, and round-trips a choice', () => {
    expect(readTheme()).toBe('smoked');
    saveTheme('moulded');
    expect(readTheme()).toBe('moulded');
    expect(localStorage.getItem(THEME_KEY)).toBe('moulded');
  });

  it('falls back to the default on junk, never to an unthemed page', () => {
    localStorage.setItem(THEME_KEY, 'chrome');
    expect(readTheme()).toBe(THEME_DEFAULT);
    const denied = { getItem() { throw new Error('denied'); } };
    expect(readTheme(denied)).toBe(THEME_DEFAULT);
  });

  it('applyTheme stamps the attribute and retunes the browser chrome colour', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
    applyTheme('smoked');
    expect(document.documentElement.dataset.theme).toBe('smoked');
    expect(meta.getAttribute('content')).toBe('#05070a');
    applyTheme('moulded');
    expect(meta.getAttribute('content')).toBe('#0e1217');
    meta.remove();
  });
});

describe('index.html mirrors the module', () => {
  // resolved from the repo root (vitest cwd), because import.meta.url is a
  // vite-transformed http URL under happy-dom, not a file: one
  const html = readFileSync(resolve('index.html'), 'utf8');

  it('boots with the same key, the same default and the same accepted values', () => {
    expect(html).toContain(`localStorage.getItem('${THEME_KEY}')`);
    // the guard must name every theme the module accepts, and default to the
    // module's default when the stored value is none of them
    THEMES.forEach(t => expect(html).toContain(`'${t.key}'`));
    expect(html).toContain(`t = '${THEME_DEFAULT}'`);
    // the static attribute and meta match the default, so a no-JS paint and
    // the script agree
    expect(html).toContain(`data-theme="${THEME_DEFAULT}"`);
    expect(html).toContain('content="#05070a"');
  });
});
