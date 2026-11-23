import { useState } from 'react';
import type { AppUser, Client, ServiceType } from '../../lib/types';
import { changeServiceType, SERVICE_LABEL, type ClientServiceHistory } from '../../lib/serviceChange';

interface Props {
  client: Client;
  initialType?: ServiceType;
  user: AppUser | null;
  onClose: () => void;
  onDone: (updates: Partial<Client>, history: ClientServiceHistory | null) => void;
  toast: (msg: string) => void;
}

const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function ServiceChangeModal({ client, initialType, user, onClose, onDone, toast }: Props) {
  const cur = (client.service_type ?? 'leasing') as ServiceType;
  const [target, setTarget] = useState<ServiceType>(initialType && initialType !== cur ? initialType : (cur === 'leasing' ? 'recruitment' : 'leasing'));
  const [date, setDate] = useState(todayLocal());
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!date) { toast('Chọn ngày chuyển'); return; }
    setBusy(true);
    try {
      const r = await changeServiceType({ client, newType: target, effectiveFrom: date, user });
      toast(r.historyError ? 'Đã đổi loại hình, nhưng chưa ghi được ngày chuyển (cần chạy migration 235)' : 'Đã chuyển loại hình dịch vụ');
      onDone(r.updates, r.history);
      onClose();
    } catch (e) { toast('Lỗi: ' + (e instanceof Error ? e.message : String(e))); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-3" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl p-5 w-[400px] max-w-full">
        <div className="text-[14px] font-semibold text-[#111] mb-1">Chuyển loại hình dịch vụ</div>
        <div className="text-[12.5px] text-[#666] mb-3">{client.name} — đang là <b>{SERVICE_LABEL[cur]}</b></div>
        <label className="text-[11.5px] text-[#888] block mb-0.5">Chuyển sang</label>
        <select value={target} onChange={e => setTarget(e.target.value as ServiceType)} className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 mb-3 bg-white">
          {(Object.keys(SERVICE_LABEL) as ServiceType[]).filter(t => t !== cur).map(t => <option key={t} value={t}>{SERVICE_LABEL[t]}</option>)}
        </select>
        <label className="text-[11.5px] text-[#888] block mb-0.5">Ngày chuyển</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 mb-3" />
        <div className="text-[11.5px] text-[#999] mb-4">
          Không xoá dữ liệu nào: Chốt công, Tính lương, Phát lương, Ứng lương, Kỳ thanh toán vẫn được giữ.
          {target === 'recruitment' ? ' Với Giới thiệu lao động các mốc này chỉ bị ẩn; chuyển lại Cho thuê là hiện lại nguyên.' : ''}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={busy} className="px-3 py-1.5 rounded-lg text-[12.5px] border border-gray-300 text-gray-600 hover:bg-gray-50">Hủy</button>
          <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-lg text-[12.5px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-60">{busy ? 'Đang lưu…' : 'Chuyển'}</button>
        </div>
      </div>
    </div>
  );
}
