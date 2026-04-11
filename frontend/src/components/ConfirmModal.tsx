import React from 'react';
import { ShieldAlert, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ 
  isOpen, 
  title, 
  message, 
  onConfirm, 
  onCancel 
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-panel destructive">
        <div className="modal-header">
          <h3 className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-blood-soft" />
            {title}
          </h3>
          <button onClick={onCancel} className="p-1 hover:text-cyan transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="modal-body">
          <p className="text-sm leading-relaxed text-text mt-2">
            {message}
          </p>
          <div className="mt-4 p-3 bg-red-500/5 border border-red-500/10 rounded-lg">
            <p className="text-[10px] text-blood-soft uppercase tracking-widest font-bold">
              Warning: This action cannot be undone
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <button 
            type="button" 
            onClick={onCancel}
            className="px-4 py-2 text-text-muted hover:text-text font-bold transition-colors"
          >
            Cancel
          </button>
          <button 
            type="button" 
            onClick={onConfirm}
            className="button-destructive"
          >
            Confirm Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
