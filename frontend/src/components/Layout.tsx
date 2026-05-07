import React, { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { useNode } from '../context/NodeContext';
import { Notifications } from './Notifications';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { status } = useNode();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const storedTheme = localStorage.getItem('hxn-theme-preference');
    if (storedTheme === 'light' || storedTheme === 'dark') {
      return storedTheme;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('hxn-theme-preference', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  };

  return (
    <main className="shell">
      <Notifications />
      <section className="layout">
        <Sidebar theme={theme} onThemeToggle={toggleTheme} />
        
        <div className="content">
          <header className="hero panel">
            <div className="hero-frame">
              <div className={`node-pulse-hex ${status?.isRunning ? 'online' : 'offline'}`}>
                <div className="pulse-ring" />
                <div className="pulse-ring ring-2" />
                <svg className="hex-icon" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                  <polygon points="50,3 93,25 93,75 50,97 7,75 7,25" />
                  <polygon className="hex-inner" points="50,18 78,33 78,67 50,82 22,67 22,33" />
                  <circle className="hex-core" cx="50" cy="50" r="8" />
                </svg>
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
