import { useState } from 'react';
import { UserMinus, Plus, X } from 'lucide-react';

const STAGES = ['Tuần đầu tiên', 'Tháng 1–2', 'Sau 3 tháng', 'Sau 6 tháng', 'Sau Tết', 'Hết mùa cao điểm'];
const COMMON_REASONS = ['Lạnh / phòng sạch', 'Mùi khó chịu', 'Ca đêm', 'Ít tăng ca', 'Xa nhà / khó ở trọ',
  'Lương thấp hơn nơi khác', 'Áp lực sản lượng', 'Quản lý gắt', 'Đứng lâu / nặng nhọc', 'Cơm ca không hợp'];

interface Props {
  turnoverRate: number | null;
  quitStage: string | null;
  quitReasons: string[];
  retentionActions: string | null;
  onChange: (patch: { turnover_rate?: number | null; quit_stage?: string | null; quit_reasons?: string[]; retention_actions?: string | null }) => void;
}

export default function IndustryRetention({ turnoverRate, quitStage, quitReasons, retentionActions, onChange }: Props) {
  const [custom, setCustom] = useState('');

  const toggle = (r: string) => onChange({
    quit_reasons: quitReasons.includes(r) ? quitReasons.filter(x => x !== r) : [...quitReasons, r],
  });
  const addCustom = () => {
    const v = custom.trim();
    if (!v || quitReasons.includes(v)) { setCustom(''); return; }
    onChange({ quit_reasons: [...quitReasons, v] });
    setCustom('');
  };

  // Mốc so sánh chung thị trường cung ứng LĐ: dưới 8%/tháng là tốt, trên 15% là báo động.
  const rateTone = turnoverRate == null ? 'text-[#bbb]'
    : turnoverRate >= 15 ? 'text-red-600' : turnoverRate >= 8 ? 'text-amber-700' : 'text-emerald-700';
  const rateNote = turnoverRate == null ? 'chưa nhập'
    : turnoverRate >= 15 ? 'cao — cần nêu trước với khách kèm giải pháp'
    : turnoverRate >= 8 ? 'trung bình ngành' : 'thấp — đây là điểm mạnh khi chào giá';

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
        <UserMinus size={13} className="text-rose-600" />
        <div className="text-[12.5px] font-semibold text-[#111]">Hồ sơ giữ chân lao động</div>
        <span className="text-[10.5px] text-[#999]">vì sao LĐ ngành này nghỉ · nói trước là ghi điểm</span>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-[#888]">Tỷ lệ nghỉ việc trung bình (%/tháng)</label>
            <div className="flex items-baseline gap-2">
              <input value={turnoverRate ?? ''} onChange={e => onChange({ turnover_rate: e.target.value.trim() === '' ? null : Number(e.target.value.replace(/[^\d.]/g, '')) })}
                placeholder="12" className={`w-20 text-[16px] font-medium px-2 py-1 rounded-lg border border-[#E8E7E2] outline-none focus:border-blue-500 ${rateTone}`} />
              <span className="text-[11px] text-[#999]">{rateNote}</span>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-[#888]">Nghỉ nhiều nhất ở giai đoạn</label>
            <select value={quitStage ?? ''} onChange={e => onChange({ quit_stage: e.target.value || null })}
              className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-[#E8E7E2] outline-none focus:border-blue-500 bg-white">
              <option value="">— chưa xác định —</option>
              {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-[#888]">Lý do nghỉ việc — click để chọn, thứ tự chọn là thứ tự ưu tiên</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {COMMON_REASONS.map(r => {
              const idx = quitReasons.indexOf(r);
              return (
                <button key={r} onClick={() => toggle(r)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition ${idx >= 0 ? 'bg-rose-600 text-white' : 'bg-[#F4F3EF] text-[#666] hover:bg-[#EAE8E2]'}`}>
                  {idx >= 0 && <span className="mr-1 opacity-70">{idx + 1}</span>}{r}
                </button>
              );
            })}
            {quitReasons.filter(r => !COMMON_REASONS.includes(r)).map(r => (
              <span key={r} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-600 text-white">
                {quitReasons.indexOf(r) + 1} {r}
                <button onClick={() => toggle(r)} className="hover:opacity-70"><X size={10} /></button>
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <input value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCustom()}
                placeholder="lý do khác…" className="w-[110px] text-[11px] px-2 py-0.5 rounded-full border border-dashed border-[#D8D6D0] outline-none focus:border-blue-500" />
              <button onClick={addCustom} className="p-0.5 rounded text-[#999] hover:text-[#111]"><Plus size={12} /></button>
            </span>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-[#888]">Biện pháp đã dùng và kết quả thực tế</label>
          <textarea value={retentionActions ?? ''} onChange={e => onChange({ retention_actions: e.target.value })} rows={3}
            placeholder="VD: Sàng lọc kỹ điều kiện lạnh ngay vòng phỏng vấn → tỷ lệ bỏ tuần đầu giảm từ 18% xuống 7%. Thưởng chuyên cần 300k/tháng → giữ được LĐ qua tháng thứ 3."
            className="w-full text-[13px] px-2.5 py-2 rounded-lg border border-[#E8E7E2] outline-none focus:border-blue-500 resize-y leading-relaxed" />
        </div>
      </div>
    </div>
  );
}
