import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { NodeStatus, NodeReadiness, ApiResponse } from '../types';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warn';
  isRemoving?: boolean;
}

interface NodeContextType {
  status: NodeStatus | null;
  readiness: NodeReadiness | null;
  loading: boolean;
  refresh: () => Promise<void>;
  isAuthenticated: boolean;
  logout: () => void;
  sessionId: string;
  joinRoom: (roomId: string, agentName: string, role: string) => Promise<any>;
  controlSession: (roomId: string, agentName: string, action: 'start' | 'stop' | 'restart', data?: any) => Promise<any>;
  notifications: Toast[];
  addNotification: (message: string, type: Toast['type']) => void;
  removeNotification: (id: string) => void;
}

const NodeContext = createContext<NodeContextType | undefined>(undefined);

const SESSION_ID = crypto.randomUUID();

export const NodeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [readiness, setReadiness] = useState<NodeReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [notifications, setNotifications] = useState<Toast[]>([]);
  
  const lastActivityIdRef = useRef<string | null>(null);
  const seenActivityIdsRef = useRef<Set<string>>(new Set());

  const addNotification = useCallback((message: string, type: Toast['type']) => {
    const id = crypto.randomUUID();
    const newToast: Toast = { id, message, type };
    setNotifications(prev => [...prev, newToast]);

    // Auto-remove after 4 seconds
    setTimeout(() => {
      removeNotification(id);
    }, 4000);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.map(t => t.id === id ? { ...t, isRemoving: true } : t));
    setTimeout(() => {
      setNotifications(prev => prev.filter(t => t.id !== id));
    }, 300);
  }, []);

  // Monitor recent activity for new events to show as notifications
  useEffect(() => {
    if (!readiness?.recentActivity?.length) return;

    const activities = readiness.recentActivity;

    // We process from newest to oldest (backend returns newest first)
    // But we only want to show notifications for items we haven't seen in THIS session's poll
    activities.forEach((activity) => {
      // Simple heuristic: if it's the first run, just mark the latest as seen
      if (!lastActivityIdRef.current) {
        lastActivityIdRef.current = activity.id;
        activities.forEach(a => seenActivityIdsRef.current.add(a.id));
        return;
      }

      const activityId = activity.id;
      if (!seenActivityIdsRef.current.has(activityId)) {
        seenActivityIdsRef.current.add(activityId);
        // Only show if it's "fresh" (e.g. within last 30 seconds of the poll cycle)
        // or just show everything new since last poll.
        addNotification(activity.message, activity.type as Toast['type']);
      }
    });

    if (activities.length > 0) {
      lastActivityIdRef.current = activities[0].id;
    }
  }, [readiness?.recentActivity, addNotification]);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session');
      const json: any = await res.json();
      const isAuth = !!(json.authenticated || (json.data && json.data.authenticated));
      setIsAuthenticated(isAuth);
      return isAuth;
    } catch (err) {
      setIsAuthenticated(false);
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, readinessRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/status/readiness')
      ]);

      if (statusRes.status === 401 || readinessRes.status === 401) {
        setIsAuthenticated(false);
        return;
      }

      const statusJson: ApiResponse<NodeStatus> = await statusRes.json();
      const readinessJson: ApiResponse<NodeReadiness> = await readinessRes.json();

      if (statusJson.success) setStatus(statusJson.data || null);
      if (readinessJson.success) setReadiness(readinessJson.data || null);
      
      setIsAuthenticated(true);
    } catch (error) {
      console.error('[NodeContext] Error refreshing node status:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const joinRoom = async (roomId: string, agentName: string, role: string) => {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/join-self`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName, role })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to join room');
    addNotification(`Joined room as ${agentName}`, 'success');
    return json.data;
  };

  const controlSession = async (roomId: string, agentName: string, action: 'start' | 'stop' | 'restart', data?: any) => {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/local-sessions/${encodeURIComponent(agentName)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || `Failed to ${action} session`);
    addNotification(`${action.charAt(0).toUpperCase() + action.slice(1)}ed session for ${agentName}`, 'info');
    return json.data;
  };

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      const auth = await checkAuth();
      if (mounted) {
        if (auth) {
          await refresh();
        } else {
          setLoading(false);
        }
      }
    };
    init();
    return () => { mounted = false; };
  }, [checkAuth, refresh]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      refresh();
    }, 10000);
    return () => clearInterval(interval);
  }, [refresh, isAuthenticated]);

  const logout = () => {
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
      setIsAuthenticated(false);
      setStatus(null);
      setReadiness(null);
      addNotification('Logged out successfully', 'info');
    });
  };

  return (
    <NodeContext.Provider value={{ 
      status, 
      readiness, 
      loading, 
      refresh, 
      isAuthenticated: !!isAuthenticated, 
      logout,
      sessionId: SESSION_ID,
      joinRoom,
      controlSession,
      notifications,
      addNotification,
      removeNotification
    }}>
      {children}
    </NodeContext.Provider>
  );
};

export const useNode = () => {
  const context = useContext(NodeContext);
  if (context === undefined) {
    throw new Error('useNode must be used within a NodeProvider');
  }
  return context;
};
