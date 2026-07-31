import * as T from '@/lib';
import { ProposalSheet } from '@/components/coaching/ProposalSheet.jsx';

/* §5 + §6: the evidence behind a bike FTP retarget. A thin wrapper over the
   shared ProposalSheet since phase 2; the bike keeps its details builder and
   its concrete-example sentence (the effect in WATTS on the athlete's own
   next quality ride). Accepting runs the same retarget as always; declining
   changes nothing. */
export function FtpProposalSheet({ proposal, plan, onAccept, onClose }) {
  const d = T.ftpProposalDetails({ proposal, plan, todayISO: T.iso(new Date()) });
  if (!d) return null;
  return (
    <ProposalSheet
      ariaLabel="FTP proposal"
      headline={proposal.headline} why={proposal.why}
      stats={[
        { big: d.currentWatts + ' W', label: 'Current FTP' },
        { big: d.proposedWatts + ' W', label: 'Proposed' },
        { big: (d.deltaWatts > 0 ? '+' : '') + d.deltaWatts + ' W', label: d.pct + '% ' + (d.up ? 'higher' : 'lower') },
      ]}
      source={d.source} discipline="bike" measuredAt={d.measuredAt} confidence={d.confidence}
      example={d.example && <>
        {/* the concrete effect: the athlete's own next quality ride */}
        Your next quality ride ({d.example.title}, {T.fmtDate(d.example.date)}) would ask
        for {d.example.next} instead of {d.example.cur} on its {d.example.label.toLowerCase()}.
      </>}
      onAccept={onAccept} onClose={onClose} />
  );
}
