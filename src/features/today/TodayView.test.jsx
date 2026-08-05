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
 * Deliberately absent: the two audit findings still open in this file — that
 * dismissal signatures are not plan-stamped, and that dGet's legacy-global
 * fallback is permanent. A test written now would enshrine the bug and make
 * its fix read as a regression. */

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

// a memory storage so dismissals persist across mounts within a test
const memStore = (ns = 'try.user.tv.') => ({ ns, load: (k, d) => d, save: () => {} });

const render = (over = {}, mountInto) => {
  const el = mountInto || document.createElement('div');
  if (!mountInto) document.body.appendChild(el);
  const root = createRoot(el);
  const noop = () => {};
  act(() => {
    root.render(<TodayView plan={generatePlan(profile)} log={{}} moves={{}} missedReasons={{}}
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
