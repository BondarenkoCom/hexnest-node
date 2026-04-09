import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNode } from '../context/NodeContext';
import { PlusCircle, Info } from 'lucide-react';
import type { ApiResponse } from '../types';

export const NewRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const { readiness, refresh } = useNode();
  const [name, setName] = useState('');
  const [task, setTask] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), task: task.trim() })
      });

      const json: ApiResponse<{ roomId: string }> = await res.json();
      if (json.success && json.data?.roomId) {
        await refresh();
        navigate(`/rooms/${json.data.roomId}`);
      } else {
        setError(json.error || 'Failed to create room');
      }
    } catch (err) {
      setError('Network error occurred');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="tab-content active panel prose">
      <h2>New Room</h2>
      <p className="sub text-muted">Open a fresh room for a new task. Your node's default agent will be invited automatically.</p>

      <div className="feature-card mt-6 border border-line-soft bg-deep-2/20 rounded-xl p-6">
        <div className="summary-head flex items-center gap-3 mb-6">
          <div className="p-2 bg-cyan/10 rounded-lg">
            <PlusCircle className="w-6 h-6 text-cyan" />
          </div>
          <div>
            <p className="feature-head text-xs font-mono uppercase tracking-widest text-cyan-soft mb-0">Create Room</p>
            <p className="summary-copy text-sm text-muted">Start a room for your own task, then optionally send your local agent there immediately.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="form-group flex flex-col gap-1.5">
            <label htmlFor="roomNameInput" className="text-xs uppercase tracking-wider text-cyan-soft font-bold">Room Name</label>
            <input 
              type="text" 
              id="roomNameInput" 
              className="w-full bg-void border border-line-soft rounded-lg px-4 py-2.5 text-text focus:border-cyan outline-none transition-all"
              placeholder="Example: Market scan"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-group flex flex-col gap-1.5">
            <label htmlFor="roomTaskInput" className="text-xs uppercase tracking-wider text-cyan-soft font-bold">Task Description</label>
            <textarea 
              id="roomTaskInput" 
              className="w-full bg-void border border-line-soft rounded-lg px-4 py-2.5 text-text focus:border-cyan outline-none transition-all min-h-[120px]"
              placeholder="What should the agents do in this room?"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg">
              {error}
            </div>
          )}

          {!readiness?.activeModelName && (
            <div className="p-3 bg-warn/10 border border-warn/30 text-warn text-xs rounded-lg flex gap-2 items-start">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>No active model configured. You can still create the room, but no local agents will join automatically.</p>
            </div>
          )}

          <div className="actions mt-4">
            <button 
              type="submit" 
              disabled={loading}
              className={`w-full py-3 bg-text text-void font-bold rounded-lg transition-all ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-cyan active:scale-95'}`}
            >
              {loading ? 'Creating...' : 'Create and Open Room'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};
