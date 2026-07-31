// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CssProposalSheet } from '@/components/CssProposalSheet.jsx';
import { FtpProposalSheet } from '@/components/FtpProposalSheet.jsx';
import { RunProposalSheet } from '@/components/RunProposalSheet.jsx';
import { generatePlan } from '@/lib/plan.js';

/* Phase 2 stage 2: the sheets became thin wrappers over one shared
 * ProposalSheet. PIN-FIRST: the TEXT pins below were captured from main's
 * rendered output BEFORE the refactor, and the refactor landed against
 * them — tags are stripped, because markup may change but the athlete's
 * words may not. The one deliberate change is named: the confidence suffix
 * became a badge whose TEXT is identical ("high confidence"), so even that
 * survives the text pin. */

const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};
const plan = generatePlan(profile);
const text = html => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
const words = html => text(html).replace(/\|/g, '');

const cssProposal = {
  kind: 'csstest', sport: 'swim', headline: 'Your swum test says faster', why: 'The 400/200 test came in quicker than your setting.',
  retarget: { css100Sec: 105, cssMeta: { source: 'try-test', measuredAt: '2026-06-09', confidence: 'high' } },
};
const ftpProposal = {
  kind: 'eftp', sport: 'bike', headline: 'Your rides argue for more', why: 'The rolling estimate has sat above your setting.',
  retarget: { ftp: 262, ftpMeta: { source: 'activity-model', measuredAt: '2026-06-09', confidence: 'medium' } },
};
const runProposal = {
  kind: 'runtest', sport: 'run', headline: 'Your run test says faster', why: 'The 5 km test came in under your current benchmark.',
  retarget: { fivekSec: 1450, fivekMeta: { source: 'try-test', measuredAt: '2026-06-09', confidence: 'high' } },
};

// Captured from main BEFORE the refactor (vite-node, 2026-07-30). The words
// the athlete reads, in order, with markup stripped. One fixture correction:
// the capture ran under the real clock, the test fakes 10 June, so the
// example ride's DATE moved (the details builder picks the next upcoming
// quality ride) — the builder itself is untouched by the refactor.
const CSS_PIN = 'Your swum test says fasterThe 400/200 test came in quicker than your setting.1:50 /100mCurrent CSS1:45 /100mProposed-5 s /100 m4.5% fasterEvidence: your swum 400/200 test, Tue, Jun 9 · high confidence.Retarget my planNot now';
const FTP_PIN = 'Your rides argue for moreThe rolling estimate has sat above your setting.250 WCurrent FTP262 WProposed+12 W4.8% higherEvidence: the rolling estimate from your rides, Tue, Jun 9 · medium confidence.Your next quality ride (Endurance Ride, Thu, Jun 25) would ask for 157 to 197 W instead of 150 to 188 W on its steady.Retarget my planNot now';

describe('the wrappers render main-identical text (pin-first refactor)', () => {
  it('CSS sheet: every athlete-facing word survives the refactor', () => {
    vi.useFakeTimers({ now: new Date('2026-06-10T09:00:00Z'), toFake: ['Date'] });
    const html = renderToStaticMarkup(<CssProposalSheet proposal={cssProposal} plan={plan} onAccept={() => {}} onClose={() => {}} />);
    vi.useRealTimers();
    expect(words(html)).toBe(CSS_PIN);
  });

  it('FTP sheet: every athlete-facing word survives the refactor', () => {
    vi.useFakeTimers({ now: new Date('2026-06-10T09:00:00Z'), toFake: ['Date'] });
    const html = renderToStaticMarkup(<FtpProposalSheet proposal={ftpProposal} plan={plan} onAccept={() => {}} onClose={() => {}} />);
    vi.useRealTimers();
    expect(words(html)).toBe(FTP_PIN);
  });

  it('the confidence badge is the named markup change: same words, now a chip', () => {
    const html = renderToStaticMarkup(<FtpProposalSheet proposal={ftpProposal} plan={plan} onAccept={() => {}} onClose={() => {}} />);
    expect(html).toContain('conf-badge medium');
    expect(html).toContain('medium confidence');
  });
});

describe('the run sheet (the discipline that had none)', () => {
  it('shows current and proposed 5 km, the evidence, and the threshold-pace effect', () => {
    vi.useFakeTimers({ now: new Date('2026-06-10T09:00:00Z'), toFake: ['Date'] });
    const html = renderToStaticMarkup(<RunProposalSheet proposal={runProposal} plan={plan} onAccept={() => {}} onClose={() => {}} />);
    vi.useRealTimers();
    const t = words(html);
    expect(t).toContain('Current 5 km');
    expect(t).toContain('25:00');                 // 1500 sec
    expect(t).toContain('24:10');                 // 1450 sec
    expect(t).toContain('Evidence: your run 5 km test');
    expect(t).toContain('Your threshold pace would move from');
    expect(t).toContain('Retarget my plan');
    expect(t).toContain('Not now');
    // no engine parameters: the Riegel exponent and rules never reach copy
    expect(t).not.toMatch(/1\.06|RIEGEL|minDrift/);
  });

  it('renders nothing without a payload: no half-sheet', () => {
    expect(renderToStaticMarkup(<RunProposalSheet proposal={{ kind: 'runtest', sport: 'run' }} plan={plan} onAccept={() => {}} onClose={() => {}} />)).toBe('');
  });
});

describe('one skeleton, one source-prose map', () => {
  it('no sheet carries a private SOURCE_WORDS map any more', async () => {
    const { readFileSync } = await import('node:fs');
    ['src/components/CssProposalSheet.jsx', 'src/components/FtpProposalSheet.jsx', 'src/components/RunProposalSheet.jsx'].forEach(p =>
      expect(readFileSync(p, 'utf8'), p).not.toContain('SOURCE_WORDS'));
    const shared = readFileSync('src/components/coaching/ProposalSheet.jsx', 'utf8');
    expect(shared).toContain('T.proposalSourceWord(source, discipline)');
  });

  it('App routes all three sports to sheets: the one-tap retarget is gone', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync('src/app/App.jsx', 'utf8');
    expect(app).toMatch(/eftp\.sport === 'run'\) setRunSheet\(eftp\)/);
    expect(app).not.toContain('applyEftp');
  });
});
