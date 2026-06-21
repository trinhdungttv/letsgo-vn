import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from './supabase';
import type { AppUser, RolePermission } from './types';

interface AuthContextValue {
  user: AppUser | null;
  token: string | null;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => void;
  loading: boolean;
  rolePermissions: RolePermission[];
  refreshRolePermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  login: async () => 'Not initialized',
  logout: () => {},
  loading: true,
  rolePermissions: [],
  refreshRolePermissions: async () => {},
});

const STORAGE_KEY = 'letsgo_user';
const TOKEN_KEY = 'letsgo_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
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
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (storedToken) setToken(storedToken);
    setLoading(false);
    refreshRolePermissions();
  }, [refreshRolePermissions]);

  const login = async (username: string, password: string): Promise<string | null> => {
    // Xac thuc qua RPC verify_login: so khop mat khau da hash, kiem tra is_active, cap session token.
    const { data, error } = await supabase.rpc('verify_login', {
      p_username: username.trim(),
      p_password: password,
    });
    if (error) return 'Lỗi đăng nhập: ' + error.message;
    const row = (Array.isArray(data) ? data[0] : data) as (AppUser & { token?: string }) | undefined;
    if (!row) return 'Sai tên đăng nhập hoặc mật khẩu';
    const { token: newToken, ...userFields } = row;
    setUser(userFields);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userFields));
    if (newToken) {
      setToken(newToken);
      localStorage.setItem(TOKEN_KEY, newToken);
    }
    return null;
  };

  const logout = () => {
    // Huy token phia server (best-effort) truoc khi xoa local.
    if (token) supabase.rpc('logout_session', { p_token: token }).then(() => {}, () => {});
    setUser(null);
    setToken(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, rolePermissions, refreshRolePermissions }}>
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
  loans: 'Khoan vay',
};

const crm = ['crm-dash', 'crm-board', 'crm-leads', 'crm-prods', 'crm-deal'];
const FALLBACK_RULES: Record<string, string[]> = {
  admin:      ['dashboard', 'clients', 'client-detail', 'branches', 'finance', 'market', 'reports', 'users', 'history', 'admin-settings', 'workspace', 'loans', ...crm],
  ketoan:     ['dashboard', 'clients', 'client-detail', 'finance', 'reports', 'workspace'],
  kinhdoanh:  ['dashboard', 'clients', 'client-detail', 'market', 'reports', 'workspace', ...crm],
  bdh:        ['dashboard', 'clients', 'client-detail', 'branches', 'finance', 'reports', 'workspace', ...crm],
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
