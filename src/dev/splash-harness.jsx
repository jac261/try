/* Dev harness: reproduce the AuthGate->App splash handoff. Mount splash A,
   after 2s replace it with a keyed NEW splash B (fresh DOM node, like the
   second gate). Before the fix B restarts the tumble; after, it continues. */
import '@/styles.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Splash } from '@/components/Splash.jsx';

function Harness() {
  const [gate, setGate] = useState('auth');
  useEffect(() => {
    const t = setTimeout(() => setGate('app'), 2000);
    return () => clearTimeout(t);
  }, []);
  // key forces a REMOUNT, the same fresh-DOM-node situation as the real handoff
  return <Splash key={gate} />;
}

createRoot(document.getElementById('root')).render(<Harness />);
