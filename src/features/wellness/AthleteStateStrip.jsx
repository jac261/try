import { athleteState } from '@/features/wellness/athleteState.js';
import { Signed } from '@/components/Signed.jsx';

/* The four-tile "where you stand" header on the Progress tab: a two-second
 * read of Fitness / Fatigue / Recovery / Run load, capping the trend charts
 * that back each one. Presentational only — all banding lives in
 * athleteState(). Tapping a live tile opens the matching support topic; the
 * charts it summarises are already on screen just below. */
function ariaFor(t) {
  if (t.empty) return t.label + ', ' + (t.emptyWord || 'not enough data yet') + '.';
  if (t.key === 'fitness') return 'Fitness ' + t.value + ', ' + (t.word || '') + '. Open the fitness and fatigue explainer.';
  if (t.key === 'fatigue') return 'Fatigue ' + t.value + ', ' + (t.word || '') + '. Open the fitness and fatigue explainer.';
  if (t.key === 'recovery') return 'Recovery, form ' + Math.round(t.value) + ', ' + (t.word || '') + '. Open the form explainer.';
  return 'Run load ' + (t.word || '') + ', ' + t.value + ' in the last seven days. Open the ramp explainer.';
}

export function AthleteStateStrip({ wellness, runLoad, recovery, onSupport }) {
  const s = athleteState({ wellness, runLoad, recovery });
  if (!s.show) return null;
  return (
    <>
      <div className="section-title">Where you stand</div>
      <div className="rd-pmc ass-strip">
        {s.tiles.map(t => (
          <button key={t.key} className="ass-tile" disabled={t.empty}
            onClick={() => !t.empty && onSupport && onSupport(t.topic)}
            aria-label={ariaFor(t)}>
            {t.empty
              ? <b className="ass-empty">{t.emptyWord || 'Not enough data yet'}</b>
              : <>
                  <b style={t.color ? { color: t.color } : undefined}>
                    {t.signed ? <Signed v={t.value} /> : t.value}
                    {t.arrow && <span className="ass-arrow">{t.arrow}</span>}
                  </b>
                  {t.word && <em className="ass-word" style={t.color ? { color: t.color } : undefined}>{t.word}</em>}
                  {t.sub && <i className="ass-sub">{t.sub}</i>}
                </>}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {s.derived && <div className="ass-note">Fitness, Fatigue and Recovery are estimated from your training log</div>}
    </>
  );
}
