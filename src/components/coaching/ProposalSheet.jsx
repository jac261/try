import * as T from '@/lib';
import { useSheetFocus } from '@/utils/useSheetFocus.js';
import { ConfidenceBadge } from './ConfidenceBadge.jsx';

/* Try — the shared proposal sheet (phase 2 §5.3, stage 2).
 *
 * A DUMB view-model component, deliberately: it computes nothing, so it can
 * never drift from the details builders the discipline wrappers feed it.
 * The three sheets were near-identical twins with duplicated skeletons and
 * two drifting private SOURCE_WORDS maps; the skeleton now lives once —
 * headline, why, the three-stat row, the evidence sentence with its
 * confidence badge, the discipline's own concrete-example sentence, accept
 * and decline. Declining changes nothing and journals nothing: the banner
 * returns, and the banner's own dismiss is the journalled rejection.
 */
export function ProposalSheet({ ariaLabel, headline, why, stats, source, discipline, measuredAt, confidence, example, acceptLabel, onAccept, onClose }) {
  const sheetRef = useSheetFocus(onClose);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label={ariaLabel} onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '2px 0 2px' }}>{headline}</h2>
        <p className="lead" style={{ marginBottom: 12 }}>{why}</p>

        <div className="rd-pmc" style={{ flexWrap: 'wrap' }}>
          {stats.map((s, i) => (
            <div key={i}><b style={{ fontSize: 15 }}>{s.big}</b><span>{s.label}</span></div>
          ))}
        </div>

        <p className="lead" style={{ margin: '12px 0 0' }}>
          Evidence: {T.proposalSourceWord(source, discipline)}
          {measuredAt ? ', ' + T.fmtDate(measuredAt) : ''}
          {confidence ? <> · <ConfidenceBadge confidence={confidence} /></> : null}.
        </p>

        {example && (
          <p className="lead" style={{ margin: '8px 0 0' }}>{example}</p>
        )}

        <button className="btn primary" style={{ marginTop: 16 }}
          onClick={() => { onAccept(); onClose(); }}>{acceptLabel || 'Retarget my plan'}</button>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={onClose}>Not now</button>
      </div>
    </div>
  );
}
