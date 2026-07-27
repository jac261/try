import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { useSheetFocus } from '@/utils/useSheetFocus.js';

/* Phase 5: what the athlete is working on, and what kit they own. Both are
   optional and both are honest about their limits: this picks drills, it
   does not analyse anyone's stroke. Declaring nothing leaves technique
   sessions exactly as they were. */
export function TechniqueEditor({ profile, onClose, onSave }) {
  const sheetRef = useSheetFocus(onClose);
  const cur = T.saneTechnique(profile.technique) || { focus: [], kit: null };
  const [focus, setFocus] = useState(cur.focus);
  const [kit, setKit] = useState(cur.kit);
  const [owRace, setOwRace] = useState(!!profile.openWaterRace);

  // Two at most: a session that chases everything improves nothing. Picking a
  // third replaces the older choice rather than silently doing nothing.
  const toggleFocus = id => setFocus(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id].slice(-2));
  const toggleKit = id => setKit(k => {
    const list = k || [];
    return list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  });

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="Swim technique" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '2px 0 2px' }}>Swim technique</h2>
        <p className="lead">Tell us what you are working on and your technique sessions will pick drills for it. Leave it blank and your sessions stay exactly as they are.</p>

        <div className="section-title" style={{ margin: '10px 0 6px' }}>What are you working on?</div>
        <p className="lead" style={{ fontSize: 13, marginTop: -2 }}>Pick up to two. The first one leads.</p>
        <div className="choice" style={{ flexWrap: 'wrap' }}>
          {T.TECHNIQUE_FOCUS.map(f => {
            const i = focus.indexOf(f.id);
            return <div key={f.id} className={'opt' + (i >= 0 ? ' on' : '')} {...tap(() => toggleFocus(f.id))}>
              {f.label}<small>{i === 0 ? 'main focus' : i === 1 ? 'second focus' : f.hint}</small>
            </div>;
          })}
        </div>

        <div className="section-title" style={{ margin: '14px 0 6px' }}>Your kit</div>
        <p className="lead" style={{ fontSize: 13, marginTop: -2 }}>
          {kit === null
            ? 'Tell us what you own and we will only prescribe drills you can actually do.'
            : 'Only drills you have the kit for will be prescribed. Most drills need nothing at all.'}
        </p>
        <div className="choice" style={{ flexWrap: 'wrap' }}>
          {T.SWIM_EQUIPMENT.map(e => (
            <div key={e.id} className={'opt' + ((kit || []).includes(e.id) ? ' on' : '')}
              {...tap(() => toggleKit(e.id))}>{e.label}{e.id === 'wetsuit' ? <small>open water, not pool drills</small> : null}</div>
          ))}
        </div>
        {kit !== null && !kit.length && <p className="lead" style={{ fontSize: 13, marginTop: 8 }}>Nothing selected: you will only get drills that need no kit, which is most of them.</p>}

        <div className="section-title" style={{ margin: '14px 0 6px' }}>Open water</div>
        <p className="lead" style={{ fontSize: 13, marginTop: -2 }}>Open-water sessions always appear in your peak weeks. Turn this on and open-water skills start earlier, on your second quality swim of the week.</p>
        <div className="choice">
          <div className={'opt' + (owRace ? ' on' : '')} {...tap(() => setOwRace(true))}>My race swim is open water</div>
          <div className={'opt' + (!owRace ? ' on' : '')} {...tap(() => setOwRace(false))}>Pool race, or not sure</div>
        </div>

        <button className="btn primary" style={{ marginTop: 16 }}
          onClick={() => { onSave({ openWaterRace: owRace, technique: { focus, kit: kit === null ? undefined : kit, updatedAt: T.iso(new Date()) } }); onClose(); }}>
          Save
        </button>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
