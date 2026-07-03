import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';

const BAND_LABEL = { green: 'Ready to roll', amber: 'Ease into it', red: 'Recover today' };

// In-app explainer for the daily readiness score, rendered from wellness.MODEL
// so the copy and numbers can never drift from the engine. Full rationale lives
// in docs/READINESS_MODEL.md.
export function ReadinessInfo({ onBack }) {
  const m = T.wellness.MODEL;
  return (
    <>
      <div className="section-title">
        <a className="reset" {...tap(onBack)}>← Back</a>
      </div>
      <div className="card">
        <h2>How your readiness works</h2>
        <p className="lead">
          Every morning starts at <b>{m.start}</b>. Each signal we have data for adjusts it —
          the further you drift from your own normal, the more it moves. HRV and resting HR are
          scored against your rolling 21-day baseline, so it tracks <i>you</i>, not an average.
        </p>
        <div className="band-legend">
          {m.bands.map(b => (
            <div key={b.key} className={'band-row ' + b.key}>
              <span className="band-dot" />
              <b>{BAND_LABEL[b.key]}</b>
              <span className="band-range">{b.key === 'green' ? '75+' : b.key === 'amber' ? '55–74' : 'under 55'}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="factor-head"><h3>Why these numbers</h3></div>
        <p className="lead" style={{ marginTop: 6 }}>{m.policy}</p>
      </div>

      {m.factors.map(f => (
        <div className="card" key={f.key}>
          <div className="factor-head">
            <h3>{f.label}</h3>
            <span className="factor-weight">up to −{f.weight}</span>
          </div>
          <p className="lead" style={{ marginTop: 6 }}>{f.what}</p>
          <div className="factor-bands">
            {f.bands.map(([desc, effect]) => (
              <div className="factor-band" key={desc}>
                <span>{desc}</span>
                <b className={effect.startsWith('+') ? 'good' : effect === '0' ? 'muted' : 'bad'}>{effect}</b>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="lead center" style={{ margin: '4px 8px 8px', fontSize: 12 }}>
        These weights are a considered heuristic, not medical advice — tuned to feel right against
        real training data. Missing a signal never counts against you.
      </p>
    </>
  );
}
