// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { Splash, splashShownForMs, PLAN_WORK_MESSAGES, RESUME_MESSAGES } from '@/components/Splash.jsx';

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

  it('the delay rides on every animated element, and the wordmark carries none', () => {
    /* Design 1b: five animated elements — two orbs, the glow, the land
       wrapper, the tumbling svg. A delay missing from any one desyncs it
       on remount (the glow would flash off-beat from the landing it
       exists to light). The wordmark is static by design, so a delay
       there would be a sixth animation waiting to happen. */
    const html = renderToString(<Splash />);
    expect((html.match(/animation-delay:/g) || []).length).toBe(5);
    expect(html).toMatch(/<svg[^>]*animation-delay:/);
    expect(html).toMatch(/splash-glow[^>]*animation-delay:/);
    expect(html).toMatch(/splash-mark[^>]*animation-delay:/);
    expect(html).not.toMatch(/<h1[^>]*animation-delay:/);
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
    expect(app).toMatch(/import \{ Splash, splashShownForMs, PLAN_WORK_MESSAGES \}/);
  });
});

describe('plan-work messages (Jon, 2026-07-30) and the resume trio (design 1b)', () => {
  it('cycles one-liners when given messages, and the resume trio at startup', () => {
    const withMsgs = renderToString(<Splash messages={PLAN_WORK_MESSAGES} />);
    expect(withMsgs).toContain('splash-msg');
    expect(withMsgs).toContain('aria-label="Updating your plan"');
    expect(PLAN_WORK_MESSAGES.some(m => withMsgs.includes(m))).toBe(true);
    // startup now speaks too — the 1b status copy, opening on line one
    const startup = renderToString(<Splash />);
    expect(startup).toContain('splash-msg');
    expect(startup).toContain(RESUME_MESSAGES[0]);
    expect(startup).toContain('aria-label="Try is loading"');
  });

  it('the trio keeps its authored order at the design cadence; plan work keeps its quick shuffle', async () => {
    /* "Almost there" is a closer, not an opener: the startup set is NEVER
       shuffled, and it rotates at the design's 1.2s, not plan work's
       700ms — at 700ms the trio would be through twice before the hold
       ends, which reads as stuck. */
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    /* A 3-item shuffle lands on the identity order one run in six, so a
       shuffle bug would slip this test that often. Pinning Math.random
       LOW makes the comparator constantly negative, which V8's sort turns
       into a deterministic REVERSAL — measured, not assumed: a constant
       positive comparator leaves the array in identity order and hides
       the mutation entirely. */
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<Splash />); });
    const line = () => el.querySelector('.splash-msg').textContent;
    expect(line()).toBe(RESUME_MESSAGES[0]);
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(line()).toBe(RESUME_MESSAGES[0]);            // 700ms is not this clock
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(line()).toBe(RESUME_MESSAGES[1]);            // 1.2s is
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(line()).toBe(RESUME_MESSAGES[2]);            // in order, no shuffle
    await act(async () => { root.unmount(); });
    el.remove();
    vi.useRealTimers();
  });

  it('reduced motion silences every splash animation (source pin)', async () => {
    /* The browser harness cannot emulate prefers-reduced-motion, so the
       pin is on the stylesheet: the reset must name every animated class
       this redesign added, or an orb keeps drifting for the athlete who
       asked for stillness. */
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles.css', 'utf8');
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.splash[^}]*\}/);
    expect(block).toBeTruthy();
    for (const cls of ['.splash-orb', '.splash-glow', '.splash-mark', '.splash-msg']) {
      expect(block[0]).toContain(cls);
    }
  });

  it('the version tag renders the build version', () => {
    // vite's define supplies __APP_VERSION__ in every environment this
    // component can run in (dev server, build, vitest all load the
    // config) — a typeof guard was written, proven unkillable by
    // mutation, and removed: unkillable is the tell it protects nothing.
    const html = renderToString(<Splash />);
    expect(html).toMatch(/splash-ver[^>]*>v\d+\.\d+\.\d+/);
  });

  it('advances to a different line on the rotation tick', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<Splash messages={PLAN_WORK_MESSAGES} />); });
    const line = () => el.querySelector('.splash-msg').textContent;
    const first = line();
    expect(PLAN_WORK_MESSAGES).toContain(first);
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(line()).not.toBe(first);
    expect(PLAN_WORK_MESSAGES).toContain(line());
    await act(async () => { root.unmount(); });
    el.remove();
    vi.useRealTimers();
  });

  it('includes the lines Jon asked for, and enough to not feel canned', () => {
    ['Varying HRV', 'Tying laces', 'Pumping tyres'].forEach(m =>
      expect(PLAN_WORK_MESSAGES).toContain(m));
    expect(PLAN_WORK_MESSAGES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(PLAN_WORK_MESSAGES).size).toBe(PLAN_WORK_MESSAGES.length);
  });
});

describe('episodes: continue across a handoff, tumble again on a fresh appearance', () => {
  /* The startup fix anchors the tumble to the splash's first appearance. A
     plan update minutes later must NOT inherit that anchor, or its splash
     opens on a motionless mark: the resting end frame of an animation that
     finished at startup. An episode ends when the splash has been off screen
     for more than a moment; only unmounting records that (SSR renders above
     never ran effects, which is why they share one long episode). */
  it('a mount long after the last unmount starts a fresh tumble', async () => {
    const now = vi.spyOn(performance, 'now');
    const el = document.createElement('div');
    document.body.appendChild(el);

    now.mockReturnValue(50000);
    let root = createRoot(el);
    await act(async () => { root.render(<Splash />); });
    await act(async () => { root.unmount(); });          // lastSeenAt = 50000

    now.mockReturnValue(90000);                          // 40s later: new episode
    root = createRoot(el);
    await act(async () => { root.render(<Splash messages={PLAN_WORK_MESSAGES} />); });
    expect(el.querySelector('svg').style.animationDelay).toBe('0ms');
    await act(async () => { root.unmount(); });          // lastSeenAt = 90000

    now.mockReturnValue(90300);                          // 300ms later: same episode
    root = createRoot(el);
    await act(async () => { root.render(<Splash />); });
    expect(el.querySelector('svg').style.animationDelay).toBe('-300ms');
    await act(async () => { root.unmount(); });
    el.remove();
  });
});

describe('App wires the plan-work splash', () => {
  const app = () => import('node:fs').then(fs => fs.readFileSync('src/app/App.jsx', 'utf8'));

  it('takes over with cycling messages while plan work is held', async () => {
    const src = await app();
    expect(src).toMatch(/if \(planWork\) return <Splash messages=\{PLAN_WORK_MESSAGES\} \/>;/);
    expect(src).not.toContain('BuildingPlan');
  });

  it('every athlete-initiated plan mutation shows it', async () => {
    const src = await app();
    const between = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)) + 1 || undefined);
    // create, plus the nine change/update handlers
    expect(between("onCreate={p =>", "/>")).toContain('setPlanWork(');
    ['const retarget = fields =>', 'const saveTechnique = fields =>', 'const reshapePlan = fields =>',
     'const addCssTestToWeek = () =>', 'const endPlanToTracker = () =>', 'const addWorkout = spec =>',
     'const removeWorkout = id =>', 'const setBlockFocus = focus =>',
    ].forEach(h => expect(src.slice(src.indexOf(h), src.indexOf(h) + 400), h).toContain('setPlanWork('));
    // the tracker branch of updateFitness is not covered by retarget
    expect(between('const updateFitness = fields =>', '} else retarget')).toContain('setPlanWork(');
  });

  it('never fires on the automatic plan-end sweep at app open', async () => {
    /* planEnded() calls enterTracker on load when a race date has passed.
       That is housekeeping, not an athlete action: waking the app must not
       open on "Pumping tyres". The splash rides the CONFIRMED end-plan
       action instead. */
    const src = await app();
    const enterTracker = src.slice(src.indexOf('const enterTracker = () =>'), src.indexOf('T.planEnded'));
    expect(enterTracker).not.toContain('setPlanWork(');
  });
});
