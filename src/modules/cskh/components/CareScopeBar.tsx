// Thanh lọc Chi nhánh / Người phụ trách / Người quản lý KH (dùng với useCareScope) —
// ô chọn dạng viên kiểu Apple, tô xanh nhạt khi đang lọc.
// Bộ lọc nhớ theo TỪNG MÁY → điện thoại có thể đang lọc khác máy tính. Trên điện thoại dải ô chọn
// cuộn ngang nên "Xoá lọc" / "N / tổng" ở cuối dải bị khuất — tách ra 1 dòng riêng luôn nhìn thấy.
import { useAuth } from '../../../lib/auth';
import type { AppUserLite } from '../data/api';
import { DEFAULT_SCOPE, type CareScope } from '../useCareScope';
import { PillSelect } from './apple';
import { useSpace } from '../space';

export function CareScopeBar({ scope, users, total, unit }: {
  scope: CareScope;
  users: readonly AppUserLite[];
  /** Tổng trước khi lọc — hiện "N / tổng". */
  total: number;
  /** Danh từ đếm — mặc định theo khu vực ("người liên hệ" / "Sale"). */
  unit?: string;
}) {
  const { user } = useAuth();
  const { noun } = useSpace();
  const { filters, setFilters, options, isFiltered, isAdmin, scoped } = scope;
  const ownerLabel = filters.owner === 'all' ? 'Mọi người phụ trách'
    : filters.owner === 'none' ? 'Chưa giao người phụ trách'
      : users.find(u => u.id === filters.owner)?.full_name ?? '';
  // "Đang lọc: Biên Hoà - Ms Thương · Mr Quốc An" — chỉ các ô khác mặc định
  const activeLabel = [
    filters.branch !== DEFAULT_SCOPE.branch && (options.branches.find(b => b.id === filters.branch)?.name ?? 'Chi nhánh khác'),
    filters.owner !== DEFAULT_SCOPE.owner && ownerLabel,
    filters.manager !== DEFAULT_SCOPE.manager && filters.manager,
  ].filter(Boolean).join(' · ');
  const count = <span className="tabular-nums">{scoped.length} / {total} {unit ?? noun}</span>;
  const clear = (
    <button type="button" onClick={() => setFilters(DEFAULT_SCOPE)}
      className="shrink-0 text-[13px] font-medium text-[#0066CC] hover:opacity-70 px-1.5 min-h-[36px]">
      Xoá lọc
    </button>
  );
  return (
    <div>
      {/* Điện thoại: 1 hàng cuộn ngang (ô chọn bị ép 16px nên xếp nhiều hàng rất dài); máy tính: xuống dòng */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-3 px-3 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible [&>*]:shrink-0">
        {/* Mạng lưới Sale không gắn công ty khách → không có chi nhánh để lọc */}
        {(options.branches.length > 0 || filters.branch !== DEFAULT_SCOPE.branch) && (
          <PillSelect value={filters.branch} active={filters.branch !== DEFAULT_SCOPE.branch} label="Lọc theo chi nhánh"
            onChange={v => setFilters({ ...filters, branch: v })}>
            <option value="all">Tất cả chi nhánh</option>
            {options.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </PillSelect>
        )}
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
        {isFiltered && <span className="hidden md:inline-flex">{clear}</span>}
        <span className="hidden md:inline text-[12px] text-[#86868B] ml-auto">{count}</span>
      </div>

      {/* Điện thoại: dòng tóm tắt luôn thấy — đang lọc thì tô xanh + nút Xoá lọc */}
      <div className="md:hidden flex items-center gap-2 mt-1 min-h-[36px]">
        <span className={`min-w-0 flex-1 truncate text-[12px] ${isFiltered ? 'text-[#0066CC]' : 'text-[#86868B]'}`}>
          {isFiltered && <><b className="font-semibold">Đang lọc: {activeLabel}</b> · </>}
          {count}
        </span>
        {isFiltered && clear}
      </div>
    </div>
  );
}
