import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="state m-6" role="alert"><h1>Let’s try that again.</h1><p>A page could not load. Check your connection, then reload.</p><button className="btn" onClick={() => location.reload()}>Reload app</button></main> : this.props.children; }
}
