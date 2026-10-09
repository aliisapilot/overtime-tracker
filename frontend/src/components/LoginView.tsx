import React, { useState, useEffect } from 'react';
import { login, testPing, UserSession } from '@/lib/api';

interface LoginViewProps {
  onLoginSuccess: (session: UserSession) => void;
}

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [employeeId, setEmployeeId] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [activeTab, setActiveTab] = useState<'keypad' | 'keyboard'>('keyboard');

  // Verify backend connectivity on mount
  useEffect(() => {
    let isMounted = true;
    testPing().then((res) => {
      if (isMounted) {
        setBackendStatus(res.ok ? 'online' : 'offline');
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const [focusedField, setFocusedField] = useState<'id' | 'pin'>('id');

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!employeeId.trim()) {
      setError('Please enter your Employee ID (e.g. EMP000, EMP001, or just 1)');
      return;
    }
    if (!pin.trim()) {
      setError('Please enter your PIN');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await login(employeeId, pin);
      if (res.success && res.token && res.employee) {
        onLoginSuccess({
          token: res.token,
          employee: res.employee,
        });
      } else {
        setError(res.message || 'Login failed. Please check your credentials.');
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeypadPress = (val: string) => {
    if (focusedField === 'id') {
      setEmployeeId((prev) => prev + val);
    } else {
      if (pin.length < 8) {
        setPin((prev) => prev + val);
      }
    }
  };

  const handleKeypadBackspace = () => {
    if (focusedField === 'id') {
      setEmployeeId((prev) => prev.slice(0, -1));
    } else {
      setPin((prev) => prev.slice(0, -1));
    }
  };

  const handleKeypadClear = () => {
    if (focusedField === 'id') {
      setEmployeeId('');
    } else {
      setPin('');
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-center items-center px-4 py-8 sm:px-6 lg:px-8">
      {/* Background radial glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Header / Brand Card */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-lg shadow-blue-500/20 mb-4 border border-blue-400/30">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Overtime Tracker</h1>
          <p className="mt-1 text-sm text-slate-400">Labour Attendance & Overtime System</p>

          {/* Backend Connection Badge */}
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-slate-800/80 border border-slate-700">
            <span
              className={`w-2 h-2 rounded-full ${
                backendStatus === 'online'
                  ? 'bg-emerald-400 animate-pulse'
                  : backendStatus === 'checking'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-rose-400'
              }`}
            />
            <span className="text-slate-300">
              {backendStatus === 'online'
                ? 'Backend Connected (Live)'
                : backendStatus === 'checking'
                ? 'Checking backend...'
                : 'Backend Offline'}
            </span>
          </div>
        </div>

        {/* Login Form Panel */}
        <div className="glass-panel rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-800/80">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Employee ID Field */}
            <div>
              <label htmlFor="employeeId" className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                Employee ID
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <input
                  id="employeeId"
                  type="text"
                  autoComplete="username"
                  required
                  placeholder="e.g. EMP001 or 1"
                  value={employeeId}
                  onFocus={() => setFocusedField('id')}
                  onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
                  className={`block w-full pl-11 pr-4 py-3 bg-slate-900/90 border rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none font-mono text-base transition-all ${
                    focusedField === 'id' && activeTab === 'keypad'
                      ? 'border-blue-500 ring-2 ring-blue-500/30'
                      : 'border-slate-700/80 focus:ring-2 focus:ring-blue-500'
                  }`}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                Labourers: enter <span className="text-blue-400 font-mono">EMP001</span> or just your number (e.g. <span className="text-blue-400 font-mono">1</span> or <span className="text-blue-400 font-mono">001</span>)
              </p>
            </div>

            {/* PIN Field */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label htmlFor="pin" className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Access PIN
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab(activeTab === 'keypad' ? 'keyboard' : 'keypad')}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                  >
                    {activeTab === 'keypad' ? 'Use Keyboard' : 'Use Onscreen Keypad'}
                  </button>
                </div>
              </div>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  id="pin"
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  required
                  placeholder="••••••••"
                  value={pin}
                  onFocus={() => setFocusedField('pin')}
                  onChange={(e) => setPin(e.target.value)}
                  className={`block w-full pl-11 pr-11 py-3 bg-slate-900/90 border rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none font-mono text-lg tracking-widest transition-all ${
                    focusedField === 'pin' && activeTab === 'keypad'
                      ? 'border-blue-500 ring-2 ring-blue-500/30'
                      : 'border-slate-700/80 focus:ring-2 focus:ring-blue-500'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200"
                >
                  {showPin ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error Message Box */}
            {error && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-start gap-2.5">
                <svg className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Onscreen Keypad for mobile/tablet site workers */}
            {activeTab === 'keypad' && (
              <div className="pt-2">
                {/* Active Keypad Target Selector */}
                <div className="flex items-center gap-2 bg-slate-900/80 p-1.5 rounded-xl border border-slate-700/80 mb-3">
                  <button
                    type="button"
                    onClick={() => setFocusedField('id')}
                    className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg transition-all ${
                      focusedField === 'id'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Typing ID: {employeeId ? <span className="font-mono text-white">{employeeId}</span> : <span className="text-slate-500 font-normal">tap</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocusedField('pin')}
                    className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg transition-all ${
                      focusedField === 'pin'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Typing PIN: {pin ? <span className="font-mono tracking-widest text-white">{'•'.repeat(pin.length)}</span> : <span className="text-slate-500 font-normal">tap</span>}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleKeypadPress(String(num))}
                      className="keypad-btn"
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleKeypadClear}
                    className="keypad-btn text-base font-medium text-slate-400 hover:text-rose-400"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeypadPress('0')}
                    className="keypad-btn"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handleKeypadBackspace}
                    className="keypad-btn text-slate-300"
                  >
                    ⌫
                  </button>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || backendStatus === 'offline'}
              className="w-full mt-4 flex items-center justify-center py-3.5 px-4 rounded-xl text-base font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.99] transition-all shadow-lg shadow-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Authenticating...</span>
                </div>
              ) : (
                <span>Sign In to System</span>
              )}
            </button>
          </form>

          {/* Security & Access Information */}
          <div className="mt-6 pt-5 border-t border-slate-800 text-center">
            <p className="text-xs text-slate-400">
              Admin account: <span className="font-mono text-slate-300">EMP000</span> (Ateeb)
            </p>
            <p className="text-xs text-slate-500 mt-1">
              All logins enforce PBKDF2 cryptography with rate-limiting protection.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
