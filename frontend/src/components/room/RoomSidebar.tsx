import React, { useCallback, useEffect, useState } from 'react';
import { Users, Bot, ExternalLink, Download, GitFork, FileJson, Copy } from 'lucide-react';
import type { ApiResponse, RoomDetail, RoomWebhookInfo, RoomWebhookSigningKeyPayload } from '../../types';

interface RoomSidebarProps {
  roomId: string;
  detail: RoomDetail;
  initialRoomWebhook?: RoomWebhookInfo;
  focusWebhook?: boolean;
  onRefresh: () => void;
}

export const RoomSidebar: React.FC<RoomSidebarProps> = ({
  roomId,
  detail,
  initialRoomWebhook,
  focusWebhook = false,
  onRefresh
}) => {
  const room = detail.room;
  const [roomWebhookInfo, setRoomWebhookInfo] = useState<RoomWebhookInfo | null>(initialRoomWebhook || null);
  const [roomWebhookAccess, setRoomWebhookAccess] = useState<'granted' | 'forbidden' | 'missing' | 'unknown'>(
    initialRoomWebhook ? 'granted' : 'unknown'
  );
  const [roomWebhookLoading, setRoomWebhookLoading] = useState(false);
  const [roomWebhookRegenerating, setRoomWebhookRegenerating] = useState(false);
  const [roomWebhookError, setRoomWebhookError] = useState<string | null>(null);
  const [showSigningKey, setShowSigningKey] = useState(Boolean(initialRoomWebhook?.signingKey));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!room.settings?.webhookUrl) {
      setRoomWebhookInfo(null);
      setRoomWebhookAccess('unknown');
      setRoomWebhookError(null);
      setShowSigningKey(false);
      setRoomWebhookLoading(false);
      setRoomWebhookRegenerating(false);
      return;
    }
    setRoomWebhookInfo(initialRoomWebhook || null);
    setRoomWebhookAccess(initialRoomWebhook ? 'granted' : 'unknown');
    setRoomWebhookError(null);
    setShowSigningKey(Boolean(initialRoomWebhook?.signingKey));
  }, [roomId, room.settings?.webhookUrl, initialRoomWebhook?.endpointId, initialRoomWebhook?.signingKey]);

  const loadSigningKey = useCallback(async (): Promise<RoomWebhookInfo | null> => {
    if (!room.settings?.webhookUrl) {
      setRoomWebhookInfo(null);
      setRoomWebhookError(null);
      return null;
    }
    setRoomWebhookLoading(true);
    setRoomWebhookError(null);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/webhook-signing-key`);
      const json: ApiResponse<RoomWebhookSigningKeyPayload> = await res.json();
      if (json.success && json.data?.access === 'granted' && json.data.roomWebhook) {
        setRoomWebhookInfo(json.data.roomWebhook);
        setRoomWebhookAccess('granted');
        return json.data.roomWebhook;
      }
      setRoomWebhookInfo(null);
      setShowSigningKey(false);
      setRoomWebhookAccess(json.data?.access || 'unknown');
      setRoomWebhookError(json.data?.message || json.error || 'Signing key is unavailable for this account.');
      return null;
    } catch {
      setRoomWebhookInfo(null);
      setShowSigningKey(false);
      setRoomWebhookAccess('unknown');
      setRoomWebhookError('Failed to load room webhook signing key.');
      return null;
    } finally {
      setRoomWebhookLoading(false);
    }
  }, [roomId, room.settings?.webhookUrl]);

  const handleShowSigningKey = async () => {
    if (roomWebhookInfo?.signingKey) {
      setShowSigningKey((prev) => !prev);
      return;
    }
    const loaded = await loadSigningKey();
    if (loaded?.signingKey) {
      setShowSigningKey(true);
    }
  };

  const handleRegenerateSigningKey = async () => {
    const currentSigningKey = roomWebhookInfo?.signingKey || '';
    if (!currentSigningKey) {
      setRoomWebhookError('Load signing key first, then regenerate.');
      return;
    }
    setRoomWebhookRegenerating(true);
    setRoomWebhookError(null);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/webhook-signing-key/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSigningKey })
      });
      const json: ApiResponse<RoomWebhookSigningKeyPayload> = await res.json();
      if (json.success && json.data?.access === 'granted' && json.data.roomWebhook) {
        setRoomWebhookInfo(json.data.roomWebhook);
        setRoomWebhookAccess('granted');
        setShowSigningKey(true);
        return;
      }
      setRoomWebhookAccess(json.data?.access || 'unknown');
      setRoomWebhookError(json.data?.message || json.error || 'Failed to regenerate signing key.');
    } catch {
      setRoomWebhookAccess('unknown');
      setRoomWebhookError('Failed to regenerate room webhook signing key.');
    } finally {
      setRoomWebhookRegenerating(false);
    }
  };

  const copySigningKey = async () => {
    if (!roomWebhookInfo?.signingKey) return;
    try {
      await navigator.clipboard.writeText(roomWebhookInfo.signingKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  
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

      {/* Room Webhook */}
      <div
        className={`bg-void border rounded-2xl overflow-hidden shadow-lg shadow-black/20 ${
          focusWebhook ? 'border-cyan/60 shadow-cyan/20' : 'border-line-soft'
        }`}
      >
        <div className="p-4 bg-void-dark flex items-center gap-2 border-b border-line-soft">
          <FileJson className="w-4 h-4 text-cyan" />
          <h3 className="text-xs uppercase font-bold tracking-widest text-text">Room Webhook</h3>
          <span className="ml-auto text-[9px] font-mono text-cyan bg-cyan/10 px-1.5 py-0.5 rounded">
            room.message_posted
          </span>
        </div>
        <div className="p-3 space-y-3">
          {!room.settings?.webhookUrl ? (
            <p className="text-[10px] text-muted">
              Not configured for this room.
            </p>
          ) : (
            <>
              <p className="text-[10px] text-muted break-all">URL: {room.settings?.webhookUrl}</p>
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted">signing_key</p>
                <div className="grid grid-cols-1 gap-2">
                  <input
                    type={showSigningKey ? 'text' : 'password'}
                    readOnly
                    value={roomWebhookInfo?.signingKey || '••••••••••••••••'}
                    className="w-full bg-void border border-line-soft rounded-lg px-3 py-2 text-[10px] text-text font-mono"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => void handleShowSigningKey()}
                      disabled={roomWebhookLoading || roomWebhookRegenerating}
                      className="p-2 text-[10px] font-bold uppercase tracking-widest text-cyan border border-cyan/40 rounded-lg hover:bg-cyan/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {roomWebhookLoading ? 'Loading...' : roomWebhookInfo ? (showSigningKey ? 'Hide' : 'Show') : 'Show'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copySigningKey()}
                      disabled={!roomWebhookInfo?.signingKey}
                      className="p-2 text-[10px] font-bold uppercase tracking-widest text-cyan border border-cyan/40 rounded-lg hover:bg-cyan/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRegenerateSigningKey()}
                      disabled={!roomWebhookInfo?.signingKey || roomWebhookRegenerating || roomWebhookLoading}
                      className="p-2 text-[10px] font-bold uppercase tracking-widest text-amber-300 border border-amber-300/40 rounded-lg hover:bg-amber-300/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {roomWebhookRegenerating ? 'Regenerating...' : 'Regenerate'}
                    </button>
                  </div>
                </div>
              </div>
              {roomWebhookError ? (
                <p className="text-[10px] text-muted">{roomWebhookError}</p>
              ) : null}
              {roomWebhookAccess === 'forbidden' ? (
                <p className="text-[10px] text-amber-300/90">
                  Access denied in core: only room owner or admin can view/regenerate this signing key.
                </p>
              ) : null}
            </>
          )}
          <p className="text-[10px] text-muted">
            Signing key is visible only to room owner/admin in core.
          </p>
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
            onClick={onRefresh}
            className="flex items-center gap-3 w-full p-3 text-left text-xs text-text-muted hover:text-cyan hover:bg-cyan/5 rounded-xl transition-all group"
          >
            <FileJson className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span>Refresh Room State</span>
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
