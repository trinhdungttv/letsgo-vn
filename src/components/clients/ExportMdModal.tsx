import { useState } from 'react';
import { X, Download, Copy, FileText, Loader2 } from 'lucide-react';
import type { Client } from '../../lib/types';
import { shiftMonth } from '../../lib/format';
import { buildClientMdExport, downloadMarkdown, type ExportResult, type ExportSections } from '../../utils/clientMdExport';

interface Props {
  client: Client;
  onClose: () => void;
  toast: (msg: string) => void;
}

const SECTION_LABELS: { key: keyof ExportSections; label: string; desc: string }[] = [
  { key: 'profile', label: 'Hồ sơ khách hàng', desc: 'Thông tin chung, chu kỳ thanh toán, liên hệ, tài liệu' },
  { key: 'labor', label: 'Lao động theo tháng', desc: 'Số LĐ chốt cuối tháng, tăng/giảm, quản lý phụ trách' },
  { key: 'finance', label: 'Tài chính (PnL)', desc: 'Doanh thu, chi phí, lợi nhuận, chia khoán từng tháng' },
  { key: 'payment', label: 'Thanh toán & công nợ', desc: 'Hạn dự kiến vs thực tế, hành vi thanh toán' },
  { key: 'crm', label: 'CRM & lịch sử', desc: 'Deals, chăm sóc, quà tặng, đổi quản lý/chi nhánh' },
];

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ExportMdModal({ client, onClose, toast }: Props) {
  const [fromMonth, setFromMonth] = useState(shiftMonth(currentMonth(), -11));
  const [toMonth, setToMonth] = useState(currentMonth());
  const [sections, setSections] = useState<ExportSections>({ profile: true, labor: true, finance: true, payment: true, crm: true });
  const [manualNotes, setManualNotes] = useState('');
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);

  const handleBuild = async () => {
    if (fromMonth > toMonth) { toast('Khoảng thời gian không hợp lệ: "Từ tháng" phải trước "Đến tháng"'); return; }
    if (!Object.values(sections).some(Boolean)) { toast('Chọn ít nhất 1 nhóm nội dung'); return; }
    setBuilding(true);
    setResult(null);
    try {
      const r = await buildClientMdExport(client, { fromMonth, toMonth, sections, manualNotes });
      setResult(r);
    } catch (e) {
      toast('Lỗi tạo báo cáo: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBuilding(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.markdown);
      toast('Đã copy nội dung Markdown — dán thẳng vào Claude được luôn');
    } catch {
      toast('Không copy được — hãy dùng nút Tải file');
    }
  };

  const pctColor = (p: number) => (p >= 90 ? 'text-emerald-600' : p >= 70 ? 'text-amber-600' : 'text-red-600');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E8E7E2]">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-blue-600" />
            <span className="text-[13.5px] font-semibold text-[#111]">Xuất báo cáo Markdown — {client.name}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#666] mb-1">Từ tháng</label>
              <input type="month" value={fromMonth} onChange={e => setFromMonth(e.target.value)}
                className="w-full text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#666] mb-1">Đến tháng</label>
              <input type="month" value={toMonth} onChange={e => setToMonth(e.target.value)}
                className="w-full text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
            </div>
          </div>

          <div>
            <div className="text-[11px] font-medium text-[#666] mb-1.5">Nội dung xuất</div>
            <div className="space-y-1.5">
              {SECTION_LABELS.map(s => (
                <label key={s.key} className="flex items-start gap-2 cursor-pointer group">
                  <input type="checkbox" checked={sections[s.key]}
                    onChange={e => setSections(prev => ({ ...prev, [s.key]: e.target.checked }))}
                    className="mt-0.5 accent-blue-600" />
                  <span className="text-[12px] text-[#333]">
                    <span className="font-medium">{s.label}</span>
                    <span className="text-[#999]"> — {s.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#666] mb-1">Ghi chú thêm (tùy chọn — sẽ chèn vào file để AI đọc)</label>
            <textarea value={manualNotes} onChange={e => setManualNotes(e.target.value)} rows={2}
              placeholder="VD: Tháng 5 khách giảm LĐ do nghỉ mùa vụ, không phải rủi ro churn..."
              className="w-full text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 resize-none" />
          </div>

          {!result && (
            <button onClick={handleBuild} disabled={building}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-60">
              {building ? <><Loader2 size={14} className="animate-spin" /> Đang tổng hợp dữ liệu...</> : <>Tạo báo cáo</>}
            </button>
          )}

          {result && (
            <div className="space-y-3">
              <div className="rounded-lg border border-[#E8E7E2] bg-[#FAFAF8] p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-semibold text-[#111]">Độ đầy đủ dữ liệu</span>
                  <span className={`text-[15px] font-bold ${pctColor(result.completenessPct)}`}>{result.completenessPct}%</span>
                </div>
                <div className="space-y-1">
                  {result.completeness.map((c, i) => (
                    <div key={i} className="text-[11px] text-[#555] flex justify-between gap-2">
                      <span>{c.label}</span>
                      <span className={c.have === c.total ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                        {c.have}/{c.total}{c.missing.length > 0 && c.missing.length <= 4 ? ` (thiếu ${c.missing.join(', ')})` : ''}
                      </span>
                    </div>
                  ))}
                </div>
                {result.completenessPct < 90 && (
                  <div className="mt-2 text-[10.5px] text-amber-700 bg-amber-50 rounded px-2 py-1">
                    ⚠ Các tháng thiếu đã được đánh dấu "chưa nhập" trong file — AI sẽ tự loại khỏi phân tích. Muốn báo cáo chính xác hơn, hãy bổ sung dữ liệu các tháng trên rồi xuất lại.
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { downloadMarkdown(result.filename, result.markdown); toast(`Đã tải ${result.filename}`); }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition">
                  <Download size={14} /> Tải file .md
                </button>
                <button onClick={handleCopy}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-medium border border-blue-500 text-blue-700 hover:bg-blue-50 transition">
                  <Copy size={14} /> Copy nội dung
                </button>
              </div>
              <button onClick={handleBuild} disabled={building} className="w-full text-[11.5px] text-[#888] hover:text-[#555] transition">
                {building ? 'Đang tổng hợp lại...' : '↻ Tạo lại với thiết lập hiện tại'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
