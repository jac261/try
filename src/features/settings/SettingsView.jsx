import { useState, useEffect } from 'react';
import { useAuth, useUser, SignOutButton } from '@clerk/react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import {
  getAuthTest, apiBaseUrl,
  getIntervalsIntegration, connectIntervalsIntegration, disconnectIntervalsIntegration, syncWellness,
} from '@/lib/api.js';
import { APP_BASE_URL } from '@/config/env.js';

/* Connect the athlete's intervals.icu account. The key goes straight to the
   backend (write-only there); once connected, readiness fills itself from the
   watch data instead of manual entry. onWellnessSynced hands the freshly synced
   records up so the Today readiness card updates without a reload. */
// When zero sessions went up, say where the week's sessions went instead —
// each phrasing names a different code path, so the line is a remote diagnosis.
function zeroWhy(p) {
  if (p.events !== 0 || p.inWindow == null) return '';
  if (p.inWindow === 0) return ' The plan has no sessions in the next 7 days.';
  if (p.doneInWindow >= p.inWindow) return ' All ' + p.inWindow + ' of this week’s sessions are marked done.';
  return ' Odd: ' + p.inWindow + ' planned, ' + p.doneInWindow + ' done, yet none were sendable — report this exact line.';
}

function IntervalsIcuCard({ onWellnessSynced, watchSync, onWatchSync, watchPush }) {
  const { getToken, isLoaded } = useAuth();
  const [status, setStatus] = useState(null);   // null = loading; {connected, athleteId, lastSyncedAtUtc}
  const [athleteId, setAthleteId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    getIntervalsIntegration(getToken).then(res => {
      if (cancelled) return;
      if (res.ok && res.body) setStatus(res.body);
      else { setStatus({ connected: false }); if (res.status === 404 || res.status === null) setUnavailable(true); }
    });
    return () => { cancelled = true; };
  }, [isLoaded, getToken]);

  async function connect() {
    setBusy(true); setError(null);
    const res = await connectIntervalsIntegration(getToken, athleteId.trim(), apiKey.trim());
    if (res.ok && res.body) {
      setStatus(res.body); setApiKey('');
      // First sync pulls a full year, so a new user's charts and baselines are
      // deep from the start (an older backend ignores the window: ~60 days).
      const synced = await syncWellness(getToken, 365);
      if (synced.ok && Array.isArray(synced.body)) {
        onWellnessSynced && onWellnessSynced(synced.body);
        setStatus(s => ({ ...s, lastSyncedAtUtc: new Date().toISOString() }));
      }
    } else {
      setError(res.message || 'Could not connect to intervals.icu.');
    }
    setBusy(false);
  }

  async function disconnect() {
    setBusy(true); setError(null);
    await disconnectIntervalsIntegration(getToken);
    setStatus({ connected: false });
    setBusy(false);
  }

  if (unavailable) return null; // backend predates the integration — hide quietly
  if (!status) return <div className="authbox"><div className="authmeta">Checking intervals.icu…</div></div>;

  if (status.connected) {
    return (
      <div className="authbox">
        <div className="authrow">
          <div>
            <div className="authlabel">intervals.icu</div>
            <div className="authmeta">Athlete {status.athleteId}{status.lastSyncedAtUtc ? ' · synced ' + T.fmtDate(status.lastSyncedAtUtc.slice(0, 10), { month: 'short', day: 'numeric' }) : ' · not synced yet'}</div>
          </div>
          <button className="btn ghost sm" type="button" onClick={disconnect} disabled={busy}>Disconnect</button>
        </div>
        <div className="authmeta">Readiness pulls your HRV, sleep, resting HR &amp; Form automatically on each visit.</div>
        <label className="authrow" style={{ cursor: 'pointer' }}>
          <div>
            <div className="authlabel">Send workouts to my watch</div>
            <div className="authmeta">Upcoming sessions land on your intervals.icu calendar, and Garmin picks them up from there. Plan changes and engine adjustments follow automatically.</div>
          </div>
          <input type="checkbox" checked={!!watchSync} onChange={e => onWatchSync && onWatchSync(e.target.checked)} />
        </label>
        {watchSync && (
          <div className="authmeta" style={watchPush && !watchPush.ok ? { color: '#f6b27a' } : {}}>
            {!watchPush ? 'Sync runs a moment after the app loads — reopen Settings to see the result.'
              : watchPush.upToDate ? 'Up to date: ' + watchPush.events + ' session' + (watchPush.events === 1 ? '' : 's') + ' on the calendar.' + zeroWhy(watchPush)
                : watchPush.notSupported ? 'The backend is not accepting planned events (404) — sessions cannot reach the calendar. One for Jack.'
                  : watchPush.ok ? 'Last sync: ' + watchPush.events + ' session' + (watchPush.events === 1 ? '' : 's') + ' sent to the calendar.' + zeroWhy(watchPush)
                    : 'Last sync FAILED (' + (watchPush.status || 'network') + ') — sessions are not reaching the calendar. Tell Jack the planned-events endpoint is erroring.'}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="authbox">
      <div className="authlabel">Connect intervals.icu</div>
      <div className="authmeta">Readiness fills itself from your watch data — no more manual entry. Your API key is stored server-side and never shown again (intervals.icu → Settings → Developer).</div>
      <label className="field" style={{ marginBottom: 0 }}><span className="lab">Athlete ID</span>
        <input value={athleteId} placeholder="i123456" onChange={e => setAthleteId(e.target.value)} /></label>
      <label className="field" style={{ marginBottom: 0 }}><span className="lab">API key</span>
        <input type="password" value={apiKey} placeholder="API key" onChange={e => setApiKey(e.target.value)} /></label>
      <button className="btn primary" type="button" onClick={connect} disabled={!isLoaded || busy || !athleteId.trim() || !apiKey.trim()}>
        {busy ? 'Connecting…' : 'Connect & sync'}
      </button>
      {error && <div className="authstatus bad"><div>{error}</div></div>}
    </div>
  );
}

// Account row + a one-tap check that the signed-in JWT reaches the backend.
function ApiConnectionCard() {
  const { getToken, isLoaded } = useAuth();
  const { user } = useUser();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function testApiConnection() {
    setBusy(true);
    setResult(null);
    const response = await getAuthTest(getToken);
    if (response.ok) {
      setResult({ ok: true, message: 'API connection authenticated.', subject: (response.body && response.body.subject) || '' });
    } else {
      const prefix = response.status ? response.status + ': ' : '';
      setResult({ ok: false, message: prefix + response.message, subject: '' });
    }
    setBusy(false);
  }

  return (
    <div className="authbox">
      <div className="authrow">
        <div>
          <div className="authlabel">Account &amp; API</div>
          <div className="authmeta">{apiBaseUrl}</div>
        </div>
        <SignOutButton redirectUrl={APP_BASE_URL}>
          <button className="btn ghost sm" type="button">Sign out</button>
        </SignOutButton>
      </div>
      <div className="authrow">
        <div className="authmeta">{user?.primaryEmailAddress?.emailAddress || user?.id || 'Signed in'}</div>
        <button className="btn ghost sm" type="button" onClick={testApiConnection} disabled={!isLoaded || busy}>
          {busy ? 'Testing…' : 'Test API connection'}
        </button>
      </div>
      {result && (
        <div className={'authstatus ' + (result.ok ? 'ok' : 'bad')}>
          <div>{result.message}</div>
          {result.subject && <code>{result.subject}</code>}
        </div>
      )}
    </div>
  );
}

export function SettingsView({ plan, tracker, onEnterTracker, onRegenerate, onReset, onExport, onEditFitness, onEditPlan, onReleaseWurm, onWellnessSynced, onExportCalibration, calibrationCount, watchSync, onWatchSync, watchPush, onSupportHub }) {
  const [wc, setWc] = useState(0);
  const clickWurm = () => { const n = wc + 1; if (n >= 10) { setWc(0); onReleaseWurm(); } else setWc(n); };
  const p = plan.profile;
  return (
    <>
      <div className="section-title">Profile</div>
      <div className="card">
        <h2>{p.name}</h2>
        <p className="lead">{tracker
          ? 'No plan active. Just tracking your sessions.'
          : <>Training for the {T.RACES[p.raceType].name} on {T.fmtDate(T.iso(p.raceDate), { month: 'long', day: 'numeric', year: 'numeric' })}</>}</p>
        <div className="statline">
          <div className="s"><b>{p.daysPerWeek}</b><span>days/week</span></div>
          <div className="s"><b style={{ textTransform: 'capitalize' }}>{p.fitness}</b><span>level</span></div>
          {!tracker && <div className="s"><b>{plan.totalWeeks - (plan.weeks.length && plan.weeks[plan.weeks.length - 1].isRecovery && !T.RACES[plan.race].noRace ? 1 : 0)}</b><span>build weeks</span></div>}
        </div>
        {(() => {
          // Solo plans keep the statline honest: the 5k tile, weight when
          // present, and nothing invented to fill the space. Swim and FTP
          // numbers stay on the profile for the next multisport plan.
          const solo = !tracker && (T.RACES[p.raceType] || {}).solo;
          return <div className="statline">
            <div className="s"><b>{p.fivekSec ? T.fmtPace(p.fivekSec / 5) : '~' + T.fmtPace(((T.FITNESS[p.fitness] || T.FITNESS.intermediate)[solo ? 'runEst5k' : 'est5k']) / 5)}</b><span>{p.fivekSec ? '5k pace/km' : '5k pace · est'}</span></div>
            {!solo && <div className="s"><b>{p.css100Sec ? T.fmtPace(p.css100Sec) : '~' + T.fmtPace((T.FITNESS[p.fitness] || T.FITNESS.intermediate).estCss)}</b><span>{p.css100Sec ? 'swim /100m' : 'swim · est'}</span></div>}
            {!solo && <div className="s"><b>{p.ftp || 'RPE'}</b><span>{p.ftp ? 'FTP watts' : 'bike by feel'}</span></div>}
            {solo && T.saneWeightKg(p.weightKg) ? <div className="s"><b>{T.saneWeightKg(p.weightKg)}</b><span>kg</span></div> : null}
          </div>;
        })()}
        <div style={{ height: 12 }} />
        {tracker
          ? <>
            <button className="btn primary" onClick={onEditPlan}><Icon name="calendar" size={18} /> Start a plan</button>
            <div style={{ height: 10 }} />
            {/* Tracker-safe: records a between-plans benchmark (a parkrun is a
                5k test) into fitness history without generating a plan. */}
            <button className="btn ghost" onClick={onEditFitness}><Icon name="trend" size={18} /> Update fitness</button>
            {/* Gate on the profile's own fitness-update stamp, NOT plan.updatedAt:
                merely entering tracker moves updatedAt, and this note must never
                claim an update that did not happen. */}
            {p.fitnessUpdatedAt && (() => {
              const prev = (p.fitnessHistory || []).slice(-1)[0];
              const delta = prev && prev.fivekSec && p.fivekSec
                ? ' · 5k ' + T.fmtPace(prev.fivekSec) + ' → ' + T.fmtPace(p.fivekSec) : '';
              return <p className="lead" style={{ margin: '10px 2px 0' }}>Fitness updated {T.fmtDate(T.iso(p.fitnessUpdatedAt.slice(0, 10)), { month: 'short', day: 'numeric' })}{delta}</p>;
            })()}
          </>
          : <>
            <button className="btn primary" onClick={onEditFitness}><Icon name="trend" size={18} /> Update fitness &amp; re-target</button>
            {plan.updatedAt && (() => {
              const prev = (p.fitnessHistory || []).slice(-1)[0];
              const delta = prev && prev.fivekSec && p.fivekSec
                ? ' · 5k ' + T.fmtPace(prev.fivekSec) + ' → ' + T.fmtPace(p.fivekSec) : '';
              return <p className="lead" style={{ margin: '10px 2px 0' }}>Paces re-targeted {T.fmtDate(T.iso(plan.updatedAt.slice(0, 10)), { month: 'short', day: 'numeric' })}{delta}</p>;
            })()}
            <div style={{ height: 10 }} />
            <button className="btn ghost" onClick={onEditPlan}><Icon name="calendar" size={18} /> Edit race &amp; schedule</button>
            <div style={{ height: 10 }} />
            <button className="btn ghost" onClick={onEnterTracker}><Icon name="watch" size={18} /> End plan and just track</button>
          </>}
      </div>
      {!tracker && <div className="card">
        <h2 style={{ marginBottom: 10 }}>Sync & export</h2>
        <button className="btn primary" onClick={onExport}><Icon name="download" size={18} /> Export plan to calendar (.ics)</button>
        <p className="lead" style={{ margin: '10px 2px 0' }}>Downloads every session as all-day events with the full workout in the notes — import into Apple Calendar, Google Calendar or Outlook.</p>
      </div>}
      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Connections</h2>
        <IntervalsIcuCard onWellnessSynced={onWellnessSynced} watchSync={watchSync} onWatchSync={onWatchSync} watchPush={watchPush} />
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Support</h2>
        <button className="btn ghost" onClick={onSupportHub}><Icon name="book" size={18} /> The science behind Try</button>
        <div style={{ height: 10 }} />
        <button className="btn ghost" onClick={onExportCalibration}><Icon name="download" size={18} /> Export readiness calibration data</button>
        <p className="lead" style={{ margin: '10px 2px 0' }}>Every completed session quietly records how ready you scored vs how it felt — {calibrationCount || 0} observation{calibrationCount === 1 ? '' : 's'} so far on this device. With enough history the scoring weights can be fitted to you instead of set by policy.</p>
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Account</h2>
        <ApiConnectionCard />
      </div>
      <div className="card">
        <button className="btn ghost" onClick={onRegenerate}>↺ Start over / new plan</button>
        <div style={{ height: 10 }} />
        <button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={onReset}>Clear all progress</button>
      </div>
      {/* Secret: quietly tap this footer 10× to release ze Würm. No label, no hint. */}
      <div className="center muted wurm-trigger" style={{ fontSize: 12 }} onClick={clickWurm}>Try · built with React</div>
    </>
  );
}
