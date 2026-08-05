// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: () => {} }),
  useUser: () => ({ user: { imageUrl: null, fullName: 'T' } }),
  SignOutButton: ({ children }) => children || null,
}));
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { TodayView } from './TodayView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';
import { storageForUser } from '@/app/storage.js';
import { iso, addDays } from '@/lib/date.js';

/* TodayView's behaviour, which had no test of any kind before the audit
   (2026-08-05). PR 2 pinned the coach card's STRUCTURE; this pins what the
   screen actually decides: which of eleven possible nudges speaks first,
   whether a dismissal sticks, and how the tracker branch reorders the page.
 *
 * Every assertion is on RENDERED OUTPUT, never on internals, because the
 * point of this file is to be the safety net under the memoisation pass that
 * follows: computation may move anywhere as long as the screen still says
 * the same things.
 *
 * The two audit findings this file once declined to test are closed: a
 * dismissal is stamped with the plan it was about, and there is no
 * legacy-global read fallback left to leak one athlete's rejection to the
 * next. Both are covered below and in coaching/strays.test.js. */

const today = new Date();
const todayISO = iso(today);
const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 5, daysPerWeek: 7,
  startDate: iso(addDays(today, -35)), raceDate: iso(addDays(today, 77)),
};

// every prop-driven card, so the queue can be built to any depth
const CARDS = {
  planEdge: { key: 'post-race', icon: 'trophy', title: 'Race day is behind you', sub: 'Recover well.', act: () => {} },
  offerTracker: true,
  weekly: { kind: 'trim-week', week: 3, targets: ['bike'], headline: 'Trim this week', why: 'Fatigue is high.' },
  spotted: [{ workout: { title: 'Easy run' } }],
  eftp: { sig: 'eftp:bike:255', up: true, headline: 'Your FTP looks higher', why: 'Three rides say so.' },
  cssFail: { sig: 'cssfail:1', issue: 'The laps were uneven.' },
  runFail: { sig: 'runfail:1', issue: 'No 5 km split.' },
  startShortfall: { sig: 'shortfall:bike20', text: 'Your bike starts under.' },
  ftpRetest: { sig: 'ftpretest:1', headline: 'Time to reassess your FTP', why: 'It is eight weeks old.' },
  retest: { sig: 'retest:swim:1', headline: 'Time to retest your CSS', why: 'It is six weeks old.' },
};

/* Plan and log stay in memory (this file asserts on rendered output, not on
   persistence), but the DISMISSAL methods are the real ones: composed off
   storageForUser so "stays dismissed on the next visit" keeps exercising the
   store's own stamp logic rather than a double's memory. beforeEach clears
   localStorage, which is what isolates them. They are arrow closures over
   the namespace, which is why they can be borrowed like this. */
const memStore = (ns = 'try.user.tv.') => {
  const real = storageForUser('tv');
  return { ns, load: (k, d) => d, save: () => {},
    loadDismiss: real.loadDismiss, saveDismiss: real.saveDismiss, clearDismiss: real.clearDismiss };
};

/* ONE plan identity across the mounts of a test. render() used to call
   generatePlan per mount, and now that dismissals are plan-stamped that
   would hand the second mount a different plan and let a remount test pass
   for the wrong reason. Tests that WANT a second plan build one explicitly. */
const PLAN = generatePlan(profile);

const render = (over = {}, mountInto) => {
  const el = mountInto || document.createElement('div');
  if (!mountInto) document.body.appendChild(el);
  const root = createRoot(el);
  const noop = () => {};
  act(() => {
    root.render(<TodayView plan={PLAN} log={{}} moves={{}} missedReasons={{}}
      open={noop} onTune={noop} wellness={[]} onFeel={noop} onEditWellness={noop}
      easedOf={w => w} onEaseToday={noop} onRestoreToday={noop}
      weekly={null} onWeekly={noop} spotted={null} onLogSpotted={noop} onAddWorkout={noop}
      eftp={null} onEftp={noop} onToggleWorkout={noop} planEdge={null} onSupport={noop}
      activities={[]} displayActivities={[]} onOpenRecording={noop} onEditPlan={noop}
      onEnterTracker={noop} offerTracker={false} adjust={{}} adjustLog={[]} coachLog={{}}
      blockReviewed={null} onBlockReviewed={noop} onFocus={noop} storage={memStore()}
      retest={null} onRetest={noop} cssFail={null} onFixCss={noop} runFail={null} onFixRun={noop}
      ftpRetest={null} onFtpRetest={noop} startShortfall={null} onDecision={noop} fuelLog={{}}
      {...over} />);
  });
  // ReadinessCard renders a .banner of its own, so the coach card is the one
  // carrying an action wrapper or the inert marker
  const coach = () => [...el.querySelectorAll('.banner')].find(b => b.querySelector('.b-act'));
  return { el, root, coach, cleanup: () => { act(() => root.unmount()); el.remove(); } };
};

const title = c => (c.coach() ? c.coach().querySelector('.bt').textContent : null);
const chipOf = c => [...c.coach().querySelectorAll('.bmore')].find(n => /▸/.test(n.textContent));
const press = node => act(() => { node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
// walk the whole queue by tapping the cycle chip, collecting each headline
const queueOf = c => {
  const chip = chipOf(c);
  // the chip reads "1/10 ▸", so the count needs extracting, not splitting
  const n = chip ? Number((chip.textContent.match(/\/\s*(\d+)/) || [])[1]) : 1;
  const out = [title(c)];
  for (let i = 1; i < n; i++) { press(chipOf(c)); out.push(title(c)); }
  return out;
};

beforeEach(() => { localStorage.clear(); });

describe('the coach queue speaks in priority order', () => {
  it('orders every nudge most important first', () => {
    /* The file's own contract: "one coach voice at a time, most important
       first". Nothing checked it, so a push moved into the wrong place would
       have shipped silently. */
    const c = render(CARDS);
    expect(queueOf(c)).toEqual([
      'Race day is behind you',                                    // the plan's own edge
      'Or just track for now',                                     // ...and its alternative
      'Trim this week',                                            // this week's proposal
      'Session spotted on your watch',
      'Your FTP looks higher',
      'We could not read a CSS from your test swim',
      'We could not read a 5 km time from your test run',
      'Your race build starts below where this race usually peaks',
      'Time to reassess your FTP',
      'Time to retest your CSS',
    ]);
    c.cleanup();
  });

  it('tracker mode outranks the lot: the next-plan prompt is the only voice', () => {
    // every other push is !tracker gated, so a tracker screen must not
    // inherit a proposal about a plan that no longer exists
    const c = render({ ...CARDS, plan: buildTrackerPlan(generatePlan(profile), new Date().toISOString()) });
    expect(queueOf(c)).toEqual(['Ready for your next plan?']);
    c.cleanup();
  });

  it('the counter reports the queue, and vanishes when there is one card', () => {
    const many = render(CARDS);
    expect(chipOf(many).textContent).toContain('/10');
    many.cleanup();
    const one = render({ weekly: CARDS.weekly });
    expect(chipOf(one)).toBe(undefined);
    one.cleanup();
  });

  it('cycling wraps back to the first card', () => {
    const c = render({ weekly: CARDS.weekly, retest: CARDS.retest });
    const first = title(c);
    press(chipOf(c)); press(chipOf(c));
    expect(title(c)).toBe(first);
    c.cleanup();
  });
});

describe('dismissal is per card and it sticks', () => {
  const dismiss = c => press(c.coach().querySelector('.bmore.bx'));

  it('takes the card out of the queue and shortens the count', () => {
    const c = render({ weekly: CARDS.weekly, retest: CARDS.retest, eftp: CARDS.eftp });
    expect(chipOf(c).textContent).toContain('/3');
    dismiss(c);
    expect(queueOf(c)).toEqual(['Your FTP looks higher', 'Time to retest your CSS']);
    c.cleanup();
  });

  it('silences only the card dismissed, never its siblings', () => {
    const c = render({ weekly: CARDS.weekly, retest: CARDS.retest });
    dismiss(c);
    expect(title(c)).toBe('Time to retest your CSS');
    expect(c.coach().querySelector('.bmore.bx')).not.toBe(null); // still dismissible
    c.cleanup();
  });

  it('stays dismissed on the next visit, and speaks again when its signature moves', () => {
    /* The whole point of signature dismissal, and it had never been
       exercised: the state is seeded from localStorage by a lazy
       initialiser, so only a remount can prove it. */
    const store = memStore();
    const first = render({ weekly: CARDS.weekly, storage: store });
    dismiss(first);
    expect(title(first)).toBe(null);
    first.cleanup();

    const again = render({ weekly: CARDS.weekly, storage: store });
    expect(title(again)).toBe(null);          // same proposal, still quiet
    again.cleanup();

    const moved = render({ weekly: { ...CARDS.weekly, targets: ['run'] }, storage: store });
    expect(title(moved)).toBe('Trim this week'); // a different proposal speaks
    moved.cleanup();
  });

  it('does not carry into the next plan: the same nudge speaks again', () => {
    /* The audit finding. weeklySig is kind + week INDEX + positional workout
       ids, all of which a regenerated plan reproduces byte-identical, so a
       rejection about one plan's week used to silence a materially different
       week of the next. */
    const store = memStore();
    const planB = { ...PLAN, createdAt: '2026-08-05T10:00:00.000Z' };
    const first = render({ weekly: CARDS.weekly, storage: store });
    dismiss(first);
    expect(title(first)).toBe(null);
    first.cleanup();

    const onB = render({ weekly: CARDS.weekly, plan: planB, storage: store });
    expect(title(onB)).toBe('Trim this week');
    onB.cleanup();
  });

  it('a retest nudge, which is about the athlete not the plan, does carry', () => {
    /* The other half, and the one that makes the scope table earn its keep:
       a CSS retest is due because of when the athlete last tested. Re-asking
       on every new plan would be a regression dressed as caution. */
    const store = memStore();
    const planB = { ...PLAN, createdAt: '2026-08-05T10:00:00.000Z' };
    const first = render({ retest: CARDS.retest, storage: store });
    dismiss(first);
    first.cleanup();

    const onB = render({ retest: CARDS.retest, plan: planB, storage: store });
    expect(title(onB)).toBe(null);
    onB.cleanup();
  });

  it('journals the rejection, because a refused proposal is still history', () => {
    const seen = [];
    const c = render({ weekly: CARDS.weekly, onDecision: (p, verdict) => seen.push(verdict) });
    dismiss(c);
    expect(seen).toEqual(['rejected']);
    c.cleanup();
  });

  it('an informational card can be dismissed even though it has no action', () => {
    const c = render({ startShortfall: CARDS.startShortfall });
    expect(title(c)).toContain('Your race build starts below');
    dismiss(c);
    expect(title(c)).toBe(null);
    c.cleanup();
  });
});

/* ---- the modes, and the states that close the day ---- */

// land exactly the chosen sessions on today, clearing the rest out of the way
const onlyToday = (plan, keepIds) => {
  const moves = {};
  plan.weeks.flatMap(w => w.workouts)
    .filter(w => w.date === todayISO && w.discipline !== 'rest' && !keepIds.includes(w.id))
    .forEach(w => { moves[w.id] = iso(addDays(today, 3)); });
  keepIds.forEach(id => { moves[id] = todayISO; });
  return moves;
};
const firstSession = plan => plan.weeks.flatMap(w => w.workouts)
  .find(w => w.discipline !== 'rest' && !w.race && w.date > todayISO);

describe('tracker mode reorders the screen', () => {
  const trackerPlan = () => buildTrackerPlan(generatePlan(profile), new Date().toISOString());

  it('leads with the coach card and drops the week card entirely', () => {
    const c = render({ plan: trackerPlan() });
    const cards = [...c.el.querySelectorAll('.banner, .card')];
    const coachAt = cards.findIndex(n => n.querySelector('.b-act'));
    const readyAt = cards.findIndex(n => n.className.includes('rd'));
    expect(coachAt).toBeGreaterThanOrEqual(0);
    expect(coachAt).toBeLessThan(readyAt);       // with no plan the call to action leads
    expect(c.el.querySelector('.yw')).toBe(null); // no plan week to strip
    c.cleanup();
  });

  it('speaks tracker language: log a session, and no plan is active', () => {
    const c = render({ plan: trackerPlan() });
    expect(c.el.textContent).toContain('Log a session');
    expect(c.el.textContent).toContain('No plan active');
    expect(c.el.textContent).not.toContain('Add a session');
    c.cleanup();
  });

  it('in plan mode readiness leads and the week card is there', () => {
    const c = render({});
    const cards = [...c.el.querySelectorAll('.banner, .card')];
    const readyAt = cards.findIndex(n => n.className.includes('rd'));
    const coachAt = cards.findIndex(n => n.querySelector('.b-act'));
    expect(readyAt).toBeGreaterThanOrEqual(0);
    if (coachAt >= 0) expect(readyAt).toBeLessThan(coachAt);
    expect(c.el.querySelector('.yw')).not.toBe(null);
    expect(c.el.textContent).toContain('Add a session');
    c.cleanup();
  });
});

describe('the day closes honestly', () => {
  it('swaps the rows for a done card once every session is logged, and Review brings them back', () => {
    const plan = generatePlan(profile);
    const mine = plan.weeks.flatMap(w => w.workouts).find(w => w.discipline !== 'rest' && !w.race);
    const moves = onlyToday(plan, [mine.id]);
    const c = render({ plan, moves, log: { [mine.id]: { done: true, at: todayISO } } });
    expect(c.el.textContent).toContain('Done for today');
    expect(c.el.querySelector('.today-done')).not.toBe(null);
    press(c.el.querySelector('.today-done .reset'));
    expect(c.el.querySelector('.today-done')).toBe(null);   // the rows are back
    expect(c.el.querySelector('.wk')).not.toBe(null);
    c.cleanup();
  });

  it('names what is next once the day is spent', () => {
    const plan = generatePlan(profile);
    const mine = plan.weeks.flatMap(w => w.workouts).find(w => w.discipline !== 'rest' && !w.race);
    const c = render({ plan, moves: onlyToday(plan, [mine.id]), log: { [mine.id]: { done: true, at: todayISO } } });
    const row = c.el.querySelector('.tmrw');
    expect(row).not.toBe(null);
    expect(row.getAttribute('aria-label')).toContain('Next up');
    c.cleanup();
  });

  it('skips a session already logged when choosing what is next', () => {
    /* Pins #62's fix at this surface: the row used to ignore the log, so it
       could name a session the athlete had already ticked while the week
       card beside it named a different one. */
    const plan = generatePlan(profile);
    const mine = plan.weeks.flatMap(w => w.workouts).find(w => w.discipline !== 'rest' && !w.race);
    const moves = onlyToday(plan, [mine.id]);
    const nextOne = firstSession(plan);
    const withNextOpen = render({ plan, moves, log: { [mine.id]: { done: true, at: todayISO } } });
    const named = withNextOpen.el.querySelector('.tmrw').getAttribute('aria-label');
    withNextOpen.cleanup();

    const withNextDone = render({ plan, moves, log: { [mine.id]: { done: true, at: todayISO }, [nextOne.id]: { done: true, at: nextOne.date } } });
    const namedNow = withNextDone.el.querySelector('.tmrw').getAttribute('aria-label');
    expect(named).toContain(nextOne.title);
    expect(namedNow).not.toContain(nextOne.title);   // ticked, so no longer next
    withNextDone.cleanup();
  });

  it('a rest day says so and still points at what is coming', () => {
    const plan = generatePlan(profile);
    const c = render({ plan, moves: onlyToday(plan, []) });
    expect(c.el.textContent).toContain('No session scheduled today');
    expect(c.el.querySelector('.tmrw')).not.toBe(null);
    c.cleanup();
  });
});

describe('one voice for the day\'s priority', () => {
  it('the briefing line speaks only when no readiness record does', () => {
    /* #62: the verdict names today's session too, so with a reading in hand
       this line was the same sentence twice above the fold. */
    const bare = render({ wellness: [] });
    expect(bare.el.querySelector('.tb-priority')).not.toBe(null);
    bare.cleanup();

    const withReading = render({ wellness: [{ date: todayISO, hrv: 70, rhr: 47, sleepSec: 8 * 3600 }] });
    expect(withReading.el.querySelector('.tb-priority')).toBe(null);
    expect(withReading.el.querySelector('.tb-ctx-line')).not.toBe(null); // the context line stays
    withReading.cleanup();
  });
});
