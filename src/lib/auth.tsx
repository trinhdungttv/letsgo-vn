import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from './supabase';
import type { AppUser } from './types';

interface AuthContextValue {
  user: AppUser | null;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  login: async () => 'Not initialized',
  logout: () => {},
  loading: true,
});

const STORAGE_KEY = 'letsgo_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch { localStorage.removeItem(STORAGE_KEY); }
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from('app_users')
      .select('id, username, full_name, role')
      .eq('username', username.trim())
      .eq('password', password)
      .single();
    if (error || !data) return 'Sai tên đăng nhập hoặc mật khẩu';
    const u = data as AppUser;
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    return null;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function canAccess(role: string, page: string): boolean {
  const crm = ['crm-dash', 'crm-board', 'crm-leads', 'crm-prods', 'crm-deal'];
  const rules: Record<string, string[]> = {
    admin:      ['dashboard', 'clients', 'client-detail', 'branches', 'finance', 'market', 'quotes', 'reports', 'users', 'history', ...crm],
    ketoan:     ['dashboard', 'clients', 'client-detail', 'finance', 'reports'],
    kinhdoanh:  ['dashboard', 'clients', 'client-detail', 'market', 'quotes', 'reports', ...crm],
    bdh:        ['dashboard', 'clients', 'client-detail', 'branches', 'finance', 'reports', ...crm],
  };
  return (rules[role] || []).includes(page);
}
