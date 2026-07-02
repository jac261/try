import { Component } from 'react';
import { clearAll } from '@/app/storage.js';
import { Icon } from '@/components/Icon.jsx';

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null, nonce: 0 }; }
  static getDerivedStateFromError(err) { return { err: err }; }
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
    return (
      <div className="app">
        <div className="topbar"><h1><Icon name="logo" size={26} /> Try</h1></div>
        <div className="card">
          <h2>Something went wrong</h2>
          <p className="lead">Your saved plan couldn't be loaded — this can happen after an update. Starting a new plan clears the old data and fixes it. Your fitness numbers are quick to re-enter.</p>
          <button className="btn primary" onClick={() => this.reset()}>Start a fresh plan</button>
        </div>
      </div>
    );
  }
}
