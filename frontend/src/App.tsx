import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Profiles from './pages/Profiles';
import Clusters from './pages/Clusters';
import Privacy from './pages/Privacy';

const navLinks = [
  { to: '/', label: 'Overview' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/clusters', label: 'Clusters' },
  { to: '/privacy', label: 'Privacy Panel' },
];

const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();

  return (
    <div className="flex h-screen bg-gray-100 text-left">
      <nav className="w-64 bg-white shadow-md p-5 flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-blue-600 mb-8">PoliticaAI</h1>
        {navLinks.map(({ to, label }) => {
          const isActive = location.pathname === to;
          return (
            <Link
              key={to}
              to={to}
              className={`font-semibold px-3 py-2 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-gray-700 hover:text-blue-500 hover:bg-gray-50'
              }`}
            >
              {label}
            </Link>
          );
        })}
        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-auto text-left text-red-500 font-semibold px-3 py-2"
        >
          Sign Out
        </button>
      </nav>
      <main className="flex-1 p-10 overflow-y-auto">{children}</main>
    </div>
  );
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  return (
    <Router>
      <Routes>
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />
        <Route path="/" element={session ? <DashboardLayout><Overview /></DashboardLayout> : <Navigate to="/login" />} />
        <Route path="/profiles" element={session ? <DashboardLayout><Profiles /></DashboardLayout> : <Navigate to="/login" />} />
        <Route path="/clusters" element={session ? <DashboardLayout><Clusters /></DashboardLayout> : <Navigate to="/login" />} />
        <Route path="/privacy" element={session ? <DashboardLayout><Privacy /></DashboardLayout> : <Navigate to="/login" />} />
      </Routes>
    </Router>
  );
}