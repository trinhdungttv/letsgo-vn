// Thanh lọc Chi nhánh / Người phụ trách / Người quản lý KH (dùng với useCareScope).
// variant 'pill' = kiểu Apple (ô chọn bo tròn nền xám nhạt) cho Dashboard.
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import type { AppUserLite } from '../data/api';
import { DEFAULT_SCOPE, type CareScope } from '../useCareScope';

const selectCls = 'text-[12px] h-9 md:h-8 px-2 border border-gray-300 rounded-lg bg-white outline-none focus:border-blue-500 max-w-full';
const pillCls = 'appearance-none h-9 md:h-8 pl-3.5 pr-8 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] outline-none focus:ring-2 focus:ring-[#1D4ED8]/30 max-w-full truncate cursor-pointer';

export function CareScopeBar({ scope, users, total, unit = 'người liên hệ', variant = 'default' }: {
  scope: CareScope;
  users: readonly AppUserLite[];
  /** Tổng trước khi lọc — hiện "N / tổng". */
  total: number;
  unit?: string;
  variant?: 'default' | 'pill';
}) {
  const { user } = useAuth();
  const { filters, setFilters, options, isFiltered, isAdmin, scoped } = scope;
  const pill = variant === 'pill';
  // Ô chọn kiểu pill bỏ mũi tên gốc → thêm mũi tên riêng
  const wrap = (node: ReactNode) => (pill ? (
    <span className="relative inline-flex max-w-full">
      {node}
      <ChevronDown size={14} strokeWidth={2.4} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#86868B]" />
    </span>
  ) : node);
  const cls = pill ? pillCls : selectCls;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {wrap(
        <select value={filters.branch} onChange={e => setFilters({ ...filters, branch: e.target.value })} className={cls} aria-label="Lọc theo chi nhánh">
          <option value="all">Tất cả chi nhánh</option>
          {options.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>,
      )}
      {wrap(
        <select value={filters.owner} onChange={e => setFilters({ ...filters, owner: e.target.value })} className={cls} aria-label="Lọc theo người phụ trách">
          <option value="mine">Của tôi{isAdmin ? ' (+ chưa giao)' : ''}</option>
          <option value="all">Mọi người phụ trách</option>
          <option value="none">Chưa giao người phụ trách</option>
          {users.filter(u => u.id !== user?.id).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>,
      )}
      {options.managers.length > 0 && wrap(
        <select value={filters.manager} onChange={e => setFilters({ ...filters, manager: e.target.value })} className={cls} aria-label="Lọc theo người quản lý khách hàng">
          <option value="all">Mọi người quản lý KH</option>
          {options.managers.map(m => <option key={m} value={m}>{m}</option>)}
        </select>,
      )}
      {isFiltered && (
        <button type="button" onClick={() => setFilters(DEFAULT_SCOPE)}
          className={pill ? 'text-[13px] font-medium text-[#1D4ED8] hover:opacity-70 px-1.5 min-h-[36px]' : 'text-[12px] text-[#888] hover:text-[#333] px-1 min-h-[36px]'}>
          Xoá lọc
        </button>
      )}
      <span className={pill ? 'text-[12px] text-[#86868B] ml-auto tabular-nums' : 'text-[11.5px] text-[#aaa] ml-auto'}>{scoped.length} / {total} {unit}</span>
    </div>
  );
}
