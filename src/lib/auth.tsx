import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from './supabase';
import type { AppUser, RolePermission } from './types';
import { OFFICE_PAGES, OFFICE_PERMISSION_MODULE, isOfficePage } from '../modules/office-rental/pages';
import { startGoogleLogin, completeGoogleLogin, hasGoogleRedirect } from './googleLogin';
import { SESSION_TOKEN_KEY } from './sessionToken';
import { RECRUIT_ENABLED } from './featureFlags';
import { setWriteGuardRole, isReadOnlyRole } from './writeGuard';

export { isReadOnlyRole };

interface AuthContextValue {
  user: AppUser | null;
  token: string | null;
  login: (username: string, password: string) => Promise<string | null>;
  /** Chuyển sang trang Google; chỉ trả về khi có lỗi (câu tiếng Việt) */
  loginWithGoogle: () => Promise<string | null>;
  /** Lỗi của lần đăng nhập Google vừa quay về (vd email chưa được cấp quyền) */
  googleError: string | null;
  logout: () => void;
  loading: boolean;
  rolePermissions: RolePermission[];
  refreshRolePermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  login: async () => 'Not initialized',
  loginWithGoogle: async () => 'Not initialized',
  googleError: null,
  logout: () => {},
  loading: true,
  rolePermissions: [],
  refreshRolePermissions: async () => {},
});

const STORAGE_KEY = 'letsgo_user';
const TOKEN_KEY = SESSION_TOKEN_KEY;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  // Vừa quay về từ Google → giữ màn chờ tới khi đổi xong sang token của app
  const [googlePending, setGooglePending] = useState(hasGoogleRedirect);
  const [googleError, setGoogleError] = useState<string | null>(null);

  // Vai trò chỉ xem (Ban Điều Hành) → lớp chặn ghi của client Supabase biết ngay (lib/writeGuard.ts)
  useEffect(() => { setWriteGuardRole(user?.role ?? null); }, [user]);

  const refreshRolePermissions = useCallback(async () => {
    const { data, error } = await supabase.from('role_permissions').select('*');
    if (!error && data) setRolePermissions(data as RolePermission[]);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const u = JSON.parse(stored) as AppUser;
        setWriteGuardRole(u?.role ?? null); // ngay lúc mở app, trước khi trang nào kịp ghi
        setUser(u);
      } catch { localStorage.removeItem(STORAGE_KEY); }
    }
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (storedToken) setToken(storedToken);
    setLoading(false);
    refreshRolePermissions();
  }, [refreshRolePermissions]);

  // Lưu phiên giống nhau cho đăng nhập mật khẩu và Google → RPC admin_*, header x-letsgo-token chạy như cũ.
  const saveSession = useCallback((userFields: AppUser, newToken?: string) => {
    setGoogleError(null);
    setUser(userFields);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userFields));
    if (newToken) {
      setToken(newToken);
      localStorage.setItem(TOKEN_KEY, newToken);
    }
  }, []);

  useEffect(() => {
    const pending = completeGoogleLogin();
    if (!pending) return;
    let alive = true;
    pending.then(res => {
      if (!alive) return;
      if ('error' in res) setGoogleError(res.error);
      else saveSession(res.user, res.token);
      setGooglePending(false);
    });
    return () => { alive = false; };
  }, [saveSession]);

  const loginWithGoogle = async (): Promise<string | null> => {
    setGoogleError(null);
    return startGoogleLogin();
  };

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
    saveSession(userFields, newToken);
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
    <AuthContext.Provider value={{
      user, token, login, loginWithGoogle, googleError, logout,
      loading: loading || googlePending, rolePermissions, refreshRolePermissions,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Tên module trang Tổng quan điều hành trong ma trận phân quyền (migration 218). */
export const OVERVIEW_MODULE = 'Tổng quan';

/** Tên module Pháp lý trong ma trận phân quyền (migration 201). */
export const LEGAL_MODULE = 'Pháp lý';

// Maps each app `Page` to the module name shown in the editable "Ma trận phân quyền" (role_permissions table)
export const PAGE_MODULE: Record<string, string> = {
  dashboard: 'Dashboard',
  // Tổng quan điều hành (migration 218) — trang nhìn tổng thể cho Ban Điều Hành
  overview: OVERVIEW_MODULE,
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
  // Tuyển dụng — quyền 'Tuyển dụng' (migration 180: admin/bdh/kinhdoanh full, ketoan xem)
  recruit: 'Tuyển dụng',
  // Văn phòng Orient — một quyền chung cho cả module (migration 164 cấp cho admin)
  ...Object.fromEntries(OFFICE_PAGES.map(p => [p, OFFICE_PERMISSION_MODULE])),
  // Pháp lý (Workspace → nút "Pháp lý") — migration 201: admin/bdh sửa, ketoan/kinhdoanh xem
  legal: LEGAL_MODULE,
};

const crm = ['crm-dash', 'crm-board', 'crm-leads', 'crm-prods', 'crm-deal'];
const FALLBACK_RULES: Record<string, string[]> = {
  admin:      ['dashboard', 'overview', 'clients', 'client-detail', 'branches', 'finance', 'market', 'reports', 'users', 'history', 'admin-settings', 'workspace', 'loans', 'recruit', 'legal', ...crm, ...OFFICE_PAGES],
  ketoan:     ['dashboard', 'clients', 'client-detail', 'finance', 'reports', 'workspace', 'recruit', 'legal'],
  kinhdoanh:  ['dashboard', 'clients', 'client-detail', 'market', 'reports', 'workspace', 'recruit', 'legal', ...crm],
  // Ban Điều Hành: chỉ xem tổng thể (migration 218) — trang chi tiết không mở
  bdh:        ['dashboard', 'overview', 'reports'],
};

/**
 * Mức quyền trong trang Pháp lý: 'full' = thêm / sửa / xoá, 'view' = chỉ xem. Admin luôn 'full'.
 * Chưa có dòng quyền 'Pháp lý' (chưa chạy migration 201) → bdh sửa, vai trò khác xem.
 */
export function legalLevel(role: string, rolePermissions?: RolePermission[]): 'full' | 'view' | 'none' {
  if (role === 'admin') return 'full';
  if (isReadOnlyRole(role)) return capReadOnly(legalLevelRaw(role, rolePermissions));
  return legalLevelRaw(role, rolePermissions);
}

/** Vai trò chỉ xem (Ban Điều Hành) không bao giờ có mức 'full' dù ma trận ghi gì. */
function capReadOnly(level: 'full' | 'view' | 'none'): 'full' | 'view' | 'none' {
  return level === 'full' ? 'view' : level;
}

function legalLevelRaw(role: string, rolePermissions?: RolePermission[]): 'full' | 'view' | 'none' {
  const perm = rolePermissions?.find(p => p.role === role && p.module === LEGAL_MODULE);
  if (perm) return perm.level;
  if (rolePermissions?.length && rolePermissions.some(p => p.module === LEGAL_MODULE)) return 'none';
  return role === 'bdh' ? 'full' : (FALLBACK_RULES[role] || []).includes('legal') ? 'view' : 'none';
}

/** Tên module Đi họp (CSKH → tab "Đi họp") trong ma trận phân quyền (migration 217). */
export const MEETING_MODULE = 'Đi họp';

/**
 * Mức quyền tab Đi họp (danh sách thành viên có số CCCD): 'full' = thêm / sửa / xoá, 'view' = chỉ xem. Admin luôn 'full'.
 * Chưa có dòng quyền (chưa chạy migration 217) → bdh / kinhdoanh sửa, vai trò khác không thấy — DB (meeting_rpc) vẫn là chốt chặn cuối.
 */
export function meetingLevel(role: string, rolePermissions?: RolePermission[]): 'full' | 'view' | 'none' {
  if (role === 'admin') return 'full';
  if (isReadOnlyRole(role)) return capReadOnly(meetingLevelRaw(role, rolePermissions));
  return meetingLevelRaw(role, rolePermissions);
}

function meetingLevelRaw(role: string, rolePermissions?: RolePermission[]): 'full' | 'view' | 'none' {
  const perm = rolePermissions?.find(p => p.role === role && p.module === MEETING_MODULE);
  if (perm) return perm.level;
  if (rolePermissions?.length && rolePermissions.some(p => p.module === MEETING_MODULE)) return 'none';
  return role === 'bdh' || role === 'kinhdoanh' ? 'full' : 'none';
}

/**
 * Quyền xem tệp Sale / CTV (Mạng lưới Sale, migration 178) bên trong trang CSKH — không còn là trang riêng
 * (gộp 31/10/2026) nhưng giữ khoá này làm quyền. Chốt chỉ admin — danh sách Sale muốn chiêu mộ là thông tin nhạy cảm.
 */
export const SALE_PAGE = 'crm-sales';

export function canAccess(role: string, page: string, rolePermissions?: RolePermission[]): boolean {
  // Tổng quan: chưa chạy migration 218 (chưa có dòng quyền) → admin + Ban Điều Hành vẫn vào được
  if (page === 'overview' && !rolePermissions?.some(p => p.module === OVERVIEW_MODULE)) {
    return (FALLBACK_RULES[role] || []).includes('overview');
  }
  // Muốn mở cho phòng kinh doanh sau này: bỏ dòng này + thêm 'crm-sales' vào PAGE_MODULE / FALLBACK_RULES
  if (page === SALE_PAGE) return role === 'admin';
  // Văn phòng Orient: chốt cứng chỉ admin (RLS bds_* cũng chỉ mở cho admin). Muốn cấp quyền hẹp sau này:
  // bỏ dòng này + thêm module vào ma trận phân quyền + đổi bds_is_admin() trong DB.
  if (isOfficePage(page)) {
    if (role !== 'admin') return false;
    // Chưa có dòng quyền (chưa chạy migration 164) → vẫn cho admin vào để thấy hướng dẫn cài đặt
    const perm = rolePermissions?.find(p => p.role === role && p.module === OFFICE_PERMISSION_MODULE);
    return perm ? perm.level !== 'none' : true;
  }
  // Tuyển dụng đang tắt (featureFlags.ts) → không ai thấy menu / trang, kể cả admin
  if (page === 'recruit' && !RECRUIT_ENABLED) return false;
  // Tuyển dụng: chưa có dòng quyền nào (chưa chạy migration 180) → vẫn cho admin vào để thấy hướng dẫn cài đặt
  if (page === 'recruit' && role === 'admin' && !rolePermissions?.some(p => p.module === PAGE_MODULE.recruit)) return true;
  // Pháp lý: chưa chạy migration 201 (chưa có dòng quyền nào) → theo quyền mặc định, admin vẫn vào để thấy hướng dẫn
  if (page === 'legal') return legalLevel(role, rolePermissions) !== 'none';
  if (rolePermissions && rolePermissions.length) {
    const module = PAGE_MODULE[page];
    if (!module) return false;
    const perm = rolePermissions.find(p => p.role === role && p.module === module);
    const level = perm?.level ?? 'none';
    return level !== 'none';
  }
  return (FALLBACK_RULES[role] || []).includes(page);
}
