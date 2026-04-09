import React, { useState, useEffect, useCallback } from 'react';
import { useNode } from '../context/NodeContext';
import type { ApiResponse, AdapterConfig, ModelConfig } from '../types';
import { Plus, Trash2, Play, Pause, Star } from 'lucide-react';

export const AgentsPage: React.FC = () => {
  const { refresh: refreshNode } = useNode();
  const [providers, setProviders] = useState<AdapterConfig[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);

  const fetchAgents = useCallback(async () => {
    try {
      const [providersRes, modelsRes] = await Promise.all([
        fetch('/api/adapters'),
        fetch('/api/models')
      ]);

      const providersJson: ApiResponse<AdapterConfig[]> = await providersRes.json();
      const modelsJson: ApiResponse<ModelConfig[]> = await modelsRes.json();

      if (providersJson.success) setProviders(providersJson.data || []);
      if (modelsJson.success) setModels(modelsJson.data || []);
    } catch (error) {
      console.error('Error fetching agents:', error);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const deleteProvider = async (type: string) => {
    if (!window.confirm(`Delete provider "${type}"?`)) return;
    try {
      const res = await fetch(`/api/adapters/${type}`, { method: 'DELETE' });
      const json: ApiResponse<any> = await res.json();
      if (json.success) {
        fetchAgents();
        refreshNode();
      }
    } catch (err) {
      console.error('Delete provider error:', err);
    }
  };

  const deleteAgent = async (name: string) => {
    if (!window.confirm(`Remove agent "${name}"?`)) return;
    try {
      const res = await fetch(`/api/models/${name}`, { method: 'DELETE' });
      const json: ApiResponse<any> = await res.json();
      if (json.success) {
        fetchAgents();
        refreshNode();
      }
    } catch (err) {
      console.error('Delete agent error:', err);
    }
  };

  const toggleAgentEnabled = async (name: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const json: ApiResponse<any> = await res.json();
      if (json.success) fetchAgents();
    } catch (err) {
      console.error('Toggle agent error:', err);
    }
  };

  const setAsDefault = async (name: string) => {
    try {
      const res = await fetch(`/api/models/${name}/activate`, { method: 'PUT' });
      const json: ApiResponse<any> = await res.json();
      if (json.success) {
        fetchAgents();
        refreshNode();
      }
    } catch (err) {
      console.error('Set default agent error:', err);
    }
  };

  return (
    <section className="tab-content active panel prose">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="mb-0">Connected Providers</h2>
          <p className="sub text-muted">Manage LLM API providers configured in this node.</p>
        </div>
        <button className="px-4 py-2 bg-text border border-line-soft text-void font-bold rounded-lg hover:bg-cyan transition-colors">
          <Plus className="inline-block w-4 h-4 mr-1" /> Add Provider
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8">
        {providers.length > 0 ? (
          providers.map((p) => (
            <div key={p.type} className="model-item flex justify-between items-center p-4 bg-deep-2/30 border border-line-soft rounded-xl">
              <div className="model-info">
                <h4 className="text-cyan-soft font-bold flex items-center gap-2">
                  {p.type === 'ClaudeAdapter' ? '🔮 Claude' : p.type === 'OpenAIAdapter' ? '🚀 OpenAI' : '🦙 Ollama'}
                </h4>
                <p className="text-xs text-muted mb-1">{p.type}</p>
                {p.baseUrl && <p className="text-xs font-mono text-muted/60">Base: {p.baseUrl}</p>}
              </div>
              <div className="model-actions flex gap-2">
                <button 
                  onClick={() => deleteProvider(p.type)}
                  className="p-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="p-8 text-center border border-dashed border-line-soft rounded-xl text-muted">
            No providers configured. Connect an LLM API to start.
          </div>
        )}
      </div>

      <div className="flex justify-between items-center mb-6">
        <div>
          <h2>Enabled Agents</h2>
          <p className="sub text-muted">Configured models ready to join rooms.</p>
        </div>
        <button className="px-4 py-2 bg-cyan-soft/10 border border-cyan-soft/30 text-cyan-soft font-bold rounded-lg hover:bg-cyan-soft/20 transition-colors">
          <Plus className="inline-block w-4 h-4 mr-1" /> Add Model
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {models.length > 0 ? (
          models.map((m) => (
            <div key={m.name} className="model-item p-4 bg-deep-2/30 border border-line-soft rounded-xl flex flex-col md:flex-row justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-bold text-text mb-0">{m.model || m.name}</h4>
                  {m.active && <span className="text-[10px] bg-warn/20 text-warn border border-warn/30 px-2 py-0.5 rounded-full flex items-center gap-1"><Star className="w-2.5 h-2.5" /> Default</span>}
                </div>
                <p className="text-xs text-muted mb-2">{m.adapter} · {m.enabled ? '✓ Enabled' : '○ Disabled'}</p>
                <div className="flex gap-2">
                  <span className="chip text-[10px] py-1">Mode: {m.agentMode}</span>
                  {m.runtimeOnly && <span className="chip text-[10px] py-1 bg-blue-500/10 border-blue-500/30 text-blue-400">Env Managed</span>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <button 
                  onClick={() => toggleAgentEnabled(m.name, !m.enabled)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${m.enabled ? 'bg-void border-line text-text hover:bg-line-soft' : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'}`}
                >
                  {m.enabled ? <><Pause className="inline-block w-3 h-3 mr-1" /> Disable</> : <><Play className="inline-block w-3 h-3 mr-1" /> Enable</>}
                </button>
                
                {!m.active && (
                  <button 
                    onClick={() => setAsDefault(m.name)}
                    className="px-3 py-1.5 bg-warn/10 border border-warn/30 text-warn rounded-lg text-xs font-bold hover:bg-warn/20 transition-colors"
                  >
                    Set Default
                  </button>
                )}

                <button 
                  onClick={() => deleteAgent(m.name)}
                  className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-xs font-bold hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="p-8 text-center border border-dashed border-line-soft rounded-xl text-muted">
            No agents configured. Add a model from one of your providers.
          </div>
        )}
      </div>
    </section>
  );
};
