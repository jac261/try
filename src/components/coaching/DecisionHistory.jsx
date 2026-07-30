import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';

/* Try — the athlete-facing decision history (phase 2 §9).
 *
 * What Try decided or offered, and what the athlete did about it — folded
 * by default, because it is a reference, not a feed. Each row: date,
 * headline, status chip; expanding shows the why, the confidence, and where
 * the evidence came from in the athlete's words. Entries from a previous
 * plan stay visible and dated (history survives a reshape by design); only
 * the athlete's terminal actions appear, never transient proposals.
 */

const STATUS_WORDS = { accepted: 'Accepted', rejected: 'Dismissed', superseded: 'Superseded', applied: 'Applied' };
const STATUS_CLS = { accepted: 'right', rejected: '', superseded: '', applied: 'right' };

export function DecisionHistory({ log, planCreatedAt }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const entries = (log || []).slice(-12).reverse();
  if (!entries.length) return null;
  return (
    <>
      <div className="section-title" style={{ marginTop: 16 }}>
        Coaching history
        <a className="reset" {...tap(() => setOpen(o => !o))} role="button"
          aria-expanded={open} style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none' }}>
          {open ? 'Hide' : 'Show'}
        </a>
      </div>
      {open && <div className="card">
        {entries.map((e, i) => (
          <div className="seg" key={e.id + ':' + e.at + ':' + i} style={{ padding: '6px 0', cursor: 'pointer' }}
            {...tap(() => setExpanded(expanded === i ? null : i))}>
            <div className="bar" style={{ background: e.status === 'accepted' ? 'var(--run)' : 'var(--chip)' }} />
            <div style={{ flex: 1 }}>
              <div className="l">{e.headline || 'An earlier proposal'}</div>
              <div className="d">
                {T.fmtDate((e.at || '').slice(0, 10))}
                {planCreatedAt && e.planCreatedAt && e.planCreatedAt !== planCreatedAt ? ' · a previous plan' : ''}
              </div>
              {expanded === i && <div className="d" style={{ marginTop: 4 }}>
                {e.why}
                {e.confidence ? ' · ' + e.confidence + ' confidence' : ''}
              </div>}
            </div>
            <div className={'feelbtn on ' + (STATUS_CLS[e.status] || '')} style={{ pointerEvents: 'none', fontSize: 11 }}>
              {STATUS_WORDS[e.status] || e.status}
            </div>
          </div>
        ))}
        <div className="lead" style={{ margin: '8px 0 0', fontSize: 12 }}>
          Nothing here changed your plan without you: accepted means you said yes, dismissed means you said not now.
        </div>
      </div>}
    </>
  );
}
