import React, { useState } from 'react';
import { changePin } from '@/lib/api';

interface ChangePinModalProps {
  token: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ChangePinModal({ token, isOpen, onClose, onSuccess }: ChangePinModalProps) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPin.trim()) {
      setError('Please enter your current PIN');
      return;
    }
    if (newPin.trim().length < 4) {
      setError('New PIN must be at least 4 digits');
      return;
    }
    if (newPin.trim() !== confirmPin.trim()) {
      setError('New PIN and confirmation PIN do not match');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await changePin(token, currentPin.trim(), newPin.trim());
      if (res.success) {
        onSuccess();
        onClose();
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
      } else {
        setError(res.message || 'Failed to update PIN. Please verify your current PIN.');
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Connection error changing PIN.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-panel bg-slate-900 border border-slate-700 rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-1">Update Security PIN</h3>
        <p className="text-xs text-slate-400 mb-5">
          Your new PIN will be encrypted using 25,000-iteration PBKDF2 cryptography.
        </p>

        {error && (
          <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Current PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              required
              placeholder="••••"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              New PIN (4–8 digits)
            </label>
            <input
              type="password"
              inputMode="numeric"
              required
              placeholder="••••"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Confirm New PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              required
              placeholder="••••"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Updating...' : 'Update PIN'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
