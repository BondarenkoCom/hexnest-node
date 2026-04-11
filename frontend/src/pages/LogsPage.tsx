import React from 'react';
import { useNode } from '../context/NodeContext';
import { Terminal, Clock, MessageSquare, Shield, Power, User } from 'lucide-react';

export const LogsPage: React.FC = () => {
  const { readiness } = useNode();

  const getIcon = (type: string) => {
    switch (type) {
      case 'connect': return <Power className="w-4 h-4 text-green-400" />;
      case 'disconnect': return <Power className="w-4 h-4 text-red-500" />;
      case 'room': return <MessageSquare className="w-4 h-4 text-cyan" />;
      case 'identity': return <Shield className="w-4 h-4 text-warn" />;
      case 'auth': return <User className="w-4 h-4 text-blue-400" />;
      default: return <Terminal className="w-4 h-4 text-muted" />;
    }
  };

  return (
    <section className="tab-content active panel prose">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="mb-0">Activity Logs</h2>
          <p className="sub text-muted">Recent events and node transitions.</p>
        </div>
        <div className="text-[10px] uppercase tracking-widest text-muted font-mono">
          Updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {readiness?.recentActivity && readiness.recentActivity.length > 0 ? (
          readiness.recentActivity.map((log) => (
            <div key={log.id} className="mini-item flex gap-4 p-4 bg-void/50 rounded-xl border border-line-soft hover:border-cyan/30 transition-colors group">
              <div className="flex-shrink-0 mt-1">
                {getIcon(log.type)}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start mb-1">
                  <p className="text-sm text-text font-medium leading-tight group-hover:text-cyan-soft transition-colors">{log.message}</p>
                  <span className="text-[10px] font-mono text-muted flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-[10px] text-muted uppercase tracking-tighter">
                  {new Date(log.timestamp).toLocaleDateString()} · {log.type} event
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="p-12 text-center border border-dashed border-line-soft rounded-2xl">
            <Terminal className="w-8 h-8 text-muted mx-auto mb-3 opacity-20" />
            <p className="text-sm text-muted italic">No activity logs recorded yet.</p>
          </div>
        )}
      </div>

      <div className="mt-8 p-4 bg-deep-2/10 border border-line-soft/50 rounded-xl">
        <h4 className="text-xs uppercase tracking-widest text-cyan-soft mb-2">Debugging Tip</h4>
        <p className="text-xs text-muted leading-relaxed">
          The local activity log stores the last 50 events. For more detailed system output, check the terminal or the tauri logs dir.
        </p>
      </div>
    </section>
  );
};
