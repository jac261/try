import { Component } from 'react';
import { clearAll } from '@/app/storage.js';
import { Icon } from '@/components/Icon.jsx';

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null, nonce: 0 }; }
  // Falsy thrown values (throw 0 / '' / undefined) must still trip the
  // boundary, or render() would loop the crashed children instead.
  static getDerivedStateFromError(err) { return { err: err || new Error('Unknown error (falsy value thrown)') }; }
  componentDidCatch(err) { try { console.error('Try crashed:', err); } catch (e) {} }
  reset() {
    try { clearAll(); } catch (e) {}
    // Clear the error and bump the key so App remounts and re-reads (now-empty)
    // storage. reload() gives a fully clean slate when available; the remount is
    // the fallback for environments where reload is a no-op.
    this.setState(s => ({ err: null, nonce: s.nonce + 1 }));
    try { location.reload(); } catch (e) {}
  }
  render() {
    if (!this.state.err) return <div key={this.state.nonce} style={{ display: 'contents' }}>{this.props.children}</div>;
    // Everything here renders with NO boundary above it: any throw is a white
    // screen. So the detail is computed defensively (hostile getters, plain
    // objects, strings) and the JSX only ever interpolates a plain string.
    let detail;
    try {
      const e = this.state.err;
      const msg = (e && e.message) || (typeof e === 'object' ? JSON.stringify(e) : String(e));
      const frames = String((e && e.stack) || '').split('\n').slice(1, 4).join('\n');
      detail = String(msg) + (frames ? '\n' + frames : '');
    } catch (x) { detail = 'Error details unavailable'; }
    return (
      <div className="app">
        <div className="topbar"><h1><Icon name="logo" size={26} /> Try</h1></div>
        <div className="card">
          <h2>Something went wrong</h2>
          <p className="lead">The app hit an error while loading. Reloading usually fixes it and keeps everything. Your plan and history are safe on your account either way.</p>
          {/* The real error, so a field crash is diagnosable from a screenshot
              instead of guesswork. Console-only logging proved useless on the
              phone (2026-07-15 incident). */}
          <pre className="crash-detail">{detail}</pre>
          <button className="btn primary" onClick={() => { try { location.reload(); } catch (e) {} }}>Reload</button>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => { let ok = false; try { ok = confirm('Clear this device’s local Try data and start fresh? Your synced plan stays on your account, but on-device calibration would be reset.'); } catch (e) {} if (ok) this.reset(); }}>Clear local data and start fresh</button>
        </div>
      </div>
    );
  }
}
