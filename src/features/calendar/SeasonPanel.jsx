import { useMemo } from 'react';
import * as T from '@/lib';
import { TrendChart } from '@/components/charts.jsx';
import { Icon } from '@/components/Icon.jsx';
import { tap } from '@/utils/a11y.js';

/* Season — the long view (design: screens/Season Screen.dc.html).
 *
 * Month and week answer "what am I doing". This answers "am I on the ramp":
 * the whole plan as one curve, the blocks it is made of, and the dates between
 * here and the race. All three read from seasonCurve/seasonMilestones; nothing
 * here computes training load.
 */
const PHASE = T.PHASE_INFO;

export function SeasonPanel({ plan, wellness, log, moves, adjust, todayISO, onOpenSettings }) {
  const s = useMemo(() => T.seasonCurve({ plan, wellness, log, moves, adjust, todayISO }),
    [plan, wellness, log, moves, adjust, todayISO]);
  const milestones = useMemo(() => T.seasonMilestones({ plan, moves, todayISO, limit: 4 }),
    [plan, moves, todayISO]);
  const shortfall = useMemo(() => T.seasonShortfall(s), [s]);

  /* No plan, no season. The Plan tab's own words rather than a new phrase for
     the same state — an athlete who reads both should not have to work out
     whether they mean different things. */
  if (!s) return (
    <div className="card" style={{ textAlign: 'center', padding: '26px 18px' }}>
      <div className="empty" style={{ padding: 0 }}>
        <div className="big"><Icon name="trend" size={48} /></div>No plan active
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.5, margin: '12px 0 0' }}>
        The season view charts a plan from its first week to its last. Start one and the ramp appears here.
      </p>
    </div>
  );

  const ctl = s.points.map(p => p.ctl);
  const anyLoad = ctl.some(v => v != null);
  /* Two series off one set of points: the done half solid, the planned half
     dashed, overlapping by ONE point so the join is a continuous line rather
     than a gap the width of a week. */
  const cut = s.points.findIndex(p => p.projected);
  const done = cut < 0 ? ctl : ctl.map((v, i) => (i <= cut ? v : null));
  const ahead = cut < 0 ? ctl.map(() => null) : ctl.map((v, i) => (i >= cut - 1 && i > 0 ? v : null));

  const at = i => {
    if (i == null) return null;
    const lo = Math.floor(i), hi = Math.min(ctl.length - 1, Math.ceil(i));
    if (ctl[lo] == null || ctl[hi] == null) return null;
    return ctl[lo] + (ctl[hi] - ctl[lo]) * (i - lo);
  };
  const marks = [];
  if (s.todayIndex != null) marks.push({ i: s.todayIndex, label: 'TODAY', value: at(s.todayIndex), big: true });
  if (s.raceIndex != null) marks.push({ i: s.raceIndex, label: 'RACE', value: at(s.raceIndex), color: '#facc15' });

  return (
    <>
      <div className="card season-ramp">
        <div className="sr-head">
          <span>Fitness across the season</span>
          {s.block && <span className="sr-block">{s.block.label} · wk {s.block.week} of {s.block.of}</span>}
        </div>
        {anyLoad ? <>
          <div className="sr-plot">
            <TrendChart height={132} axis
              series={[
                { values: done, color: '#ffffff', fill: true, width: 2.6, noDot: true },
                { values: ahead, color: 'rgba(255,255,255,.5)', width: 2.6, dash: '5 5', noDot: true },
              ]}
              marks={marks}
              ribbon={s.phases.map(p => ({
                from: p.from, to: p.to, label: p.label,
                color: (PHASE[p.label] || {}).color || 'var(--chart)',
              }))} />
          </div>
          {/* Said in words as well as in stroke style: a dashed line is only a
              convention until something spells it out, and this one is built
              on sessions the athlete has not done yet. */}
          <p className="sr-note">Solid is what you have done. Dashed is what this plan would give you if you
            complete it, estimated — it moves every time you do.</p>
          {/* The caption escalates when the dashed line never regains the
              solid one: the plan's load is below what this athlete's fitness
              needs to hold. Not dismissible on purpose — the season view is
              visited deliberately, the words caption a picture that stays
              either way, and the condition clears itself when the level or
              the days change, or the measured line comes down. Engine
              parameters stay out of the copy: the two lines ARE the
              explanation. */}
          {shortfall && (
            <div className="banner ramp" style={{ margin: '12px 0 0' }}
              {...(onOpenSettings ? tap(() => onOpenSettings('profile')) : {})}>
              <div className="bi"><Icon name="trend" size={20} /></div>
              <div className="btx">
                <div className="bt">Planned load sits below your fitness</div>
                <div className="bs">The dashed line never reaches where the solid one ends.
                  {onOpenSettings ? ' Update your level or training days and the plan re-targets. →' : ''}</div>
              </div>
            </div>
          )}
        </> : (
          <div className="empty" style={{ padding: '22px 8px' }}>
            No fitness readings yet. Log a few sessions, or connect a feed, and the ramp fills in.
          </div>
        )}
      </div>

      <div className="card season-blocks">
        <div className="section-sub">Blocks</div>
        {/* Nearer is more raised: the block you are in is lifted and coloured,
            the next is lifted and plain, everything beyond presses in. Depth
            carrying an ORDER rather than a state is new here (STYLE_GUIDE 7b). */}
        {s.phases.map((p, i) => {
          const wi = s.weekOfSeason != null ? s.weekOfSeason - 1 : null;
          const now = s.block && wi != null && p.from <= wi && wi <= p.to;
          const cur = wi != null ? s.phases.find(q => q.from <= wi && wi <= q.to) : null;
          const next = !now && cur && p.from === cur.to + 1;
          /* Spent blocks are not the same as distant ones. Both press in —
             neither is where you are — but a finished block reads back rather
             than merely inert, or "nearer is more raised" would be broken by
             the block you just came out of. */
          const done = wi != null && p.to < wi;
          const weeks = p.to - p.from + 1;
          return (
            <div key={i} className={'sb-row' + (now ? ' now' : next ? ' next' : done ? ' far done' : ' far')}
              style={now ? { '--ph': (PHASE[p.label] || {}).color } : undefined}>
              <div className="sb-name">{p.label}{now ? ' · wk ' + s.block.week + ' of ' + s.block.of
                : ' · ' + weeks + (weeks === 1 ? ' week' : ' weeks')}</div>
              {now
                ? <div className="sb-bar"><i style={{ width: Math.round(s.block.week / s.block.of * 100) + '%' }} /></div>
                : <div className="sb-when">{monthSpan(s.points, p)}</div>}
            </div>
          );
        })}
      </div>

      {milestones.length > 0 && <div className="card season-miles">
        <div className="section-sub">Milestones</div>
        {milestones.map(m => (
          <div key={m.id} className={'sm-row' + (m.kind === 'race' ? ' race' : '')}>
            <div className={'sm-ic sm-' + m.kind}><Icon name={m.icon} size={16} /></div>
            <div className="sm-label">{m.label}</div>
            <div className="sm-date">{T.fmtDate(m.date, { day: 'numeric', month: 'short' })}</div>
          </div>
        ))}
      </div>}
    </>
  );
}

// "Sep" or "Sep–Oct" for a block, from the weeks it actually covers.
function monthSpan(points, p) {
  const a = points[p.from], b = points[p.to];
  if (!a || !b) return '';
  const m = d => T.fmtDate(d.date, { month: 'short' });
  return m(a) === m(b) ? m(a) : m(a) + '–' + m(b);
}
