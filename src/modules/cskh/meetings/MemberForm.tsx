// Form 1 thành viên đi họp — đủ các cột của "Danh sách đăng ký ra vào cổng" + SĐT, biển số xe.
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { emptyMember, ISSUER_SUGGESTIONS, type MeetingMember, type MemberDraft } from '../../../lib/meetings/types';
import { inputCls } from '../ui';
import { ChoiceChip, Sheet, SHEET_FOOTER } from '../components/Sheet';
import { Switch } from '../components/apple';

const labelCls = 'block text-[12px] font-medium text-[#6E6E73] mb-1';

export function MemberForm({ existing, readOnly, onSave, onDelete, onClose }: {
  existing: MeetingMember | null;
  readOnly: boolean;
  onSave: (d: MemberDraft) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [d, setD] = useState<MemberDraft>(() => (existing ? {
    full_name: existing.full_name, gender: existing.gender, birth: existing.birth, id_number: existing.id_number,
    id_issued_on: existing.id_issued_on, id_issued_by: existing.id_issued_by, address: existing.address, title: existing.title,
    phone: existing.phone, vehicle_plate: existing.vehicle_plate, note: existing.note, active: existing.active,
  } : emptyMember()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (p: Partial<MemberDraft>) => setD(x => ({ ...x, ...p }));

  const digits = d.id_number.replace(/\D/g, '');
  const idWarn = digits && digits.length !== 12 && digits.length !== 9 ? `Số CCCD đang có ${digits.length} chữ số (CCCD 12 số, CMND 9 số)` : '';

  const save = async () => {
    if (!d.full_name.trim()) { setError('Nhập họ tên'); return; }
    setSaving(true); setError('');
    // Gõ tay: chỉ bỏ dấu cách (không tự thêm số 0 như khi nhập file — số thiếu là gõ sai, cảnh báo ở trên)
    const err = await onSave({ ...d, id_number: d.id_number.replace(/\s+/g, ''), vehicle_plate: d.vehicle_plate.toUpperCase() });
    setSaving(false);
    if (err) setError(err);
  };
  const remove = async () => {
    if (!onDelete || !existing) return;
    if (!window.confirm(`Xoá ${existing.full_name} khỏi danh sách thành viên đi họp?\nCác buổi họp cũ vẫn giữ tên người này.`)) return;
    setSaving(true);
    const err = await onDelete();
    setSaving(false);
    if (err) setError(err);
  };

  const title = readOnly ? 'Thành viên' : existing ? 'Sửa thành viên' : 'Thêm thành viên';
  return (
    <Sheet label={title} onClose={onClose} wide>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">{title}</h2>
      <p className="text-[12.5px] text-[#86868B] mt-0.5 mb-3">Thông tin in lên “Danh sách đăng ký ra vào cổng” — nhập đúng như trên CCCD.</p>
      <fieldset disabled={readOnly} className="space-y-3 min-w-0">
        <div>
          <label className={labelCls}>Họ và tên</label>
          <input value={d.full_name} onChange={e => set({ full_name: e.target.value })} className={inputCls} placeholder="Nguyễn Văn A" autoFocus={!existing} maxLength={120} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Giới tính</label>
            <div className="flex gap-1.5">
              {(['Nam', 'Nữ'] as const).map(g => <ChoiceChip key={g} active={d.gender === g} onClick={() => set({ gender: d.gender === g ? '' : g })}>{g}</ChoiceChip>)}
            </div>
          </div>
          <div>
            <label className={labelCls}>Năm sinh <span className="font-normal text-[#AEAEB2]">(hoặc ngày sinh dd/mm/yyyy)</span></label>
            <input value={d.birth} onChange={e => set({ birth: e.target.value })} className={inputCls} placeholder="1983" inputMode="numeric" maxLength={10} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Số CMND / CCCD</label>
            <input value={d.id_number} onChange={e => set({ id_number: e.target.value })} className={`${inputCls} tabular-nums`} placeholder="0301…" inputMode="numeric" maxLength={20} />
          </div>
          <div>
            <label className={labelCls}>Ngày cấp</label>
            <input type="date" value={d.id_issued_on ?? ''} onChange={e => set({ id_issued_on: e.target.value || null })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Nơi cấp</label>
            <input value={d.id_issued_by} onChange={e => set({ id_issued_by: e.target.value })} className={inputCls} list="meeting-issuers" maxLength={120} />
            <datalist id="meeting-issuers">{ISSUER_SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist>
          </div>
        </div>
        {idWarn && <p className="text-[11.5px] text-[#B25000] -mt-1.5">{idWarn}</p>}
        <div>
          <label className={labelCls}>Địa chỉ thường trú</label>
          <input value={d.address} onChange={e => set({ address: e.target.value })} className={inputCls} placeholder="Phường …, TP. …" maxLength={300} />
        </div>
        <div>
          <label className={labelCls}>Chức vụ</label>
          <input value={d.title} onChange={e => set({ title: e.target.value })} className={inputCls} placeholder="Tổng Giám đốc" maxLength={120} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Số điện thoại</label>
            <input value={d.phone} onChange={e => set({ phone: e.target.value })} className={inputCls} inputMode="tel" maxLength={40} />
          </div>
          <div>
            <label className={labelCls}>Biển số xe <span className="font-normal text-[#AEAEB2]">(nếu đi xe riêng)</span></label>
            <input value={d.vehicle_plate} onChange={e => set({ vehicle_plate: e.target.value })} className={`${inputCls} uppercase`} placeholder="60A-123.45" maxLength={30} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Ghi chú</label>
          <textarea rows={2} value={d.note} onChange={e => set({ note: e.target.value })} className={`${inputCls} resize-y`} maxLength={1000} />
        </div>
        <Switch checked={d.active} onChange={v => set({ active: v })}
          label={<span className="text-[13px] text-[#1D1D1F]">Hay đi họp <span className="text-[#86868B]">(tắt = ẩn khỏi ô chọn người tham dự)</span></span>} />
      </fieldset>
      {error && <p className="mt-3 text-[13px] text-[#D70015] bg-[#FF3B30]/10 rounded-[12px] px-3.5 py-2.5">{error}</p>}
      {!readOnly && (
        <div className={`${SHEET_FOOTER} mt-4 flex gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
          {existing && onDelete && (
            <button type="button" onClick={remove} disabled={saving} aria-label="Xoá thành viên" title="Xoá thành viên"
              className="h-11 md:h-9 w-11 md:w-9 shrink-0 rounded-full bg-[#FF3B30]/10 text-[#D70015] hover:bg-[#FF3B30]/15 flex items-center justify-center transition disabled:opacity-40">
              <Trash2 size={16} />
            </button>
          )}
          <button type="button" onClick={onClose} className="flex-1 h-11 md:h-9 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)] active:scale-[0.98] transition">Huỷ</button>
          <button type="button" onClick={save} disabled={saving}
            className="flex-[2] h-11 md:h-9 rounded-full bg-[#0071E3] text-white active:scale-[0.98] transition text-[13px] font-semibold disabled:opacity-40">
            {saving ? 'Đang lưu…' : existing ? 'Lưu' : 'Thêm thành viên'}
          </button>
        </div>
      )}
    </Sheet>
  );
}
