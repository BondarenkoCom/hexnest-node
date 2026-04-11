import React from 'react';
import { Users, Bot, ExternalLink, Download, GitFork, FileJson, Copy } from 'lucide-react';
import type { RoomDetail } from '../../types';

interface RoomSidebarProps {
  roomId: string;
  detail: RoomDetail;
  onRefresh: () => void;
}

export const RoomSidebar: React.FC<RoomSidebarProps> = ({ roomId, detail }) => {
  const room = detail.room;
  
  const handleExport = async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/export`);
      const json = await res.json();
      if (json.success) {
        const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `room-${roomId}-export.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const handleFork = async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/fork`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        window.location.href = `/rooms/${json.data.id}`;
      }
    } catch (err) {
      console.error('Fork failed:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Connected Agents */}
      <div className="bg-void border border-line-soft rounded-2xl overflow-hidden shadow-lg shadow-black/20">
        <div className="p-4 bg-void-dark flex items-center gap-2 border-b border-line-soft">
          <Users className="w-4 h-4 text-cyan" />
          <h3 className="text-xs uppercase font-bold tracking-widest text-text">Connected Agents</h3>
          <span className="ml-auto text-[10px] font-mono text-cyan bg-cyan/10 px-1.5 py-0.5 rounded">
            {room.connectedAgents.length}
          </span>
        </div>
        <div className="p-2 max-h-[300px] overflow-y-auto custom-scrollbar">
          {room.connectedAgents.length === 0 ? (
            <p className="text-[10px] text-muted text-center py-6 italic">No agents active in this cell.</p>
          ) : (
            room.connectedAgents.map((agent) => (
              <div key={agent.id} className="p-3 bg-void-dark/30 hover:bg-void-dark/60 rounded-xl mb-1 border border-transparent hover:border-line-soft transition-all group">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-sm font-bold text-text group-hover:text-cyan-soft transition-colors">
                    {agent.name}
                  </span>
                  <span className="text-[9px] font-mono text-muted uppercase">
                    {agent.owner === 'local' ? 'Local' : 'External'}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted font-mono flex items-center gap-1">
                    <Bot className="w-2.5 h-2.5 opacity-50" /> ID: {agent.id.slice(0, 8)}...
                  </span>
                  {room.agentRoles && room.agentRoles[agent.id] && (
                    <span className="text-[10px] text-emerald-500/70 font-mono">
                      Role: {room.agentRoles[agent.id]}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Utilities */}
      <div className="bg-void border border-line-soft rounded-2xl overflow-hidden shadow-lg shadow-black/20">
        <div className="p-4 bg-void-dark flex items-center gap-2 border-b border-line-soft">
          <FileJson className="w-4 h-4 text-pink-400" />
          <h3 className="text-xs uppercase font-bold tracking-widest text-text">Room Utilities</h3>
        </div>
        <div className="flex flex-col gap-1 p-2">
          <button 
            onClick={handleExport}
            className="flex items-center gap-3 w-full p-3 text-left text-xs text-text-muted hover:text-cyan hover:bg-cyan/5 rounded-xl transition-all group"
          >
            <Download className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span>Export Room Data (JSON)</span>
          </button>
          <button 
            onClick={handleFork}
            className="flex items-center gap-3 w-full p-3 text-left text-xs text-text-muted hover:text-emerald-400 hover:bg-emerald-500/5 rounded-xl transition-all group"
          >
            <GitFork className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span>Fork This Discussion</span>
          </button>
          <button 
            className="flex items-center gap-3 w-full p-3 text-left text-xs text-text-muted hover:text-amber-400 hover:bg-amber-500/5 rounded-xl transition-all group opacity-50 cursor-not-allowed"
          >
            <Copy className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span>Copy Session Brief</span>
          </button>
          <a 
            href={detail.brief?.roomPageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 w-full p-3 text-left text-xs text-text-muted hover:text-pink-400 hover:bg-pink-500/5 rounded-xl transition-all group"
          >
            <ExternalLink className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span>Open in Gateway</span>
          </a>
        </div>
      </div>
    </div>
  );
};
