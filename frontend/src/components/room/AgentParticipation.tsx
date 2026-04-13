import React, { useState } from 'react';
import { User, Users, Play, Square, RotateCcw, MessageSquare, Send } from 'lucide-react';
import { useNode } from '../../context/NodeContext';
import type { RoomDetail } from '../../types';

interface AgentParticipationProps {
  roomId: string;
  detail: RoomDetail;
  onRefresh: () => void;
}

export const AgentParticipation: React.FC<AgentParticipationProps> = ({ roomId, detail, onRefresh }) => {
  const { joinRoom, controlSession } = useNode();
  const [selectedAgent, setSelectedAgent] = useState(detail.availableAgents[0]?.name || '');
  const [role, setRole] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const room = detail.room;
  const availableAgents = detail.availableAgents;
  const joinedLocalAgent = room.connectedAgents.find(a => availableAgents.some(aa => aa.name === a.name));
  const activeSession = detail.localSessions.find(s => s.agentName === (joinedLocalAgent?.name || selectedAgent));
  const canRestart = Boolean(activeSession?.autonomous);
  const showStop = Boolean(
    activeSession
    && ['starting', 'joined', 'responding', 'idle'].includes(activeSession.status)
  );

  const handleJoin = async () => {
    if (!selectedAgent) return;
    setLoading(true);
    try {
      await joinRoom(roomId, selectedAgent, role);
      onRefresh();
    } catch (err) {
      console.error('Join failed:', err);
      alert(err instanceof Error ? err.message : 'Join failed');
    } finally {
      setLoading(false);
    }
  };

  const handleControl = async (action: 'start' | 'stop' | 'restart') => {
    setLoading(true);
    try {
      const agentName = joinedLocalAgent?.name || selectedAgent;
      const joinedAgentId = joinedLocalAgent?.id;
      
      await controlSession(roomId, agentName, action, action === 'start' ? { joinedAgentId, role } : undefined);
      onRefresh();
    } catch (err) {
      console.error(`${action} failed:`, err);
      alert(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!message.trim()) return;
    setLoading(true);
    try {
      // Ensure joined first if not joined
      let currentJoinedAgent = joinedLocalAgent;
      if (!currentJoinedAgent) {
        const joinData = await joinRoom(roomId, selectedAgent, role);
        currentJoinedAgent = joinData.joinedAgent;
      }

      await fetch(`/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinedAgentId: currentJoinedAgent?.id, text: message.trim() })
      });
      
      setMessage('');
      onRefresh();
    } catch (err) {
      console.error('Send failed:', err);
      alert(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-void-dark/40 border border-line-soft rounded-2xl p-6 backdrop-blur-md">
      <h3 className="text-lg font-bold flex items-center gap-2 mb-4 text-cyan-soft">
        <Users className="w-5 h-5" />
        Agent Participation
      </h3>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest text-muted font-bold active-glow-text">Local Agent</label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              disabled={loading || !!joinedLocalAgent}
              className="w-full bg-void border border-line-soft rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan/50 transition-colors appearance-none"
            >
              {availableAgents.map(a => (
                <option key={a.name} value={a.name}>
                  {a.name} ({a.supportedRoles.join(', ') || 'general'})
                </option>
              ))}
              {availableAgents.length === 0 && <option value="">No agents available</option>}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest text-muted font-bold">Role Slot (Optional)</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. researcher"
              className="w-full bg-void border border-line-soft rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan/50 transition-colors"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          {!joinedLocalAgent ? (
            <button
              onClick={handleJoin}
              disabled={loading || !selectedAgent}
              className="px-4 py-2 bg-cyan text-void rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-cyan-soft transition-all active:scale-95 disabled:opacity-50"
            >
              <User className="w-4 h-4" /> Send My Agent
            </button>
          ) : (
            <div className="px-4 py-2 bg-cyan/10 border border-cyan/20 text-cyan rounded-xl text-sm font-bold flex items-center gap-2">
              <User className="w-4 h-4" /> Joined as {joinedLocalAgent.name}
            </div>
          )}

          <button
            onClick={() => handleControl(canRestart ? 'restart' : 'start')}
            disabled={loading || !selectedAgent || (!joinedLocalAgent && !activeSession)}
            className="px-4 py-2 bg-void border border-emerald-500/30 text-emerald-400 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-emerald-500/10 transition-all active:scale-95 disabled:opacity-50"
          >
            {canRestart ? <RotateCcw className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {canRestart ? 'Restart Session' : 'Start Session'}
          </button>

          {showStop && (
            <button
              onClick={() => handleControl('stop')}
              disabled={loading}
              className="px-4 py-2 bg-void border border-pink-500/30 text-pink-400 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-pink-500/10 transition-all active:scale-95"
            >
              <Square className="w-4 h-4" /> Stop
            </button>
          )}
        </div>

        {activeSession && (
          <div className="text-[11px] font-mono text-muted bg-cyan/5 p-2 rounded-lg border border-cyan/10 flex justify-between items-center">
            <span className="flex items-center gap-1.5 uppercase">
              <span className={`w-1.5 h-1.5 rounded-full ${['responding', 'starting'].includes(activeSession.status) ? 'bg-emerald-500 animate-pulse' : 'bg-muted'}`} />
              Status: <span className="text-cyan-soft">{activeSession.status}</span>
            </span>
            <span>Last activity: {activeSession.lastRespondedAt ? new Date(activeSession.lastRespondedAt).toLocaleTimeString() : '—'}</span>
          </div>
        )}

        <div className="space-y-1.5 pt-4 border-t border-line-soft/30">
          <label className="text-[10px] uppercase tracking-widest text-muted font-bold flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3" /> Post to Room
          </label>
          <div className="relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask the network or give instructions..."
              className="w-full bg-void-dark border border-line-soft rounded-2xl px-4 py-3 text-sm min-h-[100px] outline-none focus:border-cyan/50 transition-colors resize-none pr-12"
            />
            <button
              onClick={handleSendMessage}
              disabled={loading || !message.trim()}
              className="absolute bottom-3 right-3 p-2.5 bg-cyan text-void rounded-xl hover:bg-cyan-soft transition-all active:scale-95 disabled:opacity-30"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
