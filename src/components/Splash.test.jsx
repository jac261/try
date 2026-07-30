// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Splash, splashShownForMs } from '@/components/Splash.jsx';

/* Reported 2026-07-30: on the startup splash the first rotation of the logo
 * repeats twice.
 *
 * Two gates each mount their own <Splash/> — Clerk session loading in
 * AuthGate, then plan hydration in App — and a CSS animation restarts from
 * zero on every fresh DOM node. The splash was designed to read as ONE screen
 * (its own comment says so), but the animation state did not survive the
 * handoff.
 *
 * The mechanism under test: every mount carries a negative animation-delay
 * equal to the time since the splash FIRST appeared, so a remount continues
 * the tumble mid-flight instead of replaying it.
 *
 * NOTE: firstShownAt is module state, set by the first render in this file
 * and never reset — these tests are written to run in order against that,
 * the same one-way latch the app relies on.
 */

afterEach(() => vi.restoreAllMocks());

describe('Splash keeps one animation across two mounts', () => {
  it('first mount starts at zero; a later mount continues where time has got to', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    const first = renderToString(<Splash />);
    // anchor mount: no time has passed, the tumble starts at its beginning
    expect(first).toContain('animation-delay:0ms');

    // 2.8s later the Clerk gate hands off to App, which mounts a NEW splash
    now.mockReturnValue(3800);
    const second = renderToString(<Splash />);
    expect(second).toContain('animation-delay:-2800ms');
    expect(second).not.toContain('animation-delay:0ms');
  });

  it('the delay rides on both animated children, mark and wordmark', () => {
    // styles.css puts the pulse on .splash > * and the tumble on .splash > svg;
    // a delay on only one of them would desync the two on remount.
    const html = renderToString(<Splash />);
    expect((html.match(/animation-delay:/g) || []).length).toBe(2);
    expect(html).toMatch(/<svg[^>]*animation-delay:/);
    expect(html).toMatch(/<h1[^>]*animation-delay:/);
  });

  it('splashShownForMs reports time since first appearance, for the App hold', () => {
    /* App holds the splash "long enough for the tumble" — that duration must
       be measured from the splash's first appearance, not App's mount, or a
       slow sign-in buys the athlete a second full hold staring at a finished
       mark. firstShownAt was latched at 1000 by the first test. */
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(6000);
    expect(splashShownForMs()).toBe(5000);
  });

  it('App subtracts the shown time from its hold', async () => {
    // Source assertion: the value is a timeout duration inside an effect,
    // which no render can read back.
    const { readFileSync } = await import('node:fs');
    const app = readFileSync('src/app/App.jsx', 'utf8');
    expect(app).toMatch(/Math\.max\(0, 4400 - splashShownForMs\(\)\)/);
    expect(app).toMatch(/import \{ Splash, splashShownForMs \}/);
  });
});
