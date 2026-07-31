import * as T from '@/lib';
import { ProposalSheet } from '@/components/coaching/ProposalSheet.jsx';

/* Phase 2 (spec §4/§14): the run's evidence sheet, at last. The run was the
   one discipline still retargeting on a single tap — runProposalDetails was
   built in its own phase and rendered by nothing. Threshold changes remain
   proposals: current 5 km, proposed, the size of the change, the evidence,
   and the effect on the athlete's own threshold pace, then a decision. */
const fmt5k = sec => (sec == null ? '—' : Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0'));
const fmtPaceKm = sec => Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0') + ' /km';

export function RunProposalSheet({ proposal, plan, onAccept, onClose }) {
  const d = T.runProposalDetails({ proposal, plan, todayISO: T.iso(new Date()) });
  if (!d) return null;
  const delta = d.curSec != null ? d.nextSec - d.curSec : null;
  return (
    <ProposalSheet
      ariaLabel="Run 5 km proposal"
      headline={proposal.headline} why={proposal.why}
      stats={[
        { big: fmt5k(d.curSec), label: 'Current 5 km' },
        { big: fmt5k(d.nextSec), label: 'Proposed' },
        { big: delta == null ? '—' : (delta > 0 ? '+' : '−') + fmt5k(Math.abs(delta)), label: d.pct != null ? d.pct + '% ' + (d.faster ? 'faster' : 'slower') : 'new benchmark' },
      ]}
      source={d.source} discipline="run" measuredAt={d.measuredAt} confidence={d.confidence}
      example={<>
        {/* the concrete effect: the pace the plan actually trains to */}
        Your threshold pace would move from {fmtPaceKm(d.thresholdCur)} to {fmtPaceKm(d.thresholdNext)}
        {d.example ? <>, starting with {d.example.title} on {T.fmtDate(d.example.date)}</> : null}.
      </>}
      onAccept={onAccept} onClose={onClose} />
  );
}
