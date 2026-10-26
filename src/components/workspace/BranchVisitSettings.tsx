// Cài đặt khung «Cập nhật chi nhánh»: ngưỡng nhắc liên hệ + công tắc hiện / ẩn từng chi nhánh.
// Gợi ý (không tự ẩn): chi nhánh đang là Dự án công ty được gắn nhãn, kèm nút ẩn một lượt.
import { EyeOff } from 'lucide-react';
import type { Branch } from '../../lib/types';
import { setHiddenIds, toggleHiddenId } from '../../lib/branchVisitRail';
import { BranchAvatar } from '../branches/BranchAvatar';
import { Switch } from './Switch';
import { BTN_PRIMARY, BTN_TINTED, INPUT, TINT } from './wsTheme';

export function BranchVisitSettings({ branches, hiddenIds, companyIds, threshold, onThreshold, onHiddenChange, onClose }: {
  branches: Branch[];
  hiddenIds: string[];
  /** Chi nhánh đang là Dự án công ty — chỉ để gợi ý ẩn. */
  companyIds: string[];
  threshold: number;
  onThreshold: (v: number) => void;
  onHiddenChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const company = new Set(companyIds);
  const hiddenCount = branches.filter(b => hiddenIds.includes(b.id)).length;
  const companyToHide = companyIds.filter(id => !hiddenIds.includes(id));

  return (
    <div className="px-4 pb-3 pt-1">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="visit-threshold" className="text-[13px] text-[#1D1D1F]">Nhắc liên hệ sau</label>
        <div className="flex items-center gap-1.5 text-[13px] text-[#6E6E73]">
          <input id="visit-threshold" type="number" min={1} value={threshold}
            onChange={e => onThreshold(Math.max(1, Number(e.target.value) || 1))}
            className={`w-16 text-[13px] text-center px-2 py-1 tabular-nums ${INPUT}`} />
          ngày
        </div>
      </div>
      <div className="text-[11.5px] text-[#86868B] mt-1.5 leading-relaxed">
        ≤ {threshold} ngày: xanh · {threshold}–{2 * threshold} ngày: cam · &gt; {2 * threshold} ngày: đỏ
      </div>

      <div className="flex items-center justify-between gap-2 mt-3.5 mb-1.5">
        <div className="text-[12px] font-semibold text-[#86868B] uppercase tracking-[0.04em]">Hiển thị chi nhánh</div>
        {hiddenCount > 0 && (
          <button type="button" onClick={() => onHiddenChange(setHiddenIds(hiddenIds, branches.map(b => b.id), false))}
            className="text-[12.5px] text-[#0066CC] hover:underline">Hiện tất cả</button>
        )}
      </div>

      {companyToHide.length > 0 && (
        <button type="button" onClick={() => onHiddenChange(setHiddenIds(hiddenIds, companyToHide, true))}
          className={`${BTN_TINTED} h-8 px-3 text-[12.5px] w-full mb-2`}>
          <EyeOff size={13} /> Ẩn {companyToHide.length} chi nhánh Dự án công ty
        </button>
      )}

      <div className="rounded-[12px] bg-[#F5F5F7] max-h-64 overflow-y-auto">
        {branches.length === 0 ? (
          <div className="px-3.5 py-3 text-[13px] text-[#86868B] text-center">Chưa có chi nhánh</div>
        ) : branches.map(b => {
          const shown = !hiddenIds.includes(b.id);
          return (
            <div key={b.id} className="flex items-center gap-2.5 px-3 py-2 border-b border-black/[0.05] last:border-b-0">
              <BranchAvatar branch={b} size={28} className={shown ? '' : 'opacity-50'} />
              <span className={`flex-1 min-w-0 text-[13px] truncate ${shown ? 'text-[#1D1D1F]' : 'text-[#86868B]'}`}>{b.name}</span>
              {company.has(b.id) && (
                <span className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0 ${TINT.blue}`}>Dự án CT</span>
              )}
              <Switch on={shown} label={`Hiện ${b.name}`} onToggle={() => onHiddenChange(toggleHiddenId(hiddenIds, b.id))} />
            </div>
          );
        })}
      </div>

      <button type="button" onClick={onClose} className={`${BTN_PRIMARY} mt-3 w-full h-8 text-[13px]`}>Xong</button>
    </div>
  );
}
