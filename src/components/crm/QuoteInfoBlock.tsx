import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { fetchIndustries } from '../../pages/market/industries';
import { useMarketRefs } from './MarketSupplyBlock';
import {
  type QuoteInfo, type QuoteInfoLine, QUOTE_UNITS, emptyLine, standardLines,
  lineTotal, normalizeQuoteInfo, quoteInfoIsEmpty,
} from '../../lib/quoteInfo';
import type { CRMPipelineEntry } from '../../lib/types';

const fmt = (n: number) => n.toLocaleString('vi-VN');
const inp = 'w-full text-[12px] px-2 py-1 border border-gray-200 rounded outline-none focus:border-blue-500 bg-white';

/**
 * "Thông tin báo giá" — khối gập/mở trong hồ sơ công ty (CRM Pipeline): điền sẵn thông tin khách,
 * các hạng mục lao động và đơn giá/phí dịch vụ để lưu lại và sau này đẩy sang file Báo giá tự động.
 * TỰ LƯU khi ngừng gõ (lưu vào crm_pipeline.quote_info, migration 156).
 */
export default function QuoteInfoBlock({ entry, onUpdate, toast }: {
  entry: CRMPipelineEntry;
  onUpdate: (e: CRMPipelineEntry) => void;
  toast: (msg: string) => void;
}) {
  const { user } = useAuth();
  const [info, setInfo] = useState<QuoteInfo>(() => normalizeQuoteInfo(entry.quote_info));
  const [open, setOpen] = useState(() => !quoteInfoIsEmpty(normalizeQuoteInfo(entry.quote_info)));
  const [status, setStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const { zones } = useMarketRefs();
  const [industries, setIndustries] = useState<string[]>([]);
  useEffect(() => { fetchIndustries().then(setIndustries); }, []);

  const latest = useRef(info); const entryRef = useRef(entry);
  entryRef.current = entry;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const lastSavedJson = useRef(JSON.stringify(normalizeQuoteInfo(entry.quote_info)));

  // Đổi sang công ty khác (cùng component được tái dùng) → nạp lại dữ liệu của công ty đó.
  useEffect(() => {
    const n = normalizeQuoteInfo(entry.quote_info);
    setInfo(n); latest.current = n; lastSavedJson.current = JSON.stringify(n);
    setOpen(!quoteInfoIsEmpty(n)); setStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  const save = async () => {
    if (inflight.current) await inflight.current.catch(() => {});
    const snapshot = latest.current;
    const json = JSON.stringify(snapshot);
    if (json === lastSavedJson.current) { setStatus(s => (s === 'pending' ? 'saved' : s)); return; }
    const run = (async () => {
      setStatus('saving');
      const payload: QuoteInfo = { ...snapshot, updated_at: new Date().toISOString() };
      const e = entryRef.current;
      const { error } = await supabase.from('crm_pipeline').update({ quote_info: payload }).eq('id', e.id);
      if (error) {
        setStatus('error');
        toast(/quote_info/.test(error.message)
          ? 'Chưa lưu được: database chưa có cột quote_info — cần chạy migration 156 trong Supabase SQL Editor'
          : 'Lỗi lưu thông tin báo giá: ' + error.message);
        return;
      }
      lastSavedJson.current = json;
      setStatus('saved');
      onUpdate({ ...e, quote_info: payload });
      await logActivity({
        user, action: 'update', table: 'crm_pipeline', recordId: e.id,
        description: `Cập nhật thông tin báo giá của "${e.company_name}" (${payload.lines.length} hạng mục)`,
        oldData: { quote_info: e.quote_info ?? null }, newData: { quote_info: payload },
      });
    })();
    inflight.current = run;
    await run;
    if (inflight.current === run) inflight.current = null;
  };

  const change = (fn: (q: QuoteInfo) => QuoteInfo) => {
    const next = fn(latest.current);
    latest.current = next; setInfo(next); setStatus('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void save(); }, 800);
  };
  // Rời ô / đóng hồ sơ → ghi nốt phần còn chờ.
  const flush = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; void save(); } };
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void save(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = <K extends keyof QuoteInfo>(k: K, v: QuoteInfo[K]) => change(q => ({ ...q, [k]: v }));
  const setLine = (id: string, patch: Partial<QuoteInfoLine>) => change(q => ({ ...q, lines: q.lines.map(l => l.id === id ? { ...l, ...patch } : l) }));
  const addLine = () => change(q => ({ ...q, lines: [...q.lines, emptyLine()] }));
  const removeLine = (l: QuoteInfoLine) => {
    const filled = l.label || l.workers || l.wage != null || l.fee != null || l.note;
    if (filled && !confirm(`Xoá hạng mục "${l.label || 'chưa đặt tên'}" khỏi bảng báo giá?`)) return;
    change(q => ({ ...q, lines: q.lines.filter(x => x.id !== l.id) }));
  };
  const numVal = (s: string): number | null => { const n = parseInt(s.replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };

  const totalWorkers = useMemo(() => info.lines.reduce((s, l) => s + (parseInt(l.workers, 10) || 0), 0), [info.lines]);
  const statusEl = status === 'saving' ? <span className="text-blue-600">Đang lưu…</span>
    : status === 'pending' ? <span className="text-[#999]">Sắp tự lưu…</span>
    : status === 'saved' ? <span className="text-emerald-600">✓ Đã lưu</span>
    : status === 'error' ? <span className="text-red-600">⚠ Chưa lưu được</span> : null;

  return (
    <div className="border border-[#E8E7E2] rounded-[10px] overflow-hidden" onBlur={flush}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-[#FAFAF8] hover:bg-[#F5F4EF] transition text-left">
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#111]">
          {open ? <ChevronDown size={13} className="text-[#999]" /> : <ChevronRight size={13} className="text-[#999]" />}
          📄 Thông tin báo giá
          {info.lines.length > 0 && <span className="text-[11px] font-normal text-blue-700">{info.lines.length} hạng mục{totalWorkers ? ` · ${fmt(totalWorkers)} LĐ` : ''}</span>}
        </span>
        <span className="text-[11px]">{statusEl}</span>
      </button>

      {open && (
        <div className="p-3 space-y-3">
          <div className="text-[11px] text-[#999]">Điền sẵn để lưu lại và chuyển sang file Báo giá tự động sau này. Tự lưu khi bạn ngừng gõ.</div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <label className="flex flex-col gap-0.5"><span className="text-[11px] text-[#888]">Mã số thuế</span>
              <input value={info.tax_code} onChange={e => setField('tax_code', e.target.value)} className={inp} /></label>
            <label className="flex flex-col gap-0.5"><span className="text-[11px] text-[#888]">Người nhận báo giá</span>
              <input value={info.contact_person} onChange={e => setField('contact_person', e.target.value)} className={inp} /></label>
            <label className="col-span-2 flex flex-col gap-0.5"><span className="text-[11px] text-[#888]">Địa chỉ</span>
              <input value={info.address} onChange={e => setField('address', e.target.value)} className={inp} /></label>
            <label className="flex flex-col gap-0.5"><span className="text-[11px] text-[#888]">SĐT người nhận</span>
              <input value={info.contact_phone} onChange={e => setField('contact_phone', e.target.value)} className={inp} /></label>
            <label className="flex flex-col gap-0.5"><span className="text-[11px] text-[#888]">Báo giá có hiệu lực đến</span>
              <input type="date" value={info.valid_until} onChange={e => setField('valid_until', e.target.value)} className={inp} /></label>
            <label className="flex flex-col gap-0.5"><span className="text-[11px] text-[#888]">Khu công nghiệp</span>
              <input list="qi-zones" value={info.zone} onChange={e => setField('zone', e.target.value)} className={inp} placeholder="Chọn / gõ KCN" />
              <datalist id="qi-zones">{zones.map(z => <option key={z} value={z} />)}</datalist></label>
            <label className="flex flex-col gap-0.5"><span className="text-[11px] text-[#888]">Ngành nghề</span>
              <input list="qi-industries" value={info.industry} onChange={e => setField('industry', e.target.value)} className={inp} placeholder="Chọn / gõ ngành" />
              <datalist id="qi-industries">{industries.map(z => <option key={z} value={z} />)}</datalist></label>
            <label className="col-span-2 flex flex-col gap-0.5"><span className="text-[11px] text-[#888]">Điều khoản thanh toán</span>
              <input value={info.payment_terms} onChange={e => setField('payment_terms', e.target.value)} className={inp} placeholder="VD: Chốt công ngày 25, thanh toán trong 5–8 ngày…" /></label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11.5px] font-semibold text-[#444]">Bảng hạng mục & đơn giá</div>
              <div className="flex items-center gap-1.5">
                {info.lines.length === 0 && (
                  <button type="button" onClick={() => change(q => ({ ...q, lines: standardLines() }))} className="text-[11px] px-2 py-1 rounded-lg border border-gray-300 text-[#555] hover:bg-gray-50">
                    Tạo sẵn 3 dòng (Phổ thông / Tay nghề / KTV)
                  </button>
                )}
                <button type="button" onClick={addLine} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50"><Plus size={11} /> Thêm dòng</button>
              </div>
            </div>
            {info.lines.length === 0 ? (
              <div className="text-center text-[11.5px] text-[#aaa] border border-dashed border-gray-200 rounded-lg py-4">Chưa có hạng mục nào</div>
            ) : (
              <div className="overflow-x-auto border border-[#EEEDE8] rounded-lg">
                <table className="w-full text-[12px] min-w-[560px]">
                  <thead><tr className="bg-[#F9F9F7] text-[10.5px] text-[#888] text-left">
                    {['Hạng mục / vị trí', 'SL LĐ', 'Đơn giá LĐ (đ)', 'Phí DV (đ)', 'Đơn vị', 'Giá báo / đv', 'Ghi chú', ''].map(h => <th key={h} className="px-2 py-1.5 font-medium whitespace-nowrap">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {info.lines.map(l => (
                      <tr key={l.id} className="border-t border-[#F0EEE9] align-top">
                        <td className="px-1.5 py-1 min-w-[110px]"><input value={l.label} onChange={e => setLine(l.id, { label: e.target.value })} placeholder="Phổ thông…" className={inp} /></td>
                        <td className="px-1.5 py-1 w-[62px]"><input inputMode="numeric" value={l.workers} onChange={e => setLine(l.id, { workers: e.target.value.replace(/[^\d]/g, '') })} className={inp} /></td>
                        <td className="px-1.5 py-1 w-[104px]"><input inputMode="numeric" value={l.wage != null ? fmt(l.wage) : ''} onChange={e => setLine(l.id, { wage: numVal(e.target.value) })} className={inp} /></td>
                        <td className="px-1.5 py-1 w-[92px]"><input inputMode="numeric" value={l.fee != null ? fmt(l.fee) : ''} onChange={e => setLine(l.id, { fee: numVal(e.target.value) })} className={inp} /></td>
                        <td className="px-1.5 py-1 w-[88px]">
                          <select value={l.unit} onChange={e => setLine(l.id, { unit: e.target.value as QuoteInfoLine['unit'] })} className={inp}>
                            {QUOTE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap font-semibold text-[#111]">{l.wage != null || l.fee != null ? fmt(lineTotal(l)) : '—'}</td>
                        <td className="px-1.5 py-1 min-w-[100px]"><input value={l.note} onChange={e => setLine(l.id, { note: e.target.value })} className={inp} /></td>
                        <td className="px-1 py-1"><button type="button" onClick={() => removeLine(l)} title="Xoá dòng" className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-600"><Trash2 size={12} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="text-[10.5px] text-[#aaa] mt-1">Giá báo / đv = Đơn giá LĐ + Phí DV (cùng cách tính ở Báo giá tự động).</div>
          </div>

          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-[#888]">Ghi chú cho báo giá</span>
            <textarea value={info.note} onChange={e => setField('note', e.target.value)} rows={2} className={`${inp} resize-y leading-relaxed`} /></label>
        </div>
      )}
    </div>
  );
}
