import { Layers, Users, Activity, Globe, Zap, Code } from 'lucide-react';
import type { RoomDetail } from '../../types';

interface RoomHeroProps {
  detail: RoomDetail;
}

export const RoomHero: React.FC<RoomHeroProps> = ({ detail }) => {
  const room = detail.room;
  
  return (
    <div className="bg-void border border-line-soft rounded-2xl p-6 mb-6 shadow-xl relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-cyan/5 blur-[100px] -mr-32 -mt-32 rounded-full" />
      
      <div className="relative z-10">
        <div className="flex flex-col lg:flex-row justify-between items-start gap-6">
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-cyan/10 rounded-xl border border-cyan/20">
                <Layers className="w-6 h-6 text-cyan" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-text active-glow-text">
                {room.name || room.task || 'Untitled Room'}
              </h2>
            </div>
            <p className="text-sm text-text-muted leading-relaxed max-w-3xl">
              {room.task}
            </p>
            
            <div className="flex flex-wrap gap-2 pt-2">
              <span className="chip bg-void border-line-soft text-[10px] uppercase tracking-widest px-3 py-1 flex items-center gap-1.5">
                <Globe className="w-3 h-3 text-cyan-soft" /> Subnest: {room.subnest}
              </span>
              <span className="chip bg-void border-line-soft text-[10px] uppercase tracking-widest px-3 py-1 flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-emerald-500" /> Phase: {room.phase || 'open_room'}
              </span>
              <span className={`chip border-line-soft text-[10px] uppercase tracking-widest px-3 py-1 flex items-center gap-1.5 ${room.status === 'open' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-void text-muted'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${room.status === 'open' ? 'bg-emerald-500 animate-pulse' : 'bg-muted'}`} />
                Status: {room.status}
              </span>
              <span className="chip bg-void border-line-soft text-[10px] uppercase tracking-widest px-3 py-1 flex items-center gap-1.5">
                <Users className="w-3 h-3 text-amber-500" /> Viewers: {room.viewers}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 p-4 bg-void-dark/60 rounded-xl border border-line-soft/50 min-w-[200px]">
            <h4 className="text-[10px] uppercase font-bold tracking-widest text-muted mb-1 flex items-center gap-1.5">
              <Zap className="w-3 h-3" /> Room Engine
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-mono text-text-muted flex items-center gap-1.5">
                  <Code className="w-3 h-3" /> Python Runtime
                </span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${room.settings.pythonShellEnabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-void text-muted opacity-40'}`}>
                  {room.settings.pythonShellEnabled ? 'ACTIVE' : 'OFF'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-mono text-text-muted flex items-center gap-1.5">
                  <Globe className="w-3 h-3" /> Web Search
                </span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${room.settings.webSearchEnabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-void text-muted opacity-40'}`}>
                  {room.settings.webSearchEnabled ? 'ACTIVE' : 'OFF'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-mono text-text-muted flex items-center gap-1.5">
                  <Activity className="w-3 h-3" /> Market Feed
                </span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${room.settings.marketDataEnabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-void text-muted opacity-40'}`}>
                  {room.settings.marketDataEnabled ? 'ACTIVE' : 'OFF'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
