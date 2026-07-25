import { useEffect, useState } from 'react';
import { X, Copy, Check, ClipboardList, TrendingDown, Coins, CalendarDays, Download, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Industry, IndustryBattlecard, IndustryMetric } from '../../lib/types';

interface Props {
  industry: Industry;
  wageRangeText: string | null;
  exporting: boolean;
  onDownloadFull: () => void;
  onClose: () => void;
  toast: (m: string) => void;
}

const peakMonths = (levels: number[]) => levels.map((v, i) => ({ v, i })).filter(x => x.v >= 4).map(x => 'T' + (x.i + 1));
const tr = (v: number | null | undefined) => v != null ? (v / 1_000_000).toFixed(1) + 'tr' : null;

export default function IndustryCheatSheetModal({ industry, wageRangeText, exporting, onDownloadFull, onClose, toast }: Props) {
  const [items, setItems] = useState<IndustryBattlecard[]>([]);
  const [latestMetric, setLatestMetric] = useState<IndustryMetric | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('industry_battlecards').select('*').eq('industry_id', industry.id).order('sort_order').order('created_at'),
      supabase.from('industry_metrics').select('*').eq('industry_id', industry.id).order('period', { ascending: false }).limit(1),
    ]).then(([bcRes, metRes]) => {
      setItems((bcRes.data ?? []) as IndustryBattlecard[]);
      setLatestMetric(((metRes.data ?? []) as IndustryMetric[])[0] ?? null);
      setLoading(false);
    });
  }, [industry.id]);

  const months = peakMonths(industry.season_levels ?? []);
  const wageText = latestMetric?.avg_wage_unskilled != null || latestMetric?.avg_wage_skilled != null
    ? `PT ${tr(latestMetric.avg_wage_unskilled) ?? '—'} / Tay nghề ${tr(latestMetric.avg_wage_skilled) ?? '—'}`
    : (wageRangeText ?? '—');

  const buildCheatSheetText = () => {
    const L: string[] = [];
    L.push(`BD CHEAT-SHEET — ${industry.name}`);
    L.push('');
    L.push(`Tỷ lệ nghỉ việc TB: ${industry.turnover_rate != null ? industry.turnover_rate + '%/tháng' : '—'}`);
    L.push(`Khoảng lương phổ thông / tay nghề: ${wageText}`);
    L.push(`Tháng cao điểm tuyển dụng: ${months.length ? months.join(', ') : '—'}`);
    L.push('');
    L.push('── BATTLECARD ──');
    items.forEach((it, i) => {
      L.push('');
      L.push(`${i + 1}. Điểm đau: ${it.pain_point}`);
      L.push(`   Vũ khí: ${it.our_weapon}`);
      if (it.pitching_script) L.push(`   Lời thoại: ${it.pitching_script}`);
    });
    return L.join('\n');
  };

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(buildCheatSheetText());
      setCopied(true);
      toast('Đã copy Cheat-sheet — dán vào Zalo/Ghi chú');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Không copy được');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E8E7E2]">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-blue-600" />
            <span className="text-[13.5px] font-semibold text-[#111]">BD Cheat-Sheet — Chuẩn bị gặp khách</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-[12px] font-medium text-[#111]">{industry.name}</div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#F9F9F7] rounded-lg px-3 py-2">
              <div className="text-[10px] text-[#888] flex items-center gap-1"><TrendingDown size={10} /> Nghỉ việc TB</div>
              <div className="text-[13.5px] font-semibold text-red-600">{industry.turnover_rate != null ? industry.turnover_rate + '%/th' : '—'}</div>
            </div>
            <div className="bg-[#F9F9F7] rounded-lg px-3 py-2">
              <div className="text-[10px] text-[#888] flex items-center gap-1"><Coins size={10} /> Lương PT/Tay nghề</div>
              <div className="text-[11.5px] font-semibold text-emerald-700">{wageText}</div>
            </div>
            <div className="bg-[#F9F9F7] rounded-lg px-3 py-2">
              <div className="text-[10px] text-[#888] flex items-center gap-1"><CalendarDays size={10} /> Cao điểm tuyển</div>
              <div className="text-[12.5px] font-semibold text-blue-700">{months.length ? months.join(', ') : '—'}</div>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-medium text-[#666] mb-1.5">Battlecard</div>
            {loading && <div className="text-[11.5px] text-[#999] text-center py-3">Đang tải...</div>}
            {!loading && items.length === 0 && (
              <div className="text-[11.5px] text-[#aaa] text-center py-3">Chưa có kịch bản BD — thêm ở khối "Kịch bản tư vấn BD & Battlecard" trong hồ sơ ngành.</div>
            )}
            <div className="space-y-2">
              {items.map(it => (
                <div key={it.id} className="rounded-lg border-l-[3px] border-l-red-400 bg-[#F9F9F7] px-3 py-2">
                  {it.category && <span className="text-[9.5px] font-medium text-red-700 bg-red-50 rounded-full px-1.5 py-0.5 mb-1 inline-block">{it.category}</span>}
                  <div className="text-[11.5px] text-[#111]"><span className="font-semibold text-red-700">Điểm đau:</span> {it.pain_point}</div>
                  <div className="text-[11.5px] text-[#111] mt-0.5"><span className="font-semibold text-emerald-700">Vũ khí:</span> {it.our_weapon}</div>
                  {it.pitching_script && <div className="text-[11px] text-[#666] italic mt-0.5">"{it.pitching_script}"</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleCopyAll}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition">
              {copied ? <Check size={14} /> : <Copy size={14} />} Copy toàn bộ Cheat-sheet
            </button>
            <button onClick={onDownloadFull} disabled={exporting}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-medium border border-blue-500 text-blue-700 hover:bg-blue-50 transition disabled:opacity-60">
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Tài liệu đầy đủ (.md)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
