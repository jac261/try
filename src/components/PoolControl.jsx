import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';

/* Phase 2b: the shared pool picker (three presets plus a custom length), used
   by onboarding and the fitness editor. Emits a { length, unit } via onChange.
   The pool changes how swim work is written, never the athlete's CSS. */
export function PoolControl({ pool, onChange }) {
  const preset = T.POOL_PROFILES.find(r => r.length === pool.length && r.unit === pool.unit) || null;
  const [custom, setCustom] = useState(!preset);
  const [len, setLen] = useState(preset ? '' : String(pool.length));
  const [unit, setUnit] = useState(pool.unit);

  const commitCustom = (l, u) => {
    const p = T.sanePool({ length: Number(l), unit: u });
    if (p) onChange(p); // out-of-range is ignored, never a partial length
  };
  return <>
    <div className="choice">
      {T.POOL_PROFILES.map(r => (
        <div key={r.key} className={'opt' + (!custom && preset && preset.key === r.key ? ' on' : '')}
          {...tap(() => { setCustom(false); onChange({ length: r.length, unit: r.unit }); })}>{r.length} {r.unit === 'yards' ? 'yd' : 'm'}</div>
      ))}
      <div className={'opt' + (custom ? ' on' : '')} {...tap(() => { setCustom(true); if (len) commitCustom(len, unit); })}>Custom</div>
    </div>
    {custom && <div className="row" style={{ marginTop: 8, gap: 8 }}>
      <input value={len} placeholder="e.g. 33" inputMode="decimal" aria-label="Custom pool length" style={{ flex: 1 }}
        onChange={e => { setLen(e.target.value); commitCustom(e.target.value, unit); }} />
      <div className="choice" style={{ flex: '0 0 auto' }}>
        {['metres', 'yards'].map(u => (
          <div key={u} className={'opt' + (unit === u ? ' on' : '')}
            {...tap(() => { setUnit(u); commitCustom(len, u); })}>{u === 'yards' ? 'yd' : 'm'}</div>
        ))}
      </div>
    </div>}
  </>;
}
