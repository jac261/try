import { useState } from 'react';
import { useAuth, useUser, SignOutButton } from '@clerk/react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { getAuthTest, apiBaseUrl } from '@/lib/api.js';
import { APP_BASE_URL } from '@/config/env.js';

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

export function SettingsView({ plan, onRegenerate, onReset, onExport, onEditFitness, onEditPlan, onReleaseWurm }) {
  const [wc, setWc] = useState(0);
  const clickWurm = () => { const n = wc + 1; if (n >= 10) { setWc(0); onReleaseWurm(); } else setWc(n); };
  const p = plan.profile;
  return (
    <>
      <div className="section-title">Settings</div>
      <div className="card">
        <h2>{p.name}</h2>
        <p className="lead">Training for the {T.RACES[p.raceType].name} on {T.fmtDate(T.iso(p.raceDate), { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        <div className="statline">
          <div className="s"><b>{p.daysPerWeek}</b><span>days/week</span></div>
          <div className="s"><b style={{ textTransform: 'capitalize' }}>{p.fitness}</b><span>level</span></div>
          <div className="s"><b>{plan.totalWeeks}</b><span>weeks</span></div>
        </div>
        <div className="statline">
          <div className="s"><b>{p.fivekSec ? T.fmtPace(p.fivekSec / 5) : '~' + T.fmtPace((T.FITNESS[p.fitness] || T.FITNESS.intermediate).est5k / 5)}</b><span>{p.fivekSec ? '5k pace/km' : '5k pace · est'}</span></div>
          <div className="s"><b>{p.css100Sec ? T.fmtPace(p.css100Sec) : '~' + T.fmtPace((T.FITNESS[p.fitness] || T.FITNESS.intermediate).estCss)}</b><span>{p.css100Sec ? 'swim /100m' : 'swim · est'}</span></div>
          <div className="s"><b>{p.ftp || 'RPE'}</b><span>{p.ftp ? 'FTP watts' : 'bike by feel'}</span></div>
        </div>
        <div style={{ height: 12 }} />
        <button className="btn primary" onClick={onEditFitness}><Icon name="trend" size={18} /> Update fitness &amp; re-target</button>
        {plan.updatedAt && (() => {
          const prev = (p.fitnessHistory || []).slice(-1)[0];
          const delta = prev && prev.fivekSec && p.fivekSec
            ? ' · 5k ' + T.fmtPace(prev.fivekSec) + ' → ' + T.fmtPace(p.fivekSec) : '';
          return <p className="lead" style={{ margin: '10px 2px 0' }}>Paces re-targeted {T.fmtDate(T.iso(plan.updatedAt.slice(0, 10)), { month: 'short', day: 'numeric' })}{delta}</p>;
        })()}
        <div style={{ height: 10 }} />
        <button className="btn ghost" onClick={onEditPlan}><Icon name="calendar" size={18} /> Edit race &amp; schedule</button>
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Sync & export</h2>
        <button className="btn primary" onClick={onExport}><Icon name="download" size={18} /> Export plan to calendar (.ics)</button>
        <p className="lead" style={{ margin: '10px 2px 0' }}>Downloads every session as all-day events with the full workout in the notes — import into Apple Calendar, Google Calendar or Outlook.</p>
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
