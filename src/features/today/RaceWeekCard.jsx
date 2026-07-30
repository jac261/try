import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';

/* Race-week countdown (design panel 2026-07-30): lives on Today only through
   the final week, days-to-go as the hero, one taper reassurance line, and a
   three-item prep checklist. Ticks persist per user via storage AND per race
   signature, so a new race (or a moved race date) starts the list clean. */

// Checklist copy adapts to what the athlete is actually racing: a solo run
// race has no swim exit or wetsuit to recon.
const prepItems = race => [
  { k: 'recon', t: 'Recon the course', s: race.solo ? 'Start area, key climbs, the finish' : 'Swim exit, transition layout, first climb' },
  { k: 'kit', t: 'Prep your kit', s: race.solo ? 'Shoes, kit and race number laid out' : 'Bike serviced, wetsuit and race numbers ready' },
  { k: 'fuel', t: 'Plan your fuelling', s: 'Race breakfast, bottles and on-course carbs' },
];

// `now` is injectable for the dev harness and tests; the app never passes it.
export function RaceWeekCard({ plan, storage, now }) {
  const race = T.RACES[plan.race];
  const days = T.daysBetween(now || new Date(), plan.profile.raceDate);
  const sig = plan.race + ':' + plan.profile.raceDate;
  const [ticks, setTicks] = useState(() => {
    const v = storage && storage.load('racePrep', null);
    return v && v.sig === sig ? v.done : {};
  });
  if (!race || race.noRace || days < 0 || days > 7) return null;

  const items = prepItems(race);
  const nDone = items.filter(i => ticks[i.k]).length;
  const toggle = k => setTicks(t => {
    const n = { ...t, [k]: !t[k] };
    if (storage) storage.save('racePrep', { sig, done: n });
    return n;
  });
  const raceDay = days === 0;

  return (
    <div className="card" aria-label={raceDay ? 'Race day' : days + ' days to race day'}>
      <div className="rw-head">
        <span className="tag key">{raceDay ? 'Race day' : 'Race week'}</span>
        {race.taperWeeks > 0 && !raceDay && <span className="rw-phase">Taper</span>}
      </div>
      <div className="rw-hero">
        {raceDay
          ? <div className="rw-days rw-go"><Icon name="flag" size={38} /></div>
          : <div className="rw-days"><b className="rw-num">{days}</b><span className="rw-lab">day{days === 1 ? '' : 's'}<br />to go</span></div>}
        <div>
          <div className="rw-name">{race.name}{race.solo ? '' : ' Triathlon'}</div>
          <div className="rw-date">{T.fmtDate(plan.profile.raceDate, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
      </div>
      <div className="rw-bar"><span style={{ width: Math.round((7 - days) / 7 * 100) + '%' }} /></div>
      <div className="why"><span className="why-label">{raceDay ? 'Today' : 'Taper week'}</span>
        {raceDay
          ? 'The work is banked. Start steady, settle in, and let the day come to you.'
          : 'Short and sharp from here. Feeling a little flat is normal, the freshness arrives on race day.'}</div>
      <div className="rw-prep-head"><span>Race prep</span><span className="rw-count">{nDone} of {items.length} done</span></div>
      {items.map(i => (
        <div key={i.k} className={'wk' + (ticks[i.k] ? ' done' : '')} {...tap(() => toggle(i.k))}
          aria-label={i.t + (ticks[i.k] ? ', done' : ', not done')}>
          <div className="meta"><div className="t">{i.t}</div><div className="s">{i.s}</div></div>
          <div className="check" aria-hidden="true">✓</div>
        </div>
      ))}
    </div>
  );
}
