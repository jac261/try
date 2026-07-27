import * as T from '@/lib';
import { useSheetFocus } from '@/utils/useSheetFocus.js';

/* Phase 3b (spec §6): the evidence behind a swim CSS retarget, shown before
   anything changes. The banner used to retarget on a single tap; for swim it
   now opens this sheet so the athlete sees the current value, the proposed
   one, the size of the change, where the evidence came from and what it does
   to their next CSS session, then decides. Accepting runs the exact same
   retarget the banner always ran; declining changes nothing. */

const SOURCE_WORDS = {
  'try-test': 'your swum 400/200 test',
  'intervals-icu': 'your intervals.icu threshold',
  manual: 'a manual entry',
  estimated: 'an estimate',
};

export function CssProposalSheet({ proposal, plan, onAccept, onClose }) {
  const sheetRef = useSheetFocus(onClose);
  const d = T.cssProposalDetails({ proposal, plan, todayISO: T.iso(new Date()) });
  if (!d) return null;
  const deltaWord = (d.deltaDisp > 0 ? '+' : '') + d.deltaDisp + ' s /100 ' + d.unit;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="Swim CSS proposal" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '2px 0 2px' }}>{proposal.headline}</h2>
        <p className="lead" style={{ marginBottom: 12 }}>{proposal.why}</p>

        <div className="rd-pmc" style={{ flexWrap: 'wrap' }}>
          <div><b style={{ fontSize: 15 }}>{d.curLabel}</b><span>Current CSS</span></div>
          <div><b style={{ fontSize: 15 }}>{d.nextLabel}</b><span>Proposed</span></div>
          <div><b style={{ fontSize: 15 }}>{deltaWord}</b><span>{d.pct}% {d.faster ? 'faster' : 'slower'}</span></div>
        </div>

        <p className="lead" style={{ margin: '12px 0 0' }}>
          Evidence: {SOURCE_WORDS[d.source] || 'a new reading'}
          {d.measuredAt ? ', ' + T.fmtDate(d.measuredAt) : ''}
          {d.confidence ? ' · ' + d.confidence + ' confidence' : ''}.
        </p>

        {d.example && (
          <p className="lead" style={{ margin: '8px 0 0' }}>
            {/* the concrete effect, not an abstraction: the athlete's actual next CSS session */}
            Your next CSS session ({d.example.title}, {T.fmtDate(d.example.date)}) would train at {d.example.next} instead
            of {d.example.cur}, target band {d.example.band}.
          </p>
        )}

        <button className="btn primary" style={{ marginTop: 16 }}
          onClick={() => { onAccept(); onClose(); }}>Retarget my plan</button>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={onClose}>Not now</button>
      </div>
    </div>
  );
}
