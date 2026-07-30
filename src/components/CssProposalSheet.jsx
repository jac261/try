import * as T from '@/lib';
import { ProposalSheet } from '@/components/coaching/ProposalSheet.jsx';

/* Phase 3b (spec §6): the evidence behind a swim CSS retarget, shown before
   anything changes. Phase 2 made it a thin wrapper over the shared
   ProposalSheet — the skeleton lives once, the swim keeps its own details
   builder and its own concrete-example sentence, and the source prose comes
   from the shared map (the private copies had drifted). Accepting runs the
   exact same retarget the banner always ran; declining changes nothing. */
export function CssProposalSheet({ proposal, plan, onAccept, onClose }) {
  const d = T.cssProposalDetails({ proposal, plan, todayISO: T.iso(new Date()) });
  if (!d) return null;
  const deltaWord = (d.deltaDisp > 0 ? '+' : '') + d.deltaDisp + ' s /100 ' + d.unit;
  return (
    <ProposalSheet
      ariaLabel="Swim CSS proposal"
      headline={proposal.headline} why={proposal.why}
      stats={[
        { big: d.curLabel, label: 'Current CSS' },
        { big: d.nextLabel, label: 'Proposed' },
        { big: deltaWord, label: d.pct + '% ' + (d.faster ? 'faster' : 'slower') },
      ]}
      source={d.source} discipline="swim" measuredAt={d.measuredAt} confidence={d.confidence}
      example={d.example && <>
        {/* the concrete effect, not an abstraction: the athlete's actual next CSS session */}
        Your next CSS session ({d.example.title}, {T.fmtDate(d.example.date)}) would train at {d.example.next} instead
        of {d.example.cur}, target band {d.example.band}.
      </>}
      onAccept={onAccept} onClose={onClose} />
  );
}
