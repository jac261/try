import * as T from '@/lib';
import { useSheetFocus } from '@/utils/useSheetFocus.js';

/* Phase 2 §5: the evidence behind an FTP retarget, shown before anything
   changes. The banner used to retarget on a single tap; it now opens this,
   because FTP is the number every bike target is built from and a one-tap
   change to it deserves its reasoning on screen. Accepting runs the exact
   same retarget the banner always ran; declining changes nothing. */

const SOURCE_WORDS = {
  'try-test': 'your bike test',
  'activity-model': 'the rolling estimate from your rides',
  'intervals-icu': 'your intervals.icu threshold',
  manual: 'a manual entry',
};

export function FtpProposalSheet({ proposal, plan, onAccept, onClose }) {
  const sheetRef = useSheetFocus(onClose);
  const d = T.ftpProposalDetails({ proposal, plan, todayISO: T.iso(new Date()) });
  if (!d) return null;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="FTP proposal" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '2px 0 2px' }}>{proposal.headline}</h2>
        <p className="lead" style={{ marginBottom: 12 }}>{proposal.why}</p>

        <div className="rd-pmc" style={{ flexWrap: 'wrap' }}>
          <div><b style={{ fontSize: 15 }}>{d.currentWatts} W</b><span>Current FTP</span></div>
          <div><b style={{ fontSize: 15 }}>{d.proposedWatts} W</b><span>Proposed</span></div>
          <div><b style={{ fontSize: 15 }}>{d.deltaWatts > 0 ? '+' : ''}{d.deltaWatts} W</b><span>{d.pct}% {d.up ? 'higher' : 'lower'}</span></div>
        </div>

        <p className="lead" style={{ margin: '12px 0 0' }}>
          Evidence: {SOURCE_WORDS[d.source] || 'a new reading'}
          {d.measuredAt ? ', ' + T.fmtDate(d.measuredAt) : ''}
          {d.confidence ? ' · ' + d.confidence + ' confidence' : ''}.
        </p>

        {d.example && (
          <p className="lead" style={{ margin: '8px 0 0' }}>
            {/* the concrete effect: the athlete's own next quality ride */}
            Your next quality ride ({d.example.title}, {T.fmtDate(d.example.date)}) would ask
            for {d.example.next} instead of {d.example.cur} on its {d.example.label.toLowerCase()}.
          </p>
        )}

        <button className="btn primary" style={{ marginTop: 16 }}
          onClick={() => { onAccept(); onClose(); }}>Retarget my plan</button>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={onClose}>Not now</button>
      </div>
    </div>
  );
}
