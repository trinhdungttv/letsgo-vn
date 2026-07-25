import { useRef, useState } from 'react';
import { UserMinus, Plus, X, StickyNote } from 'lucide-react';

const STAGES = ['Tuần đầu tiên', 'Tháng 1–2', 'Sau 3 tháng', 'Sau 6 tháng', 'Sau Tết', 'Hết mùa cao điểm'];
const COMMON_REASONS = ['Lạnh / phòng sạch', 'Mùi khó chịu', 'Ca đêm', 'Ít tăng ca', 'Xa nhà / khó ở trọ',
  'Lương thấp hơn nơi khác', 'Áp lực sản lượng', 'Quản lý gắt', 'Đứng lâu / nặng nhọc', 'Cơm ca không hợp'];

export interface RetentionPatch {
  turnover_rate?: number | null;
  quit_stage?: string | null;
  quit_stages?: string[];
  quit_reasons?: string[];
  quit_reason_notes?: Record<string, string>;
  retention_actions?: string | null;
}

interface Props {
  turnoverRate: number | null;
  quitStages: string[];
  quitReasons: string[];
  quitReasonNotes: Record<string, string>;
  retentionActions: string | null;
  onChange: (patch: RetentionPatch) => void;
}

export default function IndustryRetention({ turnoverRate, quitStages, quitReasons, quitReasonNotes, retentionActions, onChange }: Props) {
  const [custom, setCustom] = useState('');
  // Ghi chú lý do hiện dạng popover khi rê chuột — không chiếm thêm chỗ trong layout.
  const [openNote, setOpenNote] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hoverOn = (r: string) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpenNote(r);
  };
  // Trễ một nhịp để chuột kịp đi từ chip xuống popover mà không bị đóng giữa chừng.
  const hoverOff = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenNote(null), 160);
  };

  const toggleStage = (s: string) => {
    const next = quitStages.includes(s) ? quitStages.filter(x => x !== s) : [...quitStages, s];
    // quit_stage (cột cũ) luôn = giai đoạn đầu tiên để báo cáo/dữ liệu cũ vẫn đọc được.
    onChange({ quit_stages: next, quit_stage: next[0] ?? null });
  };

  const toggle = (r: string) => onChange({
    quit_reasons: quitReasons.includes(r) ? quitReasons.filter(x => x !== r) : [...quitReasons, r],
  });
  const setNote = (r: string, note: string) => {
    const next = { ...quitReasonNotes };
    if (note.trim()) next[r] = note; else delete next[r];
    onChange({ quit_reason_notes: next });
  };
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

  // Chip lý do + popover ghi chú dùng chung cho lý do có sẵn và lý do tự thêm.
  const reasonChip = (r: string, custom: boolean) => {
    const idx = quitReasons.indexOf(r);
    const picked = idx >= 0;
    const hasNote = !!(quitReasonNotes[r] ?? '').trim();
    return (
      <span key={r} className="relative" onMouseEnter={() => picked && hoverOn(r)} onMouseLeave={hoverOff}>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition ${picked ? 'bg-rose-600 text-white' : 'bg-[#F4F3EF] text-[#666] hover:bg-[#EAE8E2]'}`}>
          <button onClick={() => toggle(r)} className="inline-flex items-center">
            {picked && <span className="mr-1 opacity-70">{idx + 1}</span>}{r}
          </button>
          {picked && hasNote && <StickyNote size={9} className="opacity-80" />}
          {custom && <button onClick={() => toggle(r)} className="hover:opacity-70"><X size={10} /></button>}
        </span>
        {picked && openNote === r && (
          <span
            onMouseEnter={() => hoverOn(r)} onMouseLeave={hoverOff}
            className="absolute left-0 top-full z-30 pt-1 block w-[260px]"
          >
            <span className="block bg-white border border-[#E8E7E2] rounded-lg shadow-lg p-2">
              <span className="block text-[10px] text-[#999] mb-1">Ghi chú chi tiết · <b className="text-[#666] font-medium">{r}</b></span>
              <textarea
                value={quitReasonNotes[r] ?? ''} onChange={e => setNote(r, e.target.value)} rows={3}
                placeholder="VD: xưởng ướp lạnh −18°C, LĐ nữ trên 35 tuổi bỏ nhiều nhất trong 2 tuần đầu."
                className="w-full text-[11px] px-1.5 py-1 rounded border border-[#E8E7E2] outline-none focus:border-blue-500 resize-none leading-snug"
              />
            </span>
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-visible">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
        <UserMinus size={13} className="text-rose-600" />
        <div className="text-[12.5px] font-semibold text-[#111]">Hồ sơ giữ chân lao động</div>
        <span className="text-[10.5px] text-[#999]">vì sao LĐ ngành này nghỉ · nói trước là ghi điểm</span>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <label className="text-[11px] text-[#888]">Tỷ lệ nghỉ việc trung bình (%/tháng)</label>
          <div className="flex items-baseline gap-2">
            <input value={turnoverRate ?? ''} onChange={e => onChange({ turnover_rate: e.target.value.trim() === '' ? null : Number(e.target.value.replace(/[^\d.]/g, '')) })}
              placeholder="12" className={`w-20 text-[16px] font-medium px-2 py-1 rounded-lg border border-[#E8E7E2] outline-none focus:border-blue-500 ${rateTone}`} />
            <span className="text-[11px] text-[#999]">{rateNote}</span>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-[#888]">Giai đoạn hay nghỉ — chọn được nhiều, thứ tự chọn là thứ tự nặng nhất</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {STAGES.map(s => {
              const idx = quitStages.indexOf(s);
              return (
                <button key={s} onClick={() => toggleStage(s)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition ${idx >= 0 ? 'bg-amber-600 text-white' : 'bg-[#F4F3EF] text-[#666] hover:bg-[#EAE8E2]'}`}>
                  {idx >= 0 && <span className="mr-1 opacity-70">{idx + 1}</span>}{s}
                </button>
              );
            })}
            {quitStages.length === 0 && <span className="text-[11px] text-[#bbb] self-center">chưa xác định</span>}
          </div>
        </div>

        <div>
          <label className="text-[11px] text-[#888]">Lý do nghỉ việc — click để chọn, thứ tự chọn là thứ tự ưu tiên · rê chuột vào lý do đã chọn để ghi chú chi tiết</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {COMMON_REASONS.map(r => reasonChip(r, false))}
            {quitReasons.filter(r => !COMMON_REASONS.includes(r)).map(r => reasonChip(r, true))}
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
