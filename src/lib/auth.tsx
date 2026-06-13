import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from './supabase';
import type { AppUser, RolePermission } from './types';

interface AuthContextValue {
  user: AppUser | null;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => void;
  loading: boolean;
  rolePermissions: RolePermission[];
  refreshRolePermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  login: async () => 'Not initialized',
  logout: () => {},
  loading: true,
  rolePermissions: [],
  refreshRolePermissions: async () => {},
});

const STORAGE_KEY = 'letsgo_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);

  const refreshRolePermissions = useCallback(async () => {
    const { data, error } = await supabase.from('role_permissions').select('*');
    if (!error && data) setRolePermissions(data as RolePermission[]);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch { localStorage.removeItem(STORAGE_KEY); }
    }
    setLoading(false);
    refreshRolePermissions();
  }, [refreshRolePermissions]);

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
    <AuthContext.Provider value={{ user, login, logout, loading, rolePermissions, refreshRolePermissions }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Maps each app `Page` to the module name shown in the editable "Ma trận phân quyền" (role_permissions table)
export const PAGE_MODULE: Record<string, string> = {
  dashboard: 'Dashboard',
  workspace: 'Workspace',
  clients: 'Khách hàng',
  'client-detail': 'Khách hàng',
  branches: 'Chi nhánh',
  finance: 'Tài chính',
  market: 'Thị trường',
  quotes: 'Báo giá',
  'crm-dash': 'CRM',
  'crm-board': 'CRM',
  'crm-leads': 'CRM',
  'crm-prods': 'CRM',
  'crm-deal': 'CRM',
  'crm-pipeline': 'CRM',
  reports: 'Báo cáo',
  users: 'Quản lý Users',
  history: 'Lịch sử',
  'admin-settings': 'Admin',
  'sales-board': 'Bảng KD',
};

const crm = ['crm-dash', 'crm-board', 'crm-leads', 'crm-prods', 'crm-deal'];
const FALLBACK_RULES: Record<string, string[]> = {
  admin:      ['dashboard', 'clients', 'client-detail', 'branches', 'finance', 'market', 'quotes', 'reports', 'users', 'history', 'admin-settings', 'workspace', 'sales-board', ...crm],
  ketoan:     ['dashboard', 'clients', 'client-detail', 'finance', 'reports', 'workspace'],
  kinhdoanh:  ['dashboard', 'clients', 'client-detail', 'market', 'quotes', 'reports', 'workspace', 'sales-board', ...crm],
  bdh:        ['dashboard', 'clients', 'client-detail', 'branches', 'finance', 'reports', 'workspace', 'sales-board', ...crm],
};

export function canAccess(role: string, page: string, rolePermissions?: RolePermission[]): boolean {
  if (rolePermissions && rolePermissions.length) {
    const module = PAGE_MODULE[page];
    if (!module) return false;
    const perm = rolePermissions.find(p => p.role === role && p.module === module);
    const level = perm?.level ?? 'none';
    return level !== 'none';
  }
  return (FALLBACK_RULES[role] || []).includes(page);
}
