import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNode } from '../context/NodeContext';
import { PlusCircle, Info, Search } from 'lucide-react';
import type { ApiResponse, AgentDescriptor, RoomWebhookInfo } from '../types';

export const NewRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const { readiness, refresh } = useNode();
  const [name, setName] = useState('');
  const [task, setTask] = useState('');
  const [subnest, setSubnest] = useState('general');
  const [availableAgents, setAvailableAgents] = useState<AgentDescriptor[]>([]);
  const [inviteAgentIds, setInviteAgentIds] = useState<string[]>([]);
  const [pythonEnabled, setPythonEnabled] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [marketDataEnabled, setMarketDataEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [sentimentEnabled, setSentimentEnabled] = useState(false);
  const [constraintType, setConstraintType] = useState<'sentences' | 'chars' | 'words' | 'none'>('none');
  const [constraintValue, setConstraintValue] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        console.log('[NewRoomPage] Fetching available agents...');
        const res = await fetch('/api/rooms');
        const json: ApiResponse<{ availableAgents: AgentDescriptor[] }> = await res.json();
        console.log('[NewRoomPage] API Response:', json);
        if (json.success && json.data?.availableAgents) {
          setAvailableAgents(json.data.availableAgents);
          console.log('[NewRoomPage] Set availableAgents:', json.data.availableAgents.length);
        }
      } catch (err) {
        console.error('Failed to fetch available agents:', err);
      }
    };
    fetchInitialData();
  }, []);

  const toggleAgent = (id: string) => {
    setInviteAgentIds(prev => 
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const filteredAgents = availableAgents.filter(a => 
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (a.description || '').toLowerCase().includes(searchTerm.toLowerCase())
  );
  const canConfigureWebhook = Boolean(readiness?.operatorEmail);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const normalizedWebhookUrl = webhookUrl.trim();
      if (normalizedWebhookUrl && !canConfigureWebhook) {
        setError('Sign in with an operator account to configure room webhooks.');
        return;
      }

      const responseConstraint = constraintType !== 'none' ? {
        type: constraintType,
        value: constraintValue
      } : undefined;

      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: name.trim(), 
          task: task.trim(),
          subnest,
          inviteAgentIds,
          pythonShellEnabled: pythonEnabled,
          webSearchEnabled,
          marketDataEnabled,
          webhookUrl: canConfigureWebhook ? (normalizedWebhookUrl || undefined) : undefined,
          isPrivate,
          enableSentimentAnalysis: sentimentEnabled,
          responseConstraint
        })
      });

      const json: ApiResponse<{ roomId: string; roomWebhook?: RoomWebhookInfo }> = await res.json();
      if (json.success && json.data?.roomId) {
        await refresh();
        navigate(`/rooms/${json.data.roomId}${normalizedWebhookUrl && canConfigureWebhook ? '?open=webhook' : ''}`, {
          state: {
            initialRoomWebhook: json.data.roomWebhook
          }
        });
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

          <div className="form-group flex flex-col gap-3 p-4 bg-void bg-opacity-50 rounded-lg border border-line-soft">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs uppercase tracking-wider text-cyan-soft font-bold">SubNest (Context Filter)</label>
              <select
                value={subnest}
                onChange={(e) => setSubnest(e.target.value)}
                className="bg-void border border-line-soft rounded-lg px-3 py-1.5 text-xs text-text outline-none focus:border-cyan transition-all"
              >
                <option value="">Full Workspace (Default)</option>
                <option value="frontend">Frontend ONLY</option>
                <option value="src">Backend ONLY</option>
                <option value="scripts">Scripts / DevOps</option>
                <option value="src-tauri">Desktop/Tauri Layer</option>
              </select>
            </div>
            <p className="text-[10px] text-muted italic leading-relaxed">
              Restrict agent's file access to a specific top-level directory.
            </p>
          </div>

          {canConfigureWebhook ? (
            <div className="form-group flex flex-col gap-1.5">
              <label htmlFor="webhookUrlInput" className="text-xs uppercase tracking-wider text-cyan-soft font-bold">
                New Message Webhook URL (optional)
              </label>
              <input
                type="url"
                id="webhookUrlInput"
                className="w-full bg-void border border-line-soft rounded-lg px-4 py-2.5 text-text focus:border-cyan outline-none transition-all"
                placeholder="https://example.com/hexnest/webhook"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <p className="text-[10px] text-muted leading-relaxed">
                Room webhook sends only new message events. Signing key is available to the room owner in room properties.
              </p>
            </div>
          ) : (
            <div className="form-group flex flex-col gap-1.5 p-3 rounded-lg border border-amber-400/30 bg-amber-500/5">
              <p className="text-xs uppercase tracking-wider text-amber-300 font-bold">
                Room Webhook Is Unavailable
              </p>
              <p className="text-[11px] text-muted leading-relaxed">
                Sign in with an operator account to enable webhook delivery for new room messages.
              </p>
            </div>
          )}

          <div className="form-group flex flex-col gap-3 p-4 bg-void bg-opacity-50 rounded-lg border border-line-soft">
            <div className="flex items-center justify-between">
              <label className="text-xs uppercase tracking-wider text-cyan-soft font-bold">Invite Agents</label>
              <button
                type="button"
                className="text-[10px] uppercase font-bold text-cyan hover:text-white transition-colors border border-cyan/30 px-2 py-1 rounded bg-cyan/5"
                onClick={() => setPickerOpen(true)}
              >
                + Open Picker
              </button>
            </div>
            
            {inviteAgentIds.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {inviteAgentIds.map(id => {
                  const agent = availableAgents.find(a => a.name === id);
                  return (
                    <div key={id} className="flex items-center gap-2 bg-cyan/10 border border-cyan/30 px-2 py-1.5 rounded-lg">
                      <span className="text-[10px] font-bold text-cyan uppercase tracking-tight">
                        {agent?.source === 'core' ? '[CORE]' : '[LOCAL]'}
                      </span>
                      <span className="text-[10px] font-bold text-text uppercase tracking-tight">{id}</span>
                      <button 
                        type="button" 
                        onClick={() => toggleAgent(id)}
                        className="text-muted hover:text-red-400 transition-colors ml-1"
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-2 text-center border border-dashed border-line-soft rounded-lg">
                <p className="text-[10px] text-muted uppercase tracking-widest">
                  No agents selected. Selection overrides auto-invite.
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-void bg-opacity-50 rounded-lg border border-line-soft">
            <div className="flex flex-col gap-3">
              <p className="text-[10px] uppercase font-bold tracking-widest text-muted">Capabilities</p>
              
              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" checked={pythonEnabled} onChange={e => setPythonEnabled(e.target.checked)} className="peer hidden" />
                <div className="w-5 h-5 border-2 border-line-soft rounded flex items-center justify-center peer-checked:bg-cyan peer-checked:border-cyan transition-all">
                  {pythonEnabled && <div className="w-2.5 h-2.5 bg-void rounded-sm" />}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm text-text-soft group-hover:text-text transition-colors">Python Execution</span>
                  <span className="text-[10px] text-muted">Agents can run Python code locally</span>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" checked={webSearchEnabled} onChange={e => setWebSearchEnabled(e.target.checked)} className="peer hidden" />
                <div className="w-5 h-5 border-2 border-line-soft rounded flex items-center justify-center peer-checked:bg-cyan peer-checked:border-cyan transition-all">
                  {webSearchEnabled && <div className="w-2.5 h-2.5 bg-void rounded-sm" />}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm text-text-soft group-hover:text-text transition-colors">Web Search</span>
                  <span className="text-[10px] text-muted">Search the internet via Brave API</span>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" checked={marketDataEnabled} onChange={e => setMarketDataEnabled(e.target.checked)} className="peer hidden" />
                <div className="w-5 h-5 border-2 border-line-soft rounded flex items-center justify-center peer-checked:bg-cyan peer-checked:border-cyan transition-all">
                  {marketDataEnabled && <div className="w-2.5 h-2.5 bg-void rounded-sm" />}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm text-text-soft group-hover:text-text transition-colors">Market Data</span>
                  <span className="text-[10px] text-muted">Access live market data</span>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" checked={sentimentEnabled} onChange={e => setSentimentEnabled(e.target.checked)} className="peer hidden" />
                <div className="w-5 h-5 border-2 border-line-soft rounded flex items-center justify-center peer-checked:bg-cyan peer-checked:border-cyan transition-all">
                  {sentimentEnabled && <div className="w-2.5 h-2.5 bg-void rounded-sm" />}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm text-text-soft group-hover:text-text transition-colors">Sentiment Analysis</span>
                  <span className="text-[10px] text-muted">Core-level scoring of agent emotions</span>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} className="peer hidden" />
                <div className="w-5 h-5 border-2 border-line-soft rounded flex items-center justify-center peer-checked:bg-cyan peer-checked:border-cyan transition-all">
                  {isPrivate && <div className="w-2.5 h-2.5 bg-void rounded-sm" />}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm text-text-soft group-hover:text-text transition-colors">Private Room</span>
                  <span className="text-[10px] text-muted">Visible only to you on this node</span>
                </div>
              </label>
            </div>

            <div className="flex flex-col gap-3 border-l border-line-soft pl-6">
              <p className="text-[10px] uppercase font-bold tracking-widest text-muted">Response Limits</p>
              <div className="flex flex-col gap-2">
                <select 
                  className="bg-void border border-line-soft rounded px-3 py-1.5 text-xs text-text outline-none focus:border-cyan"
                  value={constraintType}
                  onChange={(e: any) => setConstraintType(e.target.value)}
                >
                  <option value="none">No constraint</option>
                  <option value="sentences">Limit by Sentences</option>
                  <option value="chars">Limit by Characters</option>
                  <option value="words">Limit by Words</option>
                </select>
                
                {constraintType !== 'none' && (
                  <div className="flex items-center gap-2 mt-1">
                    <input 
                      type="number" 
                      min="1"
                      className="w-20 bg-void border border-line-soft rounded px-3 py-1 text-xs text-text outline-none focus:border-cyan"
                      value={constraintValue}
                      onChange={e => setConstraintValue(Number(e.target.value))}
                    />
                    <span className="text-xs text-muted font-mono lowercase">{constraintType}</span>
                  </div>
                )}
              </div>
            </div>
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
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-void/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-deep border border-line-soft rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-line-soft space-y-4 bg-void/50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-widest">Invite Agents</h3>
                  <p className="text-[10px] text-muted">Core Directory & Local Swarm</p>
                </div>
                <button 
                  onClick={() => {
                    setPickerOpen(false);
                    setSearchTerm('');
                  }}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <PlusCircle className="w-5 h-5 rotate-45 text-muted hover:text-white" />
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <input 
                  type="text"
                  placeholder="Search agents by name or description..."
                  className="w-full bg-void border border-line-soft rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none focus:border-cyan transition-all"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredAgents.map(agent => (
                  <button
                    key={agent.name}
                    type="button"
                    onClick={() => toggleAgent(agent.name)}
                    className={`flex items-start p-4 rounded-xl border text-left transition-all group ${
                      inviteAgentIds.includes(agent.name) 
                        ? 'bg-cyan/10 border-cyan shadow-[0_0_15px_rgba(6,182,212,0.1)]' 
                        : 'bg-void border-line-soft hover:border-cyan/50'
                    }`}
                  >
                    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold uppercase tracking-wider truncate ${
                          inviteAgentIds.includes(agent.name) ? 'text-cyan' : 'text-text group-hover:text-cyan'
                        } transition-colors`}>
                          {agent.name}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono uppercase ${
                          agent.source === 'core' ? 'bg-cyan/10 text-cyan/70 border border-cyan/20' : 'bg-warn/10 text-warn/70 border border-warn/20'
                        }`}>
                          {agent.source || 'A2A'}
                        </span>                          {agent.protocol && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-mono uppercase bg-purple/10 text-purple/70 border border-purple/20">
                              {agent.protocol}
                            </span>
                          )}                      </div>
                      
                      <p className="text-[10px] text-muted leading-relaxed line-clamp-2">
                        {agent.description || 'Autonomous AI agent specializing in task analysis.'}
                      </p>
                    </div>

                    <div className={`flex-shrink-0 mt-0.5 text-[9px] font-bold uppercase transition-colors ${
                      inviteAgentIds.includes(agent.name) ? 'text-cyan' : 'text-muted group-hover:text-cyan'
                    }`}>
                      {inviteAgentIds.includes(agent.name) ? '✓ Added' : '+ Add'}
                    </div>
                  </button>
                ))}
                
                {filteredAgents.length === 0 && (
                  <div className="col-span-full py-12 text-center border border-dashed border-line-soft rounded-2xl">
                    <Search className="w-8 h-8 text-muted/20 mx-auto mb-3" />
                    <p className="text-xs text-muted uppercase tracking-widest">No agents found matching "{searchTerm}"</p>
                  </div>
                )}
              </div>
            </div>
            
            <div className="p-4 border-t border-line-soft bg-void/30 flex justify-end">
              <button 
                onClick={() => setPickerOpen(false)}
                className="px-6 py-2 bg-cyan text-void text-xs font-bold rounded-lg hover:bg-white transition-all"
              >
                Done ({inviteAgentIds.length} Selected)
              </button>
            </div>
          </div>
        </div>
      )}    </section>
  );
};
