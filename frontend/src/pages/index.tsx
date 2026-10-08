import React, { useState, useEffect } from 'react';
import { UserSession, getSession, saveSession, clearSession } from '@/lib/api';
import LoginView from '@/components/LoginView';
import LabourerDashboard from '@/components/LabourerDashboard';
import AdminDashboard from '@/components/AdminDashboard';

export default function HomePage() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // Restore authenticated session from localStorage if present
  useEffect(() => {
    const existingSession = getSession();
    if (existingSession && existingSession.token && existingSession.employee) {
      setSession(existingSession);
    }
    setCheckingSession(false);
  }, []);

  const handleLoginSuccess = (newSession: UserSession) => {
    saveSession(newSession);
    setSession(newSession);
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
  };

  if (checkingSession) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen bg-[#0b0f19]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-slate-400 font-medium">Loading session...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated: Present Login Interface
  if (!session) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  // Role: Admin (Ateeb)
  if (session.employee.role === 'Admin') {
    return <AdminDashboard session={session} onLogout={handleLogout} />;
  }

  // Role: Labourer
  return <LabourerDashboard session={session} onLogout={handleLogout} />;
}