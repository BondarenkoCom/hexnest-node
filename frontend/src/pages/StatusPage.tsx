import React, { useState } from 'react';
import { useNode } from '../context/NodeContext';

export const StatusPage: React.FC = () => {
  const { status, readiness, addNotification, refresh } = useNode();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const handleReconnect = async () => {
    setIsConnecting(true);
    try {
      const res = await fetch('/api/core/reconnect', { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.success) {
        addNotification(json.message || 'Core reconnected successfully', 'success');
        refresh();
      } else {
        addNotification(json.error || 'Reconnect failed', 'error');
      }
    } catch (err: any) {
      addNotification('Connection error: ' + err.message, 'error');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const res = await fetch('/api/core/test', { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.success) {
        addNotification(json.message || 'Core connection test passed', 'success');
      } else {
        addNotification(json.error || json.message || 'Core test failed', 'error');
      }
    } catch (err: any) {
      addNotification('Test error: ' + err.message, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsConnecting(true);
    try {
      const res = await fetch('/api/core/disconnect', { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.success) {
        addNotification(json.message || 'Node disconnected from Core', 'warn');
        refresh();
      } else {
        addNotification(json.error || 'Disconnect failed', 'error');
      }
    } catch (err: any) {
      addNotification('Connection error: ' + err.message, 'error');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleResetIdentity = async () => {
    if (!window.confirm('Are you sure you want to reset node identity? This will clear local tokens and the next connection will register a new node ID.')) {
      return;
    }
    try {
      const res = await fetch('/api/core/reset-identity', { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.success) {
        addNotification(json.message || 'Node identity reset', 'info');
        refresh();
      } else {
        addNotification(json.error || 'Reset failed', 'error');
      }
    } catch (err: any) {
      addNotification('Reset error: ' + err.message, 'error');
    }
  };

  const formatUptime = (ms: number) => {
    const mins = Math.floor(ms / 1000 / 60);
    const secs = Math.floor((ms / 1000) % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <section className="tab-content active panel prose">
      <h2>Node Overview</h2>
      <div className="stats-bar">
        <div className="stat-box">
          <div className="stat-num">{status?.uptime ? formatUptime(status.uptime) : '—'}</div>
          <div className="stat-label">Online For</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{status?.adaptersCount || 0}</div>
          <div className="stat-label">Agents Ready</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">
            {status?.lastHeartbeatAt ? new Date(status.lastHeartbeatAt).toLocaleTimeString() : '—'}
          </div>
          <div className="stat-label">Last Check-In</div>
        </div>
      </div>

      <h3 className="mt-6 uppercase tracking-wider text-cyan-soft">What Needs Attention</h3>
      <div className="readiness-grid mt-3">
        {readiness?.checks.filter(c => c.state !== 'ready').map((check) => (
          <div key={check.id} className={`readiness-card ${check.state}`}>
            <div className="readiness-row">
              <span className={`state-pill ${check.state}`}>{check.state}</span>
              <p className="readiness-row-label font-bold text-cyan-soft">{check.label}</p>
              <div className="readiness-row-copy">
                <p className="readiness-summary text-text">{check.summary}</p>
                {check.detail && <p className="readiness-detail text-muted text-xs mt-1">{check.detail}</p>}
              </div>
            </div>
          </div>
        )) || (
          <div className="readiness-card ready">
            <div className="readiness-row">
              <span className="state-pill ready">ready</span>
              <p className="readiness-row-label">All Systems Ready</p>
              <div className="readiness-row-copy">
                <p className="readiness-summary">No immediate issues detected.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <h3 className="mt-6 uppercase tracking-wider text-cyan-soft">Node Availability</h3>
      <div className="control-panel mt-4 border border-line-soft rounded-xl p-4 bg-deep-2/50">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="summary-head flex justify-between items-start">
              <div>
                <p className="feature-head text-xs font-mono uppercase tracking-widest text-cyan-soft">Availability Snapshot</p>
                <p className="summary-title text-xl text-text mt-1 font-bold">{readiness?.summary || 'Checking readiness...'}</p>
                <p className="summary-copy text-sm text-muted mt-2">{readiness?.recommendedAction}</p>
              </div>
              <span className={`state-pill ${readiness?.state || 'info'}`}>
                {readiness?.state || 'Checking'}
              </span>
            </div>
            
            <div className="summary-facts flex flex-wrap gap-2 mt-4">
              <span className="chip">Mode: {readiness?.mode || '—'}</span>
              <span className="chip">Identity: {status?.id ? 'Registered' : 'Missing'}</span>
              <span className="chip">Default agent: {readiness?.activeModelName || 'Not set'}</span>
              <span className="chip">Providers: {readiness?.configuredProvidersCount || 0}</span>
            </div>

            <div className="mt-4">
              <p className="text-xs text-muted uppercase tracking-wider mb-2">Node Identity</p>
              <p className="text-sm font-mono text-cyan-soft truncate">{status?.id || '—'}</p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Account</p>
              <p className="text-sm font-mono text-cyan-soft">{status?.operatorEmail || '—'}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button 
                onClick={handleReconnect}
                disabled={isConnecting}
                className="px-3 py-2 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg text-sm hover:bg-green-500/20 transition-colors disabled:opacity-50"
              >
                {isConnecting && !status?.coreConnected ? 'Connecting...' : 'Reconnect Node'}
              </button>
              <button 
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-3 py-2 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-lg text-sm hover:bg-blue-500/20 transition-colors disabled:opacity-50"
              >
                {isTesting ? 'Testing...' : 'Test Connection'}
              </button>
              <button 
                onClick={handleDisconnect}
                disabled={isConnecting || !status?.coreConnected}
                className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded-lg text-sm hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
              >
                Disconnect Node
              </button>
              <button 
                onClick={handleResetIdentity}
                className="px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm hover:bg-red-500/20 transition-colors"
              >
                Reset Identity
              </button>
            </div>
          </div>
        </div>
      </div>

      <h3 className="mt-8 uppercase tracking-wider text-cyan-soft">Recent Activity</h3>
      <div className="feature-card mt-3">
        <div className="mini-list flex flex-col gap-2">
          {readiness?.recentActivity && readiness.recentActivity.length > 0 ? (
            readiness.recentActivity.map((item, idx) => (
              <div key={idx} className="mini-item p-3 bg-void/50 rounded-lg border-l-2 border-cyan">
                <div className="mini-item-header flex justify-between items-center mb-1">
                  <p className="mini-item-title font-bold text-sm">{item.message}</p>
                  <span className="mini-item-time text-xs text-muted">{new Date(item.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="mini-item-copy text-xs text-muted">{new Date(item.timestamp).toLocaleString()}</p>
              </div>
            ))
          ) : (
            <div className="p-4 text-center text-muted text-sm border border-dashed border-muted/20 rounded-lg">
              No recent activity logs.
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
