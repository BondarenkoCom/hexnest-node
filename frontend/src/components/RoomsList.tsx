import React, { useState, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { Users } from 'lucide-react';
import type { RoomSummary, ApiResponse } from '../types';

export const RoomsList: React.FC = () => {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [loading, setLoading] = useState(true);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms');
      const json: ApiResponse<{ rooms: RoomSummary[] }> = await res.json();
      if (json.success) {
        setRooms(json.data?.rooms || []);
      }
    } catch (error) {
      console.error('Error fetching rooms:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 15000);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  const filteredRooms = filter === 'mine' 
    ? rooms.filter(r => r.subnest === 'mine') // Placeholder logic, backend might define "mine" differently
    : rooms;

  return (
    <div className="nav-rooms">
      <p className="sidebar-label">Recent Rooms</p>
      <div className="section-tabs flex gap-2 mb-2 p-1 bg-void/50 rounded-lg">
        <button 
          onClick={() => setFilter('all')}
          className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded-md flex-1 transition-all ${filter === 'all' ? 'bg-cyan/20 text-cyan-soft border border-cyan/40 shadow-[0_0_8px_rgba(74,217,255,0.2)]' : 'text-muted hover:text-text'}`}
        >
          All
        </button>
        <button 
          onClick={() => setFilter('mine')}
          className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded-md flex-1 transition-all ${filter === 'mine' ? 'bg-cyan/20 text-cyan-soft border border-cyan/40 shadow-[0_0_8px_rgba(74,217,255,0.2)]' : 'text-muted hover:text-text'}`}
        >
          Mine
        </button>
      </div>
      
      <div className="room-list flex flex-col gap-2 max-h-[40vh] overflow-y-auto pr-1">
        {loading && rooms.length === 0 ? (
          <div className="room-empty text-xs text-muted">Syncing rooms...</div>
        ) : filteredRooms.length > 0 ? (
          filteredRooms.map((room) => (
            <NavLink
              key={room.id}
              to={`/rooms/${room.id}`}
              className={({ isActive }) => `room-item block p-3 rounded-xl border border-line-soft transition-all hover:bg-deep-2/20 ${isActive ? 'active border-pink-500/30 bg-pink-500/5 shadow-[0_0_10px_rgba(255,46,157,0.1)]' : 'bg-void/70'}`}
            >
              <div className="room-head flex justify-between items-start">
                <span className="room-id font-mono text-[10px] text-cyan-soft truncate max-w-[120px]">{room.id}</span>
                <span className="room-phase text-[10px] text-muted flex items-center gap-1">
                  <Users className="w-2.5 h-2.5" /> {room.viewers}
                </span>
              </div>
              <p className="text-sm font-bold text-text truncate mt-1">{room.name || room.task}</p>
              {room.latestMessageText && (
                <p className="text-[10px] text-muted truncate mt-1 italic">
                  {room.latestMessageFrom && <b className="not-italic text-cyan-soft/80">{room.latestMessageFrom}: </b>}
                  {room.latestMessageText}
                </p>
              )}
            </NavLink>
          ))
        ) : (
          <div className="room-empty text-xs text-muted">No rooms found.</div>
        )}
      </div>
    </div>
  );
};
