import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { IndustryTemplate } from '../../../lib/costPlan/template';
import { formatDate } from '../../../lib/format';
import { MenuItem, Popover, btnGhost, card } from './ui';

/**
 * "Mẫu ngành": mỗi ngành có mức hỗ trợ độc hại / khoản đặc thù riêng → lưu bảng chi phí chuẩn của ngành,
 * lần sau chọn ngành đó là bảng tự điền theo mẫu. Chỉ hiện khi đã chọn ngành.
 */
export default function IndustryTemplateBar({ industry, template, lineCount, onSave, onApply, onDelete }: {
  industry: string;
  template: IndustryTemplate | null;
  /** Số khoản của bảng hiện tại (không tính Phí DV) — để nói rõ sẽ lưu gì */
  lineCount: number;
  onSave: () => Promise<void>;
  onApply: () => void;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (!industry) return null;
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <div className={`${card} px-5 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2`}>
      <div className="min-w-0 flex-1 basis-60">
        <div className="text-[13px] font-semibold text-[#1d1d1f] truncate">
          {template ? `Mẫu ngành ${industry}` : `Ngành ${industry} chưa có mẫu riêng`}
        </div>
        <div className="text-[12px] text-[#86868b] leading-snug">
          {template
            ? `${template.lines.length} khoản · cập nhật ${formatDate(template.updated_at)}${template.updated_by_name ? ` bởi ${template.updated_by_name}` : ''} · phương án mới của ngành này tự điền theo mẫu`
            : 'Đang dùng bộ gợi ý chung. Chỉnh bảng cho đúng mức hỗ trợ độc hại / khoản đặc thù của ngành rồi lưu làm mẫu.'}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {template && <button type="button" onClick={onApply} className={btnGhost}>Áp mẫu vào bảng này</button>}
        <button type="button" disabled={busy} onClick={() => run(onSave)} className={template ? btnGhost : btnGhost + ' !bg-[#0071e3] !text-white hover:!bg-[#0077ed]'}>
          {busy && <Loader2 size={13} className="animate-spin" />}{template ? 'Cập nhật mẫu' : `Lưu bảng này (${lineCount} khoản) làm mẫu`}
        </button>
        {template && (
          <Popover width="w-48" button={({ toggle }) => <button type="button" onClick={toggle} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7]" aria-label="Thêm">⋯</button>}>
            {close => <div className="py-1"><MenuItem danger onClick={() => { close(); run(onDelete); }}>Xoá mẫu ngành</MenuItem></div>}
          </Popover>
        )}
      </div>
    </div>
  );
}
