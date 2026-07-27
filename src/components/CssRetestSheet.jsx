import * as T from '@/lib';
import { useSheetFocus } from '@/utils/useSheetFocus.js';

/* Phase 3b (spec §4.1-4.2): the retest nudge's tap-through. Explains why a
   test is worth doing now, lays out the 400/200 protocol in the athlete's
   own pool, and either points at the test already on the calendar or offers
   to put one in this week. Recording is the same as any session: swim it
   with the watch and the app reads the CSS from the laps, or note the two
   times and enter the result in Update fitness. */
export function CssRetestSheet({ recommendation, plan, onAddTest, onEditFitness, onClose }) {
  const sheetRef = useSheetFocus(onClose);
  const proto = T.cssTestProtocol(plan.paces);
  const todayISO = T.iso(new Date());
  const upcoming = plan.weeks.flatMap(w => w.workouts)
    .filter(w => w.test && w.testKind === 'swimCss' && w.date >= todayISO)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="CSS test" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '2px 0 2px' }}>{recommendation.headline}</h2>
        <p className="lead" style={{ marginBottom: 12 }}>{recommendation.why}</p>

        <div className="section-title" style={{ margin: '10px 0 6px' }}>The protocol</div>
        <p className="lead" style={{ margin: 0 }}>
          After a good warm-up: {proto.d1} {proto.unit} all out, full recovery, then {proto.d2} {proto.unit} all
          out. Your CSS per 100 {proto.unit} is the {proto.d1} time minus the {proto.d2} time, divided
          by {proto.divisor}. Swim it with your watch and the app works it out from your laps; or note the
          two times and enter the result in Update fitness.
        </p>

        {upcoming
          ? <p className="lead" style={{ margin: '10px 0 0' }}>
            Your plan already has this test scheduled on {T.fmtDate(upcoming.date)}.
          </p>
          : <button className="btn primary" style={{ marginTop: 14 }}
            onClick={() => { onAddTest(); onClose(); }}>Add the test to this week</button>}
        {onEditFitness && <button className="btn ghost" style={{ marginTop: 8 }}
          onClick={() => { onEditFitness(); onClose(); }}>Enter a result by hand</button>}
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
