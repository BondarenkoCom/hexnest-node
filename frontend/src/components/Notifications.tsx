import React from 'react';
import { useNode } from '../context/NodeContext';
import { X, Check, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warn';
  isRemoving?: boolean;
}

export const Notifications: React.FC = () => {
  const { notifications, removeNotification } = useNode();

  if (notifications.length === 0) return null;

  return (
    <div className="notifications-container">
      {notifications.map((toast) => (
        <div 
          key={toast.id} 
          className={`notification ${toast.type} ${toast.isRemoving ? 'removing' : ''}`}
        >
          <div className="notification-icon">
            {toast.type === 'success' && <Check className="w-5 h-5" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5" />}
            {toast.type === 'info' && <Info className="w-5 h-5" />}
            {toast.type === 'warn' && <AlertTriangle className="w-5 h-5" />}
          </div>
          <div className="notification-message">
            {toast.message}
          </div>
          <button 
            className="notification-close" 
            onClick={() => removeNotification(toast.id)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
