// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';

// SettingsView's inner cards pull Clerk hooks; there is no ClerkProvider
// here, so give them inert stand-ins (nothing asserts on auth UI — with
// isLoaded undefined the intervals card just shows its checking state).
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: () => {} }),
  useUser: () => ({ user: { imageUrl: null, fullName: 'T' } }),
  SignOutButton: ({ children }) => children || null,
}));
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { SettingsView } from './SettingsView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';

/* Phase 4 (spec stage 6): Settings consolidated into stable sections.
   These tests pin the section contract: every plan-lifecycle action in the
   "Your plan" card, exact wording preserved on the buttons other tests and
   muscle memory rely on, and mode gates via the nullable-callback idiom. */

const profile = {
  name: 'P', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-08-30',
};
const noop = () => {};
const baseProps = {
  tracker: false, onEnterTracker: noop, onRegenerate: noop, onReset: noop,
  onExport: noop, onEditFitness: noop, onEditTechnique: noop, onEditPlan: noop,
  onStartMaintenance: noop, onReleaseWurm: noop, onWellnessSynced: noop,
  onExportCalibration: noop, calibrationCount: 0, watchSync: false,
  onWatchSync: noop, watchPush: null, onSupportHub: noop,
};

const mount = async props => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<SettingsView {...baseProps} {...props} />); });
  const html = el.innerHTML;
  root.unmount(); el.remove();
  return html;
};

describe('the Your plan card (phase 4)', () => {
  it('plan mode: every lifecycle action in one card, exact wordings intact', async () => {
    const html = await mount({ plan: generatePlan(profile) });
    expect(html).toContain('id="settings-plan"');
    expect(html).toContain('Edit race &amp; schedule');
    expect(html).toContain('Export plan to calendar (.ics)');
    expect(html).toContain('Switch to a 12-week maintenance block');
    // pinned wording: Phase2Profile.test.jsx walks avatar → this button
    expect(html).toContain('End plan and just track');
    expect(html).toContain('Start over / new plan');
    // the old standalone sync card is gone; its button lives in Your plan now
    expect(html).not.toContain('Sync &amp; export');
  });

  it('tracker mode: Start a plan and Start over only; plan-scoped rows hide', async () => {
    const t = buildTrackerPlan(generatePlan(profile), '2026-07-13T10:00:00.000Z');
    const html = await mount({ plan: t, tracker: true, onStartMaintenance: null });
    expect(html).toContain('Start a plan');
    expect(html).toContain('Start over / new plan');
    expect(html).not.toContain('Export plan to calendar');
    expect(html).not.toContain('maintenance block');
    expect(html).not.toContain('End plan and just track');
  });

  it('a null onStartMaintenance hides the row entirely (maintenance and solo plans)', async () => {
    const html = await mount({ plan: generatePlan(profile), onStartMaintenance: null });
    expect(html).not.toContain('maintenance block');
    // the rest of the card is unaffected
    expect(html).toContain('End plan and just track');
  });

  it('the danger card keeps only Clear all progress', async () => {
    const html = await mount({ plan: generatePlan(profile) });
    // Start over appears exactly once (in Your plan), not also at the bottom
    expect((html.match(/Start over \/ new plan/g) || []).length).toBe(1);
    expect(html).toContain('Clear all progress');
  });
});

describe('section anchors', () => {
  it('the deep-link ids exist in both modes', async () => {
    const planHtml = await mount({ plan: generatePlan(profile) });
    const t = buildTrackerPlan(generatePlan(profile), '2026-07-13T10:00:00.000Z');
    const trackerHtml = await mount({ plan: t, tracker: true, onStartMaintenance: null });
    for (const h of [planHtml, trackerHtml]) {
      expect(h).toContain('id="settings-profile"');
      expect(h).toContain('id="settings-plan"');
      expect(h).toContain('id="settings-connections"');
    }
  });
});
