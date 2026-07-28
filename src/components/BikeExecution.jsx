import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';

/* Phase 4 §5. Defaults to the environment the session was written for, and
   for a session that genuinely suits both, to outdoors: that is where most
   riding happens and where the wording matters most, since indoors the
   trainer removes the things the instructions warn about. */
export function BikeExecution({ w, profile }) {
  const ex = T.bikeExecution(w, profile);
  const [env, setEnv] = useState(null);
  if (!ex) return null;
  const shown = env || (ex.suits === 'either' ? 'outdoor' : ex.suits);
  const variant = ex.variants.find(v => v.environment === shown);
  const note = T.bikeEnvironmentNote(w);
  return (
    <>
      <div className="section-title" style={{ margin: '16px 0 6px' }}>
        Where to ride it{note ? ' · ' + note : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {ex.variants.map(v => (
          <a key={v.environment} className="reset" role="button" aria-pressed={shown === v.environment}
            {...tap(() => setEnv(v.environment))}
            style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 12, textTransform: 'capitalize',
              background: shown === v.environment ? 'var(--chip)' : 'transparent',
              border: '1px solid var(--chip)',
              opacity: shown === v.environment ? 1 : 0.6,
            }}>{v.environment}</a>
        ))}
        <span className="lead" style={{ fontSize: 12, alignSelf: 'center' }}>
          {/* phase 2's anchor decides this: watts derived from a level are a
              guess about a category, so RPE is the honest instrument */}
          {variant.targetMode === 'power' ? 'Target: power' : 'Target: perceived effort'}
        </span>
      </div>
      {variant.instructions.map((line, i) => (
        <div className="lead" key={i} style={{ margin: '0 0 6px', fontSize: 13 }}>{line}</div>
      ))}
    </>
  );
}
