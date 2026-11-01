// Cửa sổ "Báo cáo tổng quan lao động": chọn phạm vi / tuần chốt / số kỳ / nội dung, xem trước từng trang A4,
// tải PDF hoặc Markdown. Mở bằng nút tải nhanh thì tự xuất luôn khi dữ liệu sẵn sàng (1 cú bấm ra file).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, FileText, Copy, Loader2, BarChart3, Check, AlertTriangle } from 'lucide-react';
import { fetchLaborReportInput } from '../../lib/laborReport/fetch';
import { buildLaborReport, weekOptions, areaOptions, fmtShare, type LrInput, type LrScope } from '../../lib/laborReport/model';
import { buildLaborReportMarkdown, laborReportFileName } from '../../lib/laborReport/markdown';
import { pagesToPdf, downloadBlob } from '../../lib/laborReport/pdf';
import { usePersistedState } from '../../hooks/usePersistedState';
import { buildReportBlocks, SECTION_LABELS, ALL_SECTIONS, type ReportBlock, type ReportSections } from './ReportBlocks';
import { MeasureLayer, ReportPagesFull, ReportPreview } from './ReportPages';

export type LaborReportAutoExport = 'pdf' | 'md' | null;

interface Props {
  onClose: () => void;
  autoExport?: LaborReportAutoExport;
}

const scopeValue = (s: LrScope) => (s.kind === 'all' ? 'all' : `${s.kind}:${s.kind === 'branch' ? s.id : s.key}`);
const parseScope = (v: string): LrScope => {
  if (v.startsWith('branch:')) return { kind: 'branch', id: v.slice(7) };
  if (v.startsWith('area:')) return { kind: 'area', key: v.slice(5) };
  return { kind: 'all' };
};

function Seg({ value, options, onChange }: { value: number; options: number[]; onChange: (v: number) => void }) {
  return (
    <div className="flex bg-[#F4F3EF] rounded-lg p-0.5">
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={`flex-1 px-2 py-1 text-[12px] rounded-md ${value === o ? 'bg-white shadow-sm font-medium text-[#111]' : 'text-[#666]'}`}>{o}</button>
      ))}
    </div>
  );
}

export default function LaborReportModal({ onClose, autoExport = null }: Props) {
  const [input, setInput] = useState<LrInput | null>(null);
  const [loadError, setLoadError] = useState('');
  const [scope, setScope] = useState<LrScope>({ kind: 'all' });
  const [anchorWeek, setAnchorWeek] = useState<string>('');
  const [weeks, setWeeks] = usePersistedState<number>('lgvn_labor_report_weeks', 13);
  const [months, setMonths] = usePersistedState<number>('lgvn_labor_report_months', 12);
  const [sections, setSections] = usePersistedState<ReportSections>('lgvn_labor_report_sections', ALL_SECTIONS);
  // Kết quả dàn trang gắn với đúng bộ khối đã đo — đổi tuỳ chọn là tự đo lại.
  const [layoutState, setLayoutState] = useState<{ blocks: ReportBlock[]; pages: number[][] } | null>(null);
  const [busy, setBusy] = useState<{ kind: 'pdf' | 'md'; done: number; total: number } | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const autoDone = useRef(false);

  useEffect(() => {
    let alive = true;
    fetchLaborReportInput()
      .then(d => { if (alive) setInput(d); })
      .catch(e => { if (alive) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // Độ phủ trong ô chọn tuần tính theo đúng phạm vi đang chọn.
  const weekOpts = useMemo(() => (input ? weekOptions(input, 26, scope) : []), [input, scope]);
  const areaOpts = useMemo(() => (input ? areaOptions(input) : []), [input]);
  const branchOpts = useMemo(
    () => (input ? input.branches.map(b => ({ id: b.id, name: b.name?.trim() || '—' })).sort((a, b) => a.name.localeCompare(b.name, 'vi')) : []),
    [input],
  );
  // Gợi ý tuần gần nhất có ≥ 50% KH nhập số thật (khi tuần hiện tại còn ít người nhập).
  const suggestedWeek = useMemo(() => weekOpts.find(w => w.coverage >= 0.5) ?? null, [weekOpts]);
  const effectiveAnchor = anchorWeek || weekOpts[0]?.key || undefined;

  const report = useMemo(
    () => (input ? buildLaborReport(input, { anchorWeek: effectiveAnchor, weeks, months, scope }) : null),
    [input, effectiveAnchor, weeks, months, scope],
  );
  const blocks = useMemo(() => (report ? buildReportBlocks(report, sections) : []), [report, sections]);
  const layout = layoutState && layoutState.blocks === blocks ? layoutState.pages : null;
  const onLayout = useCallback((pages: number[][], forBlocks: ReportBlock[]) => setLayoutState({ blocks: forBlocks, pages }), []);

  const exportPdf = useCallback(async () => {
    if (!report || !hostRef.current) return;
    setStatus(null);
    const pages = [...hostRef.current.querySelectorAll<HTMLElement>('.lr-page')];
    setBusy({ kind: 'pdf', done: 0, total: pages.length });
    try {
      const blob = await pagesToPdf(pages, {
        title: `Báo cáo tổng quan lao động — ${report.scopeLabel} — ${report.anchor.label}`,
        onProgress: (done, total) => setBusy({ kind: 'pdf', done, total }),
      });
      const name = laborReportFileName(report, 'pdf');
      downloadBlob(blob, name);
      setStatus({ ok: true, text: `Đã tải ${name} (${pages.length} trang)` });
    } catch (e) {
      setStatus({ ok: false, text: 'Xuất PDF thất bại: ' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setBusy(null);
    }
  }, [report]);

  const exportMd = useCallback(() => {
    if (!report) return;
    const md = buildLaborReportMarkdown(report);
    const name = laborReportFileName(report, 'md');
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), name);
    setStatus({ ok: true, text: `Đã tải ${name}` });
  }, [report]);

  const copyMd = useCallback(async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(buildLaborReportMarkdown(report));
      setStatus({ ok: true, text: 'Đã copy nội dung Markdown — dán thẳng vào Claude / Notion / GitHub được luôn' });
    } catch {
      setStatus({ ok: false, text: 'Không copy được — hãy dùng nút Tải Markdown' });
    }
  }, [report]);

  // Tải nhanh: đợi dữ liệu + dàn trang xong (PDF cần trang đã vẽ) rồi xuất đúng 1 lần.
  useEffect(() => {
    if (!autoExport || autoDone.current || !report) return;
    if (autoExport === 'md') { autoDone.current = true; exportMd(); return; }
    if (!layout) return;
    autoDone.current = true;
    // Chờ 2 khung hình để Chart.js vẽ xong vào canvas của lớp chụp.
    requestAnimationFrame(() => requestAnimationFrame(() => { void exportPdf(); }));
  }, [autoExport, report, layout, exportPdf, exportMd]);

  const ready = !!report && !!layout;
  const anyEstimated = report ? report.anchor.coverage < 0.5 : false;

  const options = (
    <div className="space-y-4">
      <div>
        <label className="block text-[11px] font-medium text-[#666] mb-1">Phạm vi</label>
        <select value={scopeValue(scope)} onChange={e => setScope(parseScope(e.target.value))}
          className="w-full text-[12.5px] px-2.5 py-1.5 rounded-lg border border-[#E0DFDA] bg-white outline-none focus:border-blue-500">
          <option value="all">Toàn hệ thống</option>
          {branchOpts.length > 0 && <optgroup label="Chi nhánh">{branchOpts.map(b => <option key={b.id} value={`branch:${b.id}`}>{b.name}</option>)}</optgroup>}
          {areaOpts.length > 0 && <optgroup label="Khu vực">{areaOpts.map(a => <option key={a.key} value={`area:${a.key}`}>{a.name}</option>)}</optgroup>}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-[#666] mb-1">Tuần chốt báo cáo</label>
        <select value={effectiveAnchor ?? ''} onChange={e => setAnchorWeek(e.target.value)}
          className="w-full text-[12.5px] px-2.5 py-1.5 rounded-lg border border-[#E0DFDA] bg-white outline-none focus:border-blue-500">
          {weekOpts.map((w, i) => (
            <option key={w.key} value={w.key}>{w.label} · {w.range}{i === 0 ? ' (tuần này)' : ''} · {fmtShare(w.coverage)} đã nhập</option>
          ))}
        </select>
        {suggestedWeek && effectiveAnchor !== suggestedWeek.key && (weekOpts.find(w => w.key === effectiveAnchor)?.coverage ?? 1) < 0.5 && (
          <button onClick={() => setAnchorWeek(suggestedWeek.key)} className="mt-1.5 text-left text-[11px] text-blue-700 hover:underline leading-snug">
            Tuần này mới ít KH nhập số. Chọn {suggestedWeek.label} ({suggestedWeek.range}) — tuần gần nhất có {fmtShare(suggestedWeek.coverage)} KH nhập số thật?
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-[#666] mb-1">Số tuần</label>
          <Seg value={weeks} options={[8, 13, 26]} onChange={setWeeks} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-[#666] mb-1">Số tháng</label>
          <Seg value={months} options={[6, 12]} onChange={setMonths} />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-[#666] mb-1">Nội dung (luôn có trang Tổng quan)</label>
        <div className="space-y-1">
          {SECTION_LABELS.map(s => (
            <label key={s.key} className="flex items-center gap-2 text-[12.5px] text-[#333] cursor-pointer select-none">
              <input type="checkbox" checked={sections[s.key]} onChange={e => setSections({ ...sections, [s.key]: e.target.checked })} className="accent-blue-600" />
              {s.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center bg-black/40 md:p-4" onClick={() => !busy && onClose()}>
      <div className="bg-[#F4F3EF] md:rounded-xl shadow-xl w-full max-w-[1180px] h-full md:h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Thanh trên */}
        <div className="flex items-center gap-2 px-4 md:px-5 py-3 bg-white border-b border-[#E8E7E2] shrink-0">
          <BarChart3 size={17} className="text-blue-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-[#111] truncate">Báo cáo tổng quan lao động</div>
            <div className="text-[11px] text-[#888] truncate">
              {report ? `${report.scopeLabel} · tuần ${report.anchor.label} (${report.anchor.range}) · ${layout ? `${layout.length} trang A4` : 'đang dàn trang…'}` : 'Đang tải số liệu…'}
            </div>
          </div>
          <button onClick={() => setShowOptions(v => !v)} className="md:hidden h-[30px] px-2.5 text-[12px] border border-[#E8E7E2] rounded-lg">Tuỳ chọn</button>
          <button onClick={copyMd} disabled={!report || !!busy} title="Copy nội dung Markdown"
            className="hidden sm:flex h-[30px] px-2.5 text-[12px] border border-[#E8E7E2] rounded-lg bg-white hover:bg-[#F9F9F7] items-center gap-1.5 disabled:opacity-50">
            <Copy size={13} />Copy MD
          </button>
          <button onClick={exportMd} disabled={!report || !!busy}
            className="h-[30px] px-2.5 sm:px-3 text-[12px] border border-[#E8E7E2] rounded-lg bg-white hover:bg-[#F9F9F7] flex items-center gap-1.5 disabled:opacity-50">
            <FileText size={13} /><span className="hidden sm:inline">Tải</span> MD
          </button>
          <button onClick={() => void exportPdf()} disabled={!ready || !!busy}
            className="h-[30px] px-3 text-[12px] rounded-lg bg-navy text-white font-medium hover:opacity-90 flex items-center gap-1.5 disabled:opacity-50">
            {busy?.kind === 'pdf' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {busy?.kind === 'pdf' ? `${busy.done}/${busy.total}` : <><span className="hidden sm:inline">Tải</span> PDF</>}
          </button>
          <button onClick={() => !busy && onClose()} className="text-gray-400 hover:text-gray-600 ml-1"><X size={18} /></button>
        </div>

        {status && (
          <div className={`flex items-center gap-2 px-5 py-2 text-[12px] border-b shrink-0 ${status.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
            {status.ok ? <Check size={14} /> : <AlertTriangle size={14} />}{status.text}
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Tuỳ chọn */}
          <div className={`${showOptions ? 'block' : 'hidden'} md:block md:w-[290px] shrink-0 bg-white border-b md:border-b-0 md:border-r border-[#E8E7E2] p-4 overflow-y-auto max-h-[55vh] md:max-h-none`}>
            {options}
            {report && (
              <div className="mt-5 rounded-lg bg-[#F9F9F7] border border-[#EEEDE8] p-3 text-[11.5px] text-[#555] leading-relaxed">
                <div className="font-medium text-[#222] mb-1">Gồm</div>
                Tổng quan + KPI + nhận định tự động; biểu đồ tuần, tháng, cầu biến động; so sánh {report.branches.length} chi nhánh, {report.areas.length} khu vực, {report.kcns.length} KCN; {report.clients.length} khách hàng.
                <div className="mt-2"><b>PDF</b>: xem/in ngay, gửi Zalo/email. <b>Markdown</b>: biểu đồ Mermaid + bảng số — mở bằng GitHub/Obsidian/Notion hoặc đưa vào Claude để soạn slide.</div>
              </div>
            )}
          </div>

          {/* Xem trước */}
          <div className="flex-1 min-w-0 overflow-y-auto px-2 md:px-4">
            {loadError ? (
              <div className="m-6 p-4 rounded-lg bg-red-50 border border-red-200 text-[12.5px] text-red-700">Không tải được số liệu: {loadError}</div>
            ) : !report ? (
              <div className="h-full flex items-center justify-center text-[12.5px] text-[#888] gap-2"><Loader2 size={16} className="animate-spin" />Đang tải toàn bộ lịch sử lao động…</div>
            ) : (
              <>
                {anyEstimated && (
                  <div className="mt-3 mx-auto max-w-[794px] flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11.5px] text-amber-800">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    Tuần chốt mới có {report.kpis.actualClients}/{report.kpis.contributingClients} KH nhập số thật — số còn lại lấy số gần nhất (đã ghi rõ trong báo cáo).
                  </div>
                )}
                {layout ? <ReportPreview report={report} blocks={blocks} layout={layout} /> : (
                  <div className="py-16 flex items-center justify-center text-[12.5px] text-[#888] gap-2"><Loader2 size={16} className="animate-spin" />Đang dàn trang…</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Lớp đo + lớp chụp PDF (ẩn ngoài màn hình, kích thước thật) */}
      {report && !layout && <MeasureLayer blocks={blocks} onLayout={onLayout} />}
      {report && layout && (
        <div aria-hidden style={{ position: 'fixed', left: -12000, top: 0, pointerEvents: 'none' }}>
          <ReportPagesFull ref={hostRef} report={report} blocks={blocks} layout={layout} />
        </div>
      )}
    </div>
  );
}
