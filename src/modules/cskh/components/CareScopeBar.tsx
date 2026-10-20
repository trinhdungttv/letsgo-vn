// Thanh lọc Chi nhánh / Người phụ trách / Người quản lý KH (dùng với useCareScope) —
// ô chọn dạng viên kiểu Apple, tô xanh nhạt khi đang lọc.
import { useAuth } from '../../../lib/auth';
import type { AppUserLite } from '../data/api';
import { DEFAULT_SCOPE, type CareScope } from '../useCareScope';
import { PillSelect } from './apple';

export function CareScopeBar({ scope, users, total, unit = 'người liên hệ' }: {
  scope: CareScope;
  users: readonly AppUserLite[];
  /** Tổng trước khi lọc — hiện "N / tổng". */
  total: number;
  unit?: string;
}) {
  const { user } = useAuth();
  const { filters, setFilters, options, isFiltered, isAdmin, scoped } = scope;
  return (
    // Điện thoại: 1 hàng cuộn ngang (ô chọn bị ép 16px nên xếp nhiều hàng rất dài); máy tính: xuống dòng
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-3 px-3 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible [&>*]:shrink-0">
      <PillSelect value={filters.branch} active={filters.branch !== DEFAULT_SCOPE.branch} label="Lọc theo chi nhánh"
        onChange={v => setFilters({ ...filters, branch: v })}>
        <option value="all">Tất cả chi nhánh</option>
        {options.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </PillSelect>
      <PillSelect value={filters.owner} active={filters.owner !== DEFAULT_SCOPE.owner} label="Lọc theo người phụ trách"
        onChange={v => setFilters({ ...filters, owner: v })}>
        <option value="mine">Của tôi{isAdmin ? ' (+ chưa giao)' : ''}</option>
        <option value="all">Mọi người phụ trách</option>
        <option value="none">Chưa giao người phụ trách</option>
        {users.filter(u => u.id !== user?.id).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
      </PillSelect>
      {options.managers.length > 0 && (
        <PillSelect value={filters.manager} active={filters.manager !== DEFAULT_SCOPE.manager} label="Lọc theo người quản lý khách hàng"
          onChange={v => setFilters({ ...filters, manager: v })}>
          <option value="all">Mọi người quản lý KH</option>
          {options.managers.map(m => <option key={m} value={m}>{m}</option>)}
        </PillSelect>
      )}
      {isFiltered && (
        <button type="button" onClick={() => setFilters(DEFAULT_SCOPE)}
          className="text-[13px] font-medium text-[#0066CC] hover:opacity-70 px-1.5 min-h-[36px]">
          Xoá lọc
        </button>
      )}
      <span className="text-[12px] text-[#86868B] ml-auto tabular-nums">{scoped.length} / {total} {unit}</span>
    </div>
  );
}
