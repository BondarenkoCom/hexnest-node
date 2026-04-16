import React, { useState, useEffect, useCallback } from 'react';
import { useNode } from '../context/NodeContext';
import type { ApiResponse, AdapterConfig, ModelConfig } from '../types';
import { Plus, Trash2, Play, Pause, Star, X, Info, Globe } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';

const DEFAULT_CODEX_MODELS = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'];
const AGENT_MODES: Array<ModelConfig['agentMode']> = ['manual', 'recruitable', 'autonomous'];
const RESPONSE_MODES: Array<ModelConfig['responseMode']> = ['standard', 'slow_model'];

export const AgentsPage: React.FC = () => {
  const { status, refresh: refreshNode, addNotification } = useNode();
  const [providers, setProviders] = useState<AdapterConfig[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [isConnectingCore, setIsConnectingCore] = useState(false);

  // Modal states
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);

  const toggleCoreConnection = async () => {
    setIsConnectingCore(true);
    try {
      const endpoint = status?.coreConnected ? '/api/core/disconnect' : '/api/core/reconnect';
      const res = await fetch(endpoint, { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.success) {
        addNotification(json.message || (status?.coreConnected ? 'Disconnected from Core' : 'Connected to Core'), 'success');
        refreshNode();
      } else {
        addNotification(json.error || 'Operation failed', 'error');
      }
    } catch (err: any) {
      addNotification('Connection error: ' + err.message, 'error');
    } finally {
      setIsConnectingCore(false);
    }
  };

  // Form states
  const [providerType, setProviderType] = useState('OpenAIAdapter');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  const [modelName, setModelName] = useState('');
  const [modelId, setModelId] = useState('');
  const [modelAdapter, setModelAdapter] = useState('');
  const [modelAgentMode, setModelAgentMode] = useState<ModelConfig['agentMode']>('manual');
  const [modelResponseMode, setModelResponseMode] = useState<ModelConfig['responseMode']>('standard');

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [updatingAgentMode, setUpdatingAgentMode] = useState<string | null>(null);

  // Confirm Modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const providerLabel = (type: string): string => {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'ollama' || normalized === 'ollamaadapter') return 'Ollama';
    if (type === 'ClaudeAdapter') return 'Claude';
    if (type === 'OpenAIAdapter') return 'OpenAI';
    if (type === 'OllamaAdapter') return 'Ollama';
    if (type === 'GrokAdapter') return 'Grok';
    if (type === 'GoogleAdapter') return 'Google Gemini';
    if (type === 'CodexAdapter') return 'Codex CLI';
    return type.replace('Adapter', '');
  };

  const providerIcon = (type: string): string => {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'ollama' || normalized === 'ollamaadapter') return '🦙';
    if (type === 'ClaudeAdapter') return '🔮';
    if (type === 'OpenAIAdapter') return '🚀';
    if (type === 'OllamaAdapter') return '🦙';
    if (type === 'GrokAdapter') return '⚡';
    if (type === 'GoogleAdapter') return '🧠';
    if (type === 'CodexAdapter') return '🛠️';
    return '🤖';
  };

  const agentModeLabel = (mode: ModelConfig['agentMode']): string => {
    if (mode === 'manual') return 'Manual';
    if (mode === 'autonomous') return 'Autonomous';
    return 'Recruitable';
  };

  const responseModeLabel = (mode: ModelConfig['responseMode']): string => {
    if (mode === 'slow_model') return 'Slow Model Safe';
    return 'Standard';
  };

  const isOllamaModel = (m: ModelConfig): boolean => {
    const primary = String(m.type || '').toLowerCase();
    const secondary = String(m.adapter || '').toLowerCase();
    return primary === 'ollama' || primary === 'ollamaadapter' || secondary === 'ollama' || secondary === 'ollamaadapter';
  };

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

  const loadAvailableModels = async (adapter: string) => {
    const codexFallback = (): void => {
      if (adapter === 'CodexAdapter') {
        setAvailableModels(DEFAULT_CODEX_MODELS);
      }
    };
    if (!adapter) {
       setAvailableModels([]);
       return;
    }
    setIsTestingProvider(true);
    setAvailableModels([]);
    try {
      const config = providers.find(p => p.type === adapter);
      if (!config) throw new Error('Provider not configured');

      const testRes = await fetch('/api/models/test-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapter, baseUrl: config.baseUrl, apiKey: config.apiKey })
      });
      const testJson = await testRes.json();
      if (testJson.success && testJson.models) {
        const models = Array.isArray(testJson.models) && testJson.models.length > 0
          ? testJson.models
          : (adapter === 'CodexAdapter' ? DEFAULT_CODEX_MODELS : []);
        setAvailableModels(models);
      } else {
        codexFallback();
        if (adapter !== 'CodexAdapter') {
          addNotification(testJson.error || 'Failed to load models', 'error');
        }
      }
    } catch (err: any) {
      codexFallback();
      if (adapter !== 'CodexAdapter') {
        addNotification('Error loading models: ' + err.message, 'error');
      }
    } finally {
      setIsTestingProvider(false);
    }
  };

  const deleteProvider = async (type: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Provider',
      message: `Are you sure you want to delete the provider "${type}"? This will disable all agents using this adapter.`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/adapters/${type}`, { method: 'DELETE' });
          const json: ApiResponse<any> = await res.json();
          if (json.success) {
            fetchAgents();
            refreshNode();
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
          }
        } catch (err) {
          console.error('Delete provider error:', err);
        }
      }
    });
  };

  const deleteAgent = async (name: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Remove Agent',
      message: `Are you sure you want to remove the agent "${name}"? You will need to re-add it manually later.`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/models/${name}`, { method: 'DELETE' });
          const json: ApiResponse<any> = await res.json();
          if (json.success) {
            fetchAgents();
            refreshNode();
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
          }
        } catch (err) {
          console.error('Delete agent error:', err);
        }
      }
    });
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

  const updateAgentMode = async (name: string, agentMode: ModelConfig['agentMode']) => {
    setUpdatingAgentMode(name);
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentMode })
      });
      const json: ApiResponse<any> = await res.json();
      if (json.success) {
        await fetchAgents();
        await refreshNode();
      } else {
        addNotification(json.error || 'Failed to update agent mode', 'error');
      }
    } catch (err) {
      console.error('Update agent mode error:', err);
      addNotification('Failed to update agent mode', 'error');
    } finally {
      setUpdatingAgentMode((current) => (current === name ? null : current));
    }
  };

  const toggleCoreExport = async (name: string, isExported: boolean) => {
    if (!status?.coreConnected) {
      addNotification('Node must be connected to HexNest Core to manage agent directory.', 'warn');
      return;
    }
    
    // Optimistic UI update
    setModels(prev => prev.map(m => m.name === name ? { ...m, isExported: !isExported } : m));
    setUpdatingAgentMode(name);
    
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(name)}/export`, {
        method: isExported ? 'DELETE' : 'POST'
      });
      const json: ApiResponse<any> = await res.json();
      if (json.success) {
        addNotification(isExported ? `Successfully unregistered ${name} from Core.` : `Successfully registered ${name} in Core network!`, 'success');
        // Final sync with server
        await fetchAgents();
      } else {
        // Revert on failure
        setModels(prev => prev.map(m => m.name === name ? { ...m, isExported: isExported } : m));
        addNotification(json.error || (isExported ? 'Failed to unexport agent' : 'Failed to export agent'), 'error');
      }
    } catch (err: any) {
      // Revert on error
      setModels(prev => prev.map(m => m.name === name ? { ...m, isExported: isExported } : m));
      console.error('Export agent error:', err);
      addNotification((isExported ? 'Failed to unexport agent: ' : 'Failed to export agent: ') + err.message, 'error');
    } finally {
      setUpdatingAgentMode(null);
    }
  };

  const updateResponseMode = async (name: string, responseMode: ModelConfig['responseMode']) => {
    setUpdatingAgentMode(name);
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseMode })
      });
      const json: ApiResponse<any> = await res.json();
      if (json.success) {
        await fetchAgents();
        await refreshNode();
      } else {
        addNotification(json.error || 'Failed to update response mode', 'error');
      }
    } catch (err) {
      console.error('Update response mode error:', err);
      addNotification('Failed to update response mode', 'error');
    } finally {
      setUpdatingAgentMode((current) => (current === name ? null : current));
    }
  };

  const saveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`/api/adapters/${providerType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, baseUrl })
      });
      const json: ApiResponse<any> = await res.json();
      if (json.success) {
        setShowProviderModal(false);
        setApiKey('');
        setBaseUrl('');
        fetchAgents();
        refreshNode();
      } else {
        addNotification(json.error || 'Failed to save provider', 'error');
      }
    } catch (err) {
      console.error('Save provider error:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveModel = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const resolvedModelId = String(
        modelId
        || (modelAdapter === 'CodexAdapter' ? (availableModels[0] || 'gpt-5.3-codex') : '')
      ).trim();
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: modelName, 
          model: resolvedModelId, 
          type: modelAdapter,
          agentMode: modelAgentMode,
          responseMode: modelResponseMode
        })
      });
      const json: ApiResponse<any> = await res.json();
      if (json.success) {
        setShowModelModal(false);
        setModelName('');
        setModelId('');
        setModelAgentMode('manual');
        setModelResponseMode('standard');
        fetchAgents();
      } else {
        addNotification(json.error || 'Failed to add model', 'error');
      }
    } catch (err) {
      console.error('Save model error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="tab-content active panel prose">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="mb-0">Connected Providers</h2>
          <p className="sub text-muted">Manage LLM API providers configured in this node.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={toggleCoreConnection}
            disabled={isConnectingCore}
            className={`px-4 py-2 border font-bold rounded-lg transition-all flex items-center gap-2 ${status?.coreConnected ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20' : 'bg-cyan/10 border-cyan/30 text-cyan hover:bg-cyan/20'}`}
          >
            <Globe className={`w-4 h-4 ${isConnectingCore ? 'animate-spin' : ''}`} />
            {isConnectingCore ? 'Connecting...' : (status?.coreConnected ? 'Core: Online' : 'Core: Offline')}
          </button>
          <button 
            onClick={() => setShowProviderModal(true)}
            className="px-4 py-2 bg-text border border-line-soft text-void font-bold rounded-lg hover:bg-cyan transition-colors"
          >
            <Plus className="inline-block w-4 h-4 mr-1" /> Add Provider
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8">
        {providers.length > 0 ? (
          providers.map((p) => (
            <div key={p.type} className="model-item flex justify-between items-center p-4 bg-deep-2/30 border border-line-soft rounded-xl">
              <div className="model-info">
                <h4 className="text-cyan-soft font-bold flex items-center gap-2">
                  {providerIcon(p.type)} {providerLabel(p.type)}
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
        <button 
          onClick={() => {
            if (providers.length === 0) {
              addNotification('Please add at least one provider first.', 'error');
              return;
            }
            setModelAdapter(providers[0].type);
            setModelAgentMode('manual');
            setModelResponseMode('standard');
            loadAvailableModels(providers[0].type);
            setShowModelModal(true);
          }}
          className="px-4 py-2 bg-cyan-soft/10 border border-cyan-soft/30 text-cyan-soft font-bold rounded-lg hover:bg-cyan-soft/20 transition-colors"
        >
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
                <p className="text-xs text-muted mb-2">{providerLabel(m.type || m.adapter || '')} · {m.enabled ? '✓ Enabled' : '○ Disabled'}</p>
                <div className="flex gap-2 mb-2">
                  <span className="chip text-[10px] py-1">Mode: {m.agentMode}</span>
                  {isOllamaModel(m) && (
                    <span className="chip text-[10px] py-1">Perf: {responseModeLabel(m.responseMode || 'standard')}</span>
                  )}
                  {m.runtimeOnly && <span className="chip text-[10px] py-1 bg-blue-500/10 border-blue-500/30 text-blue-400">Env Managed</span>}
                </div>
                <div className="space-y-1.5 max-w-[240px]">
                  <label className="text-[10px] uppercase tracking-widest text-muted font-bold flex items-center gap-1">
                    Session Mode
                    <span
                      className="inline-flex items-center text-muted/80"
                      title="manual: agent does not auto-join; recruitable: agent can be invited by rooms; autonomous: agent keeps polling and responding in room loop"
                      aria-label="Session mode help"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </label>
                  <select
                    className="w-full bg-void border border-line-soft rounded-xl px-3 py-2 text-xs outline-none focus:border-cyan/50 transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                    value={m.agentMode}
                    disabled={Boolean(m.runtimeOnly) || updatingAgentMode === m.name}
                    onChange={(e) => updateAgentMode(m.name, e.target.value as ModelConfig['agentMode'])}
                  >
                    {AGENT_MODES.map(mode => (
                      <option key={mode} value={mode}>{agentModeLabel(mode)}</option>
                    ))}
                  </select>
                  {isOllamaModel(m) && (
                    <>
                      <label className="text-[10px] uppercase tracking-widest text-muted font-bold mt-3 block">Performance Mode</label>
                      <select
                        className="w-full bg-void border border-line-soft rounded-xl px-3 py-2 text-xs outline-none focus:border-cyan/50 transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                        value={m.responseMode || 'standard'}
                        disabled={Boolean(m.runtimeOnly) || updatingAgentMode === m.name}
                        onChange={(e) => updateResponseMode(m.name, e.target.value as ModelConfig['responseMode'])}
                      >
                        {RESPONSE_MODES.map(mode => (
                          <option key={mode} value={mode}>{responseModeLabel(mode)}</option>
                        ))}
                      </select>
                    </>
                  )}
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
                  onClick={() => toggleCoreExport(m.name, m.isExported || false)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${m.isExported ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/30' : 'bg-cyan/10 border-cyan/30 text-cyan hover:bg-cyan/20'}`}
                  title={m.isExported ? "Unlink from Core directory so others cannot invite it" : "Make this agent available for others to invite in Core"}
                >
                  <Globe className="w-3 h-3 inline-block mr-1" /> {m.isExported ? 'Unlink' : 'Core'}
                </button>

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

      {/* Add Provider Modal */}
      {showProviderModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <h3>Connect Provider</h3>
              <button onClick={() => setShowProviderModal(false)} className="p-1 hover:text-cyan transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={saveProvider}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Provider Type</label>
                  <select 
                    className="form-control" 
                    value={providerType} 
                    onChange={e => setProviderType(e.target.value)}
                  >
                    <option value="OpenAIAdapter">OpenAI</option>
                    <option value="ClaudeAdapter">Claude (Anthropic)</option>
                    <option value="OllamaAdapter">Ollama (Local)</option>
                    <option value="GrokAdapter">Grok (xAI)</option>
                    <option value="GoogleAdapter">Google (Gemini)</option>
                    <option value="CodexAdapter">Codex CLI</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>API Key</label>
                  <input 
                    type="password" 
                    className="form-control" 
                    placeholder={providerType === 'OllamaAdapter' || providerType === 'CodexAdapter' ? 'Not required for local CLI' : 'Enter your API key...'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                  />
                  <p className="text-[10px] text-muted mt-2">Required for OpenAI, Claude, Grok, and Google. Optional for Ollama and Codex CLI.</p>
                </div>
                <div className="form-group">
                  <label>Base URL (Optional)</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="e.g. http://localhost:11434"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                  />
                  <p className="text-[10px] text-muted mt-2">Custom endpoint or proxy URL.</p>
                </div>
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  onClick={() => setShowProviderModal(false)}
                  className="px-4 py-2 text-text-muted hover:text-text font-bold"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={loading}
                  className="px-6 py-2 bg-cyan text-void font-bold rounded-lg hover:shadow-[0_0_15px_rgba(74,217,255,0.4)] transition-all disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Model Modal */}
      {showModelModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <h3>Add Agent Model</h3>
              <button onClick={() => setShowModelModal(false)} className="p-1 hover:text-cyan transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={saveModel}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Provider</label>
                  <select 
                    className="form-control" 
                    value={modelAdapter} 
                    onChange={e => {
                      const newAdapter = e.target.value;
                      setModelAdapter(newAdapter);
                      loadAvailableModels(newAdapter);
                    }}
                  >
                    <option value="">— Select provider —</option>
                    {providers.map(p => (
                      <option key={p.type} value={p.type}>{providerLabel(p.type)}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Unique Name</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="e.g. my-gpt-agent"
                    required
                    value={modelName}
                    onChange={e => setModelName(e.target.value)}
                  />
                  <p className="text-[10px] text-muted mt-2">Local identifier for this agent.</p>
                </div>
                <div className="form-group">
                  <label>Model ID</label>
                  <select
                    className="form-control"
                    value={modelId}
                    onChange={e => setModelId(e.target.value)}
                    required
                    disabled={isTestingProvider || availableModels.length === 0}
                  >
                    {isTestingProvider ? (
                      <option value="">Loading available models...</option>
                    ) : availableModels.length > 0 ? (
                      <>
                        <option value="">— Select a model —</option>
                        {availableModels.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </>
                    ) : (
                      <option value="">No models found or configured</option>
                    )}
                  </select>
                  <p className="text-[10px] text-muted mt-2">The actual model name used by the provider.</p>
                </div>
                <div className="form-group">
                  <label className="flex items-center gap-1">
                    Agent Mode
                    <span
                      className="inline-flex items-center text-muted/80"
                      title="manual: agent does not auto-join; recruitable: agent can be invited by rooms; autonomous: agent keeps polling and responding in room loop"
                      aria-label="Agent mode help"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </span>
                  </label>
                  <select
                    className="form-control"
                    value={modelAgentMode}
                    onChange={e => setModelAgentMode(e.target.value as ModelConfig['agentMode'])}
                    required
                  >
                    <option value="manual">Manual (start by hand)</option>
                    <option value="recruitable">Recruitable (auto-join invitations)</option>
                    <option value="autonomous">Autonomous (continuous room loop)</option>
                  </select>
                  <p className="text-[10px] text-muted mt-2">Choose how this agent participates in room sessions.</p>
                </div>
                {modelAdapter === 'OllamaAdapter' && (
                  <div className="form-group">
                    <label>Performance Mode</label>
                    <select
                      className="form-control"
                      value={modelResponseMode}
                      onChange={e => setModelResponseMode(e.target.value as ModelConfig['responseMode'])}
                      required
                    >
                      <option value="standard">Standard (balanced)</option>
                      <option value="slow_model">Slow Model Safe (longer timeout, compact context)</option>
                    </select>
                    <p className="text-[10px] text-muted mt-2">Use Slow Model Safe for large local models that timeout in room sessions.</p>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  onClick={() => setShowModelModal(false)}
                  className="px-4 py-2 text-text-muted hover:text-text font-bold"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={loading}
                  className="px-6 py-2 bg-cyan text-void font-bold rounded-lg hover:shadow-[0_0_15px_rgba(74,217,255,0.4)] transition-all disabled:opacity-50"
                >
                  {loading ? 'Adding...' : 'Add Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      <ConfirmModal 
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />
    </section>
  );
};
