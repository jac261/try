/* Dev harness for the splash, two scenes:
   1. The startup handoff: splash A swaps to a keyed splash B after 2s (the
      fresh-DOM-node situation of AuthGate->App). B must CONTINUE the tumble.
   2. Plan work: after 1.5s of "app", a messages splash appears. It must
      START a fresh tumble (new episode) and cycle its one-liners. */
import '@/styles.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Splash, PLAN_WORK_MESSAGES } from '@/components/Splash.jsx';

function Harness() {
  const [scene, setScene] = useState('idle');
  const [run, setRun] = useState(0);
  // window.__restart() so the sequence can be replayed on demand; automation
  // roundtrips to a hidden pane are slower than the whole sequence.
  useEffect(() => {
    window.__restart = () => { setRun(r => r + 1); setScene('auth'); };
    // pin one scene, no timers: hidden-pane roundtrips outrun the sequence
    window.__show = scene => { setRun(0); setScene(scene); };
  }, []);
  useEffect(() => {
    if (!run) return undefined;
    const steps = [['app-splash', 2000], ['app', 4600], ['plan-work', 6100], ['done', 8900]];
    const timers = steps.map(([s, at]) => setTimeout(() => setScene(s), at));
    return () => timers.forEach(clearTimeout);
  }, [run]);
  if (scene === 'idle') return <div data-scene="idle">press __restart()</div>;
  if (scene === 'auth' || scene === 'app-splash') return <Splash key={scene} />;
  if (scene === 'plan-work') return <Splash messages={PLAN_WORK_MESSAGES} />;
  return <div style={{ padding: 40, fontSize: 14 }} data-scene={scene}>the app ({scene})</div>;
}

createRoot(document.getElementById('root')).render(<Harness />);
