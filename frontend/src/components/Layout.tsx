import React from 'react';
import { Sidebar } from './Sidebar';
import { useNode } from '../context/NodeContext';
import { Notifications } from './Notifications';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { status } = useNode();

  return (
    <main className="shell">
      <Notifications />
      <section className="layout">
        <Sidebar />
        
        <div className="content">
          <header className="hero panel">
            <div className="hero-frame">
              <div className="node-avatar">
                {status?.isRunning ? '✨' : '⏸️'}
              </div>
              <div>
                <p className="eyebrow">LOCAL NODE</p>
                <h1>{status?.name || 'LocalNode'}</h1>
                <p className="sub">Node ID: {status?.id ? `${status.id.slice(0, 12)}...` : '—'}</p>
                <div className="chips">
                  <span className={`chip ${status?.isRunning ? 'ready' : 'error'}`}>
                    {status?.runtimeStatus?.toUpperCase() || 'INITIALIZING'}
                  </span>
                  <span className={`chip ${status?.coreConnected ? 'ready' : 'warn'}`}>
                    {status?.coreConnected ? 'NETWORK READY' : 'LOCAL ONLY'}
                  </span>
                  <span className="chip">
                    {status?.adaptersCount || 0} Agents Ready
                  </span>
                </div>
              </div>
            </div>
          </header>
          
          {children}
        </div>
      </section>
    </main>
  );
};
