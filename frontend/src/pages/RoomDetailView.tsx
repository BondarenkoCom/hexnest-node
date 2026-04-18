import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { RefreshCw, LayoutDashboard } from 'lucide-react';
import { useNode } from '../context/NodeContext';
import { RoomHero } from '../components/room/RoomHero';
import { AgentParticipation } from '../components/room/AgentParticipation';
import { RoomTimeline } from '../components/room/RoomTimeline';
import { RoomSidebar } from '../components/room/RoomSidebar';
import { RoomArtifacts } from '../components/room/RoomArtifacts';
import type { ApiResponse, RoomDetail, RoomWebhookInfo } from '../types';

interface RoomDetailLocationState {
  initialRoomWebhook?: RoomWebhookInfo;
}

export const RoomDetailView: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const location = useLocation();
  const locationState = (location.state || {}) as RoomDetailLocationState;
  const { sessionId } = useNode();
  const openDrawer = new URLSearchParams(location.search).get('open') || '';
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async (silent = false) => {
    if (!roomId) return;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}`);
      const json: ApiResponse<RoomDetail> = await res.json();
      if (json.success) {
        setDetail(json.data || null);
        setError(null);
      } else {
        setError(json.error || 'Failed to load room details');
      }
    } catch (err) {
      console.error('Error fetching room detail:', err);
      setError('Network error while connecting to room');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [roomId]);

  const sendHeartbeat = useCallback(async () => {
    if (!roomId || !sessionId) return;
    try {
      await fetch(`/api/rooms/${roomId}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
    } catch (err) {
      // Slient fail for heartbeat
    }
  }, [roomId, sessionId]);

  useEffect(() => {
    fetchDetail();
    sendHeartbeat();
    
    const pollInterval = setInterval(() => fetchDetail(true), 10000);
    const heartbeatInterval = setInterval(sendHeartbeat, 30000);
    
    return () => {
      clearInterval(pollInterval);
      clearInterval(heartbeatInterval);
    };
  }, [fetchDetail, sendHeartbeat]);

  if (loading && !detail) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-cyan">
        <RefreshCw className="w-10 h-10 animate-spin mb-4" />
        <span className="font-mono tracking-widest uppercase animate-pulse">Establishing Secure Connection...</span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-20 text-center">
        <div className="bg-pink-500/10 border border-pink-500/20 text-pink-400 p-6 rounded-2xl max-w-md mx-auto">
          <h2 className="text-xl font-bold mb-2 uppercase tracking-tight">Signal Interrupted</h2>
          <p className="text-sm font-mono opacity-80">{error || 'Room identifier not found in HexNest gateway.'}</p>
          <button 
            onClick={() => fetchDetail()}
            className="mt-6 px-6 py-2 bg-pink-500 text-void rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-pink-400 transition-all"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-700">
      {/* Hero Header */}
      <RoomHero detail={detail} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Main Column - Timeline & Participation */}
        <div className="xl:col-span-8 space-y-6">
          {/* Agent Control Panel */}
          <AgentParticipation 
            roomId={roomId!} 
            detail={detail} 
            onRefresh={() => fetchDetail(true)} 
          />

          {/* Timeline Section */}
          <div className="bg-void/40 border border-line-soft rounded-2xl overflow-hidden backdrop-blur-sm">
            <div className="p-4 bg-void-dark flex items-center gap-2 border-b border-line-soft">
              <LayoutDashboard className="w-4 h-4 text-cyan" />
              <h3 className="text-xs uppercase font-bold tracking-widest text-text">Live Timeline</h3>
              <span className="ml-auto text-[9px] font-mono text-muted uppercase">Real-time Feed</span>
            </div>
            <div className="p-4 max-h-[800px] overflow-y-auto custom-scrollbar">
              <RoomTimeline events={detail.room.timeline || []} />
            </div>
          </div>
        </div>

        {/* Sidebar Column - Assets & Connected Agents */}
        <div className="xl:col-span-4 space-y-6">
          <RoomSidebar 
            roomId={roomId!} 
            detail={detail} 
            focusWebhook={openDrawer === 'webhook'}
            initialRoomWebhook={locationState.initialRoomWebhook}
            onRefresh={() => fetchDetail(true)} 
          />
          
          <RoomArtifacts 
            artifacts={detail.room.artifacts || []} 
            pythonJobs={detail.room.pythonJobs || []} 
          />
        </div>
      </div>
    </div>
  );
};
