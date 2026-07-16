import { athleteState } from '@/features/wellness/athleteState.js';

/* The four-tile "where you stand" header on the Progress tab: a two-second
 * read of Fitness / Fatigue / Recovery / Run load. The tiles lead with words
 * ("Rising", "Fresh"), not numbers — the raw figures headline the charts
 * lower on the tab, and this strip is their interpretation, not a restatement
 * (see athleteState.js). Presentational only — all banding lives in
 * athleteState(). Tapping a live tile opens the matching support topic. */
/* exported for tests: two aria bugs (a spoken "·", a doubled "high risk")
 * shipped through this function unasserted (2026-07-15 gauntlet) */
export function ariaFor(t) {
  if (t.empty) return t.label + ', ' + (t.emptyWord || 'not enough data yet') + '.';
  if (t.key === 'fitness' || t.key === 'fatigue') return t.label + ' ' + (t.word || '').toLowerCase() + '. Open the fitness and fatigue explainer.';
  if (t.key === 'recovery') return 'Recovery, ' + (t.word || '').toLowerCase() + (t.sub ? ', ' + t.sub : '') + '. Open the form explainer.';
  // the sub's "·" is a visual separator; spoken it is garbage, so say a comma
  return 'Run load ' + (t.word || '').toLowerCase() + ', ' + String(t.sub || '').replace(' · ', ', ') + '. Open the ramp explainer.';
}

export function AthleteStateStrip({ wellness, runLoad, recovery, onSupport, excludedDiscipline }) {
  const s = athleteState({ wellness, runLoad, recovery, excludedDiscipline });
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
                  <b className="ass-word" style={t.color ? { color: t.color } : undefined}>
                    {t.word}
                    {t.arrow && <span className="ass-arrow">{t.arrow}</span>}
                  </b>
                  {t.sub && <i className="ass-sub">{t.sub}</i>}
                </>}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {/* "estimated", matching WellnessTrends and ReadinessCard word for word:
          derived load is modelled from the log, not read off a device */}
      {s.derived && <div className="ass-note">Fitness, Fatigue and Recovery are estimated from your training log</div>}
    </>
  );
}
