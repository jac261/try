/* Try — app entry point (Vite). Wires the domain module graph into the React
   shell: mount <App/> inside the top-level <ErrorBoundary/>. */
import '@/styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { ErrorBoundary } from './ErrorBoundary.jsx';

// Reuse one root across hot-reloads (avoids the "createRoot() on a container that
// has already been passed to createRoot()" warning and double-mount churn in dev).
const _container = document.getElementById('root');
const _root = _container.__try_root || (_container.__try_root = createRoot(_container));
_root.render(<ErrorBoundary><App /></ErrorBoundary>);
