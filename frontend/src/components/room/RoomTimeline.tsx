import React from 'react';
import { Clock, Bot, ShieldAlert, Cpu } from 'lucide-react';
import type { RoomTimelineEvent } from '../../types';

interface RoomTimelineProps {
  events: RoomTimelineEvent[];
}

export const RoomTimeline: React.FC<RoomTimelineProps> = ({ events }) => {
  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString();
    } catch {
      return ts;
    }
  };

  const isSystem = (event: RoomTimelineEvent) => {
    return event.envelope.message_type === 'system' || event.envelope.from_agent === 'system';
  };

  const sortedEvents = [...events]
    .filter(event => !isSystem(event))
    .sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );


  return (
    <div className="flex flex-col gap-4">
      {sortedEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 opacity-30 italic">
          <Clock className="w-10 h-10 mb-2" />
          <p className="text-sm font-mono tracking-wider">No events recorded in this timeline yet.</p>
        </div>
      ) : (
        sortedEvents.map((event) => {
          const system = isSystem(event);
          const author = event.envelope.from_agent || 'Unknown';
          const to = event.envelope.to_agent;
          const text = event.envelope.explanation || '';
          const phase = event.phase || 'open_room';
          
          return (
            <div 
              key={event.id} 
              className={`group flex flex-col gap-2 p-4 rounded-2xl border transition-all ${
                system 
                  ? 'bg-void border-line-soft opacity-70' 
                  : 'bg-void-dark border-line-soft hover:border-cyan/30 shadow-lg shadow-black/20'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${system ? 'bg-muted/10' : 'bg-cyan/10'}`}>
                    {system ? <Cpu className="w-3.5 h-3.5 text-muted" /> : <Bot className="w-3.5 h-3.5 text-cyan" />}
                  </div>
                  <div>
                    <span className={`text-xs font-bold uppercase tracking-wider ${system ? 'text-muted' : 'text-cyan-soft'}`}>
                      {author}
                      {to && <span className="text-muted lowercase font-normal mx-1 font-mono">→ {to}</span>}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-muted/60 uppercase">{phase}</span>
                      {event.envelope.confidence !== undefined && (
                        <span className="text-[10px] font-mono text-emerald-500/60 uppercase">
                          Confidence: {(event.envelope.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted/40 uppercase group-hover:text-muted/60">
                    {formatTime(event.timestamp)}
                  </span>
                </div>
              </div>

              <div className="pl-9 pr-2">
                <p className={`text-sm leading-relaxed whitespace-pre-wrap font-sans text-text-muted ${system ? 'italic' : ''}`}>
                  {text}
                </p>

                {event.envelope.artifacts && event.envelope.artifacts.length > 0 && (
                  <div className="mt-3 py-2 border-t border-line-soft/30 flex flex-wrap gap-2">
                    {event.envelope.artifacts.map((art, idx) => (
                      <span key={idx} className="text-[10px] font-mono py-0.5 px-2 bg-pink-500/10 border border-pink-500/20 text-pink-400 rounded-md">
                        ARTIFACT: {art}
                      </span>
                    ))}
                  </div>
                )}

                {event.envelope.need_human && (
                  <div className="mt-3 flex items-center gap-2 text-pink-400 font-bold text-[10px] uppercase tracking-widest bg-pink-500/5 p-2 rounded-lg border border-pink-500/10">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Human intervention requested
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
