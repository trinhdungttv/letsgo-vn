// ============================================================================
// Nhập đầu mối từ Google Sheets / Excel vào Bảng nháp.
// ----------------------------------------------------------------------------
//   B1. Dán bảng (copy thẳng từ Google Sheets — giữ được LINK trong ô "Link") hoặc chọn file .xlsx / .csv.
//   B2. Xem trước: cột nào là gì (tự nhận theo tiêu đề / nội dung, sửa được), từng dòng được DÒ TRÙNG SĐT
//       với bảng nháp, Sale / CTV, người liên hệ của khách và chính bảng dán. Dòng trùng không nhập mới;
//       trùng bảng nháp thì (tuỳ chọn) chỉ BỔ SUNG ô còn trống — không ghi đè thông tin đã có.
// ============================================================================
import { useMemo, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import { ChevronLeft, ClipboardPaste, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { formatDateVN, todayVN } from '../../../lib/cskh/dates';
import { insertSaleLeads, patchSaleLead, type SaleLeadInput } from '../../../lib/saleLeads/api';
import {
  checkDrafts, matchAreaZones, matchCompetitor, mergeLeadPatch, type DraftCheck, type NamedItem, type PhoneOwner,
} from '../../../lib/saleLeads/match';
import {
  draftsFromGrid, findHeaderRow, formatPhoneKey, gridFromHtml, gridFromText, guessMapping, LEAD_FIELD_LABEL, LEAD_FIELDS,
  type Grid, type LeadField,
} from '../../../lib/saleLeads/parse';
import { SALE_LEAD_STATUS_LABEL } from '../../../lib/saleLeads/types';
import { Switch } from '../components/apple';
import { Sheet, SHEET_FOOTER } from '../components/Sheet';
import { chipStyle, inputCls } from '../ui';
import { ZoneChips } from './parts';
import { ownerLine } from './helpers';

type WorkBook = import('xlsx').WorkBook;

const PATCH_LABEL: Readonly<Record<string, string>> = {
  full_name: 'tên', company: 'đơn vị', channel_url: 'link kênh', post_url: 'link bài đăng', zone_ids: 'KCN', area_text: 'khu vực', note: 'ghi chú',
};

/** Màu + chữ của kết quả dò trùng từng dòng. */
function checkLook(c: DraftCheck): { color: string; text: string } {
  switch (c.kind) {
    case 'new': return { color: '#248A3D', text: 'Mới' };
    case 'no_phone': return { color: '#6E6E73', text: 'Không có SĐT — không dò trùng được' };
    case 'bad_phone': return { color: '#D70015', text: 'SĐT không đọc được (vẫn giữ chữ gốc)' };
    case 'dup_batch': return { color: '#6E6E73', text: `Trùng dòng ${c.line} trong bảng dán` };
    case 'dup_lead': return { color: '#B25000', text: `Đã có trong bảng nháp: ${ownerLine(c.owner)}` };
    case 'dup_sale': return { color: '#B25000', text: `Đã là Sale / CTV: ${ownerLine(c.owner)}` };
    case 'dup_client': return { color: '#8944AB', text: `Là người liên hệ của khách: ${ownerLine(c.owner)} — tick nếu vẫn muốn nhập` };
  }
}

/** Viên tóm tắt số dòng theo kết quả dò trùng. */
const SUMMARY: ReadonlyArray<[DraftCheck['kind'], string, string]> = [
  ['new', 'Mới', '#248A3D'],
  ['dup_lead', 'Đã có trong bảng nháp', '#B25000'],
  ['dup_sale', 'Đã là Sale / CTV', '#B25000'],
  ['dup_client', 'Người liên hệ của khách', '#8944AB'],
  ['dup_batch', 'Trùng trong bảng dán', '#6E6E73'],
  ['no_phone', 'Không có SĐT', '#6E6E73'],
  ['bad_phone', 'SĐT lạ', '#D70015'],
];

/** Dòng được nhập mới (tick được) và mặc định có tick không. */
const canInsert = (c: DraftCheck) => c.kind === 'new' || c.kind === 'no_phone' || c.kind === 'bad_phone' || c.kind === 'dup_client';
const defaultPick = (c: DraftCheck) => canInsert(c) && c.kind !== 'dup_client';

/** Lưới ô từ 1 trang tính (giữ link của ô; ô gộp dọc lặp giá trị xuống các dòng dưới). */
async function gridFromSheet(wb: WorkBook, name: string): Promise<Grid> {
  const XLSX = await import('xlsx');
  const ws = wb.Sheets[name];
  if (!ws?.['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const grid: Grid = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as { w?: string; v?: unknown; l?: { Target?: string } } | undefined;
      const text = cell ? String(cell.w ?? cell.v ?? '').replace(/\u00a0/g, ' ').trim() : '';
      const target = cell?.l?.Target ?? '';
      row.push({ text, href: /^https?:\/\//i.test(target) ? target : /^(https?:\/\/|www\.)\S+$/i.test(text) ? text : '' });
    }
    grid.push(row);
  }
  for (const m of ws['!merges'] ?? []) {
    const top = grid[m.s.r - range.s.r]?.[m.s.c - range.s.c];
    if (!top) continue;
    for (let r = m.s.r + 1; r <= m.e.r; r++) {
      const row = grid[r - range.s.r];
      if (row) row[m.s.c - range.s.c] = { ...top };
    }
  }
  return grid.filter(r => r.some(c => c.text || c.href));
}

export function LeadImportSheet({ zones, competitors, phoneIndex, toast, onClose, onSaved }: {
  zones: readonly NamedItem[];
  competitors: readonly NamedItem[];
  phoneIndex: ReadonlyMap<string, PhoneOwner[]>;
  toast: (m: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [grid, setGrid] = useState<Grid | null>(null);
  const [headerIdx, setHeaderIdx] = useState(-1);
  const [mapping, setMapping] = useState<LeadField[]>([]);
  const [source, setSource] = useState('');
  const [typed, setTyped] = useState('');
  const [picks, setPicks] = useState<Record<number, boolean>>({});
  const [merge, setMerge] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const wbRef = useRef<{ wb: WorkBook; names: string[]; file: string } | null>(null);
  const [sheetName, setSheetName] = useState('');

  const load = (g: Grid, label: string) => {
    if (!g.length) { setError('Không đọc được dòng nào — bôi đen cả bảng trên Google Sheets rồi copy lại'); return; }
    const h = findHeaderRow(g);
    setGrid(g);
    setHeaderIdx(h);
    setMapping(guessMapping(g, h));
    setPicks({});
    setSource(label);
    setError('');
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const g = (html && gridFromHtml(html)) || gridFromText(text);
    if (!g.length) return;   // để chữ dán vào ô như bình thường
    e.preventDefault();
    wbRef.current = null;
    load(g, `Dán từ bảng ${formatDateVN(todayVN())}`);
  };

  const readFile = async (f: File) => {
    setError('');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const names = wb.SheetNames;
      const grids = await Promise.all(names.map(n => gridFromSheet(wb, n)));
      // Trang tính đầu tiên có dòng tiêu đề nhận ra được, không thì trang đầu có dữ liệu
      let idx = grids.findIndex(g => findHeaderRow(g) >= 0);
      if (idx < 0) idx = Math.max(0, grids.findIndex(g => g.length > 0));
      wbRef.current = { wb, names, file: f.name };
      setSheetName(names[idx] ?? '');
      load(grids[idx] ?? [], `File ${f.name}${names.length > 1 ? ` · ${names[idx]}` : ''}`);
    } catch (e) {
      setError('Không đọc được file: ' + (e as Error).message);
    }
  };

  const switchSheet = async (name: string) => {
    const ref = wbRef.current;
    if (!ref) return;
    setSheetName(name);
    load(await gridFromSheet(ref.wb, name), `File ${ref.file} · ${name}`);
  };

  const parsed = useMemo(() => (grid ? draftsFromGrid(grid, headerIdx, mapping) : { drafts: [], lostLinks: 0 }), [grid, headerIdx, mapping]);
  const { drafts } = parsed;
  const checks = useMemo(() => checkDrafts(drafts, phoneIndex), [drafts, phoneIndex]);
  const zoneHits = useMemo(() => drafts.map(d => matchAreaZones(d.areaText, zones)), [drafts, zones]);
  const patches = useMemo(() => drafts.map((d, i) => {
    const c = checks[i];
    return c.kind === 'dup_lead' && c.owner.lead ? mergeLeadPatch(c.owner.lead, d, zoneHits[i].ids) : null;
  }), [drafts, checks, zoneHits]);

  const picked = (i: number) => canInsert(checks[i]) && (picks[i] ?? defaultPick(checks[i]));
  const insertIdx = drafts.map((_, i) => i).filter(picked);
  const mergeIdx = merge ? drafts.map((_, i) => i).filter(i => patches[i]) : [];
  const counts = checks.reduce<Record<string, number>>((m, c) => ({ ...m, [c.kind]: (m[c.kind] ?? 0) + 1 }), {});
  const colsUsed = grid ? Array.from({ length: mapping.length }, (_, c) => c).filter(c => grid.some(r => r[c]?.text || r[c]?.href)) : [];

  const save = async () => {
    if (!insertIdx.length && !mergeIdx.length) return;
    setSaving(true);
    setError('');
    let added = 0;
    let merged = 0;
    try {
      const inputs: SaleLeadInput[] = insertIdx.map(i => {
        const d = drafts[i];
        return {
          fullName: d.fullName, phone: d.phone, company: d.company, zoneIds: zoneHits[i].ids, areaText: d.areaText,
          channelUrl: d.channelUrl, postUrl: d.postUrl, note: d.note, status: d.status ?? 'new',
        };
      });
      added = await insertSaleLeads(inputs, user, source.trim());
      for (const i of mergeIdx) {
        const c = checks[i];
        if (c.kind !== 'dup_lead') continue;
        await patchSaleLead(c.owner.id, patches[i] as Record<string, unknown>, user);
        merged++;
      }
      const skipped = drafts.length - insertIdx.length - mergeIdx.length;
      toast(`Đã nhập ${added} đầu mối mới${merged ? ` · bổ sung ${merged} dòng đã có` : ''}${skipped ? ` · bỏ qua ${skipped} dòng trùng / không chọn` : ''}`);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
      if (added || merged) onSaved();
    }
  };

  // ── Bước 1: dán / chọn file ──
  if (!grid) {
    return (
      <Sheet label="Nhập đầu mối từ Google Sheets / Excel" onClose={onClose} wide>
        <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] pr-10">Nhập từ Google Sheets / Excel</h2>
        <ol className="mt-2 text-[13px] text-[#3C3C43] leading-relaxed list-decimal pl-5">
          <li>Trên Google Sheets, bôi đen cả bảng — nên lấy cả dòng tiêu đề (STT · TÊN · SĐT · TÌNH TRẠNG · KHU VỰC · LINK KÊNH · LINK BÀI ĐĂNG · GHI CHÚ).</li>
          <li>Bấm <b>Ctrl + C</b> (Mac: <b>⌘ + C</b>).</li>
          <li>Bấm vào ô dưới đây rồi <b>Ctrl + V</b> (⌘ + V). Link trong ô «Link» được giữ nguyên.</li>
        </ol>
        <div className="mt-3 relative">
          <ClipboardPaste size={18} className="absolute left-4 top-4 text-[#0071E3] pointer-events-none" />
          <textarea value={typed} onChange={e => setTyped(e.target.value)} onPaste={onPaste} rows={5} aria-label="Ô dán bảng"
            placeholder="Bấm vào đây rồi dán bảng (Ctrl + V / ⌘ + V)… Chỉ có danh sách SĐT cũng dán được — mỗi số 1 dòng."
            className="w-full rounded-[14px] border-2 border-dashed border-[#0071E3]/35 bg-[#0071E3]/[0.04] pl-11 pr-4 py-3.5 text-[13px] text-[#1D1D1F] placeholder:text-[#6E8DB5] outline-none focus:border-[#0071E3] focus:bg-white transition resize-y" />
        </div>
        {typed.trim() && (
          <button type="button" onClick={() => load(gridFromText(typed), `Gõ tay ${formatDateVN(todayVN())}`)}
            className="mt-2 h-9 px-4 rounded-full text-[13px] font-semibold text-white bg-[#0071E3] hover:bg-[#0077ED] transition">Đọc bảng</button>
        )}
        <div className="my-4 flex items-center gap-3 text-[12px] text-[#86868B]"><span className="flex-1 h-px bg-[#E5E5EA]" />hoặc<span className="flex-1 h-px bg-[#E5E5EA]" /></div>
        <label className="flex items-center gap-3 rounded-[14px] bg-white md:bg-[#F5F5F7] px-4 py-3 cursor-pointer hover:bg-black/[0.03] transition">
          <span className="w-9 h-9 rounded-[10px] bg-[#34C759] text-white flex items-center justify-center shrink-0"><FileSpreadsheet size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium text-[#1D1D1F]">Chọn file .xlsx / .xls / .csv</span>
            <span className="block text-[12px] text-[#86868B]">Google Sheets → Tệp → Tải xuống → Microsoft Excel (.xlsx) — giữ được link</span>
          </span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }} />
        </label>
        <p className="mt-3 text-[12px] text-[#86868B] leading-snug">
          Cột tự nhận theo tiêu đề; thiếu cột nào cũng được. Mỗi dòng được dò trùng SĐT với bảng nháp, danh sách Sale / CTV
          và người liên hệ của khách — xem trước rồi mới lưu.
        </p>
        {error && <p className="mt-3 text-[13px] text-[#D70015]">{error}</p>}
      </Sheet>
    );
  }

  // ── Bước 2: xem trước ──
  const SHOW = 300;
  return (
    <Sheet label="Xem trước đầu mối sẽ nhập" onClose={onClose} wide="xl">
      <button type="button" onClick={() => { setGrid(null); setError(''); }} className="hidden md:inline-flex items-center gap-0.5 -ml-1 text-[13px] font-medium text-[#0066CC] hover:opacity-70">
        <ChevronLeft size={16} /> Dán bảng khác
      </button>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] pr-10 mt-1">Xem trước · {drafts.length} dòng</h2>
      <p className="text-[13px] text-[#6E6E73] mt-0.5">
        {headerIdx >= 0 ? `Nhận cột theo dòng tiêu đề (dòng ${headerIdx + 1}).` : 'Không thấy dòng tiêu đề — đã đoán cột theo nội dung, kiểm tra lại bên dưới.'}
        <button type="button" onClick={() => { setGrid(null); setError(''); }} className="md:hidden ml-1 text-[#0066CC] font-medium">Dán bảng khác</button>
      </p>

      {parsed.lostLinks > 0 && (
        <p className="mt-3 rounded-[12px] bg-[#FF9500]/[0.12] px-3.5 py-2.5 text-[12.5px] leading-snug text-[#7A3E00]">
          {parsed.lostLinks} ô «Link» không có đường dẫn — bảng được dán dạng chữ thường nên mất link. Copy lại thẳng từ Google Sheets
          (không qua Zalo / Notepad) hoặc tải file .xlsx rồi chọn file.
        </p>
      )}

      {/* Cột → trường */}
      <section className="mt-4">
        <div className="flex items-center justify-between gap-2 px-1 mb-1.5">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B]">Cột trong bảng</h3>
          {wbRef.current && wbRef.current.names.length > 1 && (
            <select value={sheetName} onChange={e => void switchSheet(e.target.value)} aria-label="Trang tính"
              className="h-8 rounded-full bg-[rgba(118,118,128,0.12)] px-3 text-[12.5px] font-medium outline-none">
              {wbRef.current.names.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-[14px] bg-white md:bg-[#F5F5F7] p-3">
          {colsUsed.map(c => {
            const head = headerIdx >= 0 ? grid[headerIdx][c]?.text : '';
            const sample = grid.slice(headerIdx + 1).map(r => r[c]?.text).find(Boolean) ?? '';
            return (
              <label key={c} className="min-w-0">
                <span className="block text-[11.5px] text-[#86868B] truncate" title={head || sample}>Cột {c + 1}: {head || <i>{sample || 'trống'}</i>}</span>
                <select value={mapping[c]} aria-label={`Cột ${c + 1} là`}
                  onChange={e => { const next = [...mapping]; next[c] = e.target.value as LeadField; setMapping(next); setPicks({}); }}
                  className={`${inputCls} !py-1.5 ${mapping[c] === 'skip' ? 'text-[#86868B]' : 'font-medium'}`}>
                  {LEAD_FIELDS.map(f => <option key={f} value={f}>{LEAD_FIELD_LABEL[f]}</option>)}
                </select>
              </label>
            );
          })}
        </div>
        {!mapping.includes('phone') && <p className="mt-1.5 px-1 text-[12.5px] text-[#D70015]">Chưa có cột SĐT — chọn cột SĐT để dò trùng.</p>}
      </section>

      {/* Tóm tắt dò trùng */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {SUMMARY.filter(([k]) => counts[k]).map(([k, label, color]) => (
          <span key={k} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-medium" style={chipStyle(color)}>
            {label} <b className="tabular-nums">{counts[k]}</b>
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
        <label>
          <span className="block text-[12px] font-medium text-[#6E6E73] mb-1">Ghi nguồn (để sau biết dòng nào nhập từ đâu)</span>
          <input value={source} onChange={e => setSource(e.target.value)} className={inputCls} placeholder="VD: Sheet Đầu mối tuyển dụng VSIP" />
        </label>
        {(counts.dup_lead ?? 0) > 0 && (
          <Switch checked={merge} onChange={setMerge}
            label={<span className="leading-snug">Bổ sung ô còn trống của đầu mối đã có <span className="text-[#86868B]">(KCN, link, ghi chú — không ghi đè)</span></span>} />
        )}
      </div>

      {/* Từng dòng */}
      <ul className="mt-3 rounded-[14px] bg-white md:bg-[#F5F5F7] px-3 md:px-4 divide-y divide-[#E5E5EA]">
        {drafts.slice(0, SHOW).map((d, i) => {
          const c = checks[i];
          const look = checkLook(c);
          const can = canInsert(c);
          const comp = d.company ? matchCompetitor(d.company, competitors) : null;
          const patch = patches[i];
          return (
            <li key={i} className={`py-2.5 flex items-start gap-3 ${!can && !(merge && patch) ? 'opacity-60' : ''}`}>
              <input type="checkbox" className="mt-1 w-4 h-4 accent-[#0071E3] shrink-0" disabled={!can} checked={picked(i)}
                onChange={e => setPicks(p => ({ ...p, [i]: e.target.checked }))} aria-label={`Nhập dòng ${d.line}`} />
              <span className="w-7 shrink-0 text-[12px] text-[#86868B] tabular-nums pt-0.5">{d.line}</span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
                  <b className="font-semibold text-[#1D1D1F]">{d.fullName || <i className="font-normal text-[#86868B]">chưa ghi tên</i>}</b>
                  <span className="tabular-nums text-[#3C3C43]">{d.phoneKeys.length ? d.phoneKeys.map(formatPhoneKey).join(', ') : d.phone}</span>
                  {d.company && <span className="text-[#6E6E73]">· {d.company}</span>}
                  {comp && <span className="px-1.5 rounded-full text-[11px] font-medium bg-[#FF9500]/[0.14] text-[#B25000]" title={`Đối thủ: ${comp.name}`}>đối thủ</span>}
                  {d.status && <span className="text-[12px] text-[#6E6E73]">· {SALE_LEAD_STATUS_LABEL[d.status]}</span>}
                </div>
                {(d.areaText || zoneHits[i].ids.length > 0) && <ZoneChips zoneIds={zoneHits[i].ids} areaText={d.areaText} zones={zones} max={8} />}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[#6E6E73]">
                  {d.channelUrl && <a href={d.channelUrl} target="_blank" rel="noreferrer" className="text-[#0066CC] hover:underline">Link kênh</a>}
                  {d.postUrl && <a href={d.postUrl} target="_blank" rel="noreferrer" className="text-[#0066CC] hover:underline">Link bài đăng</a>}
                  {d.note && <span className="whitespace-pre-line">{d.note}</span>}
                </div>
                <p className="text-[12px] font-medium leading-snug" style={{ color: look.color }}>
                  {look.text}
                  {c.kind === 'dup_lead' && (merge
                    ? (patch ? ` → sẽ bổ sung ${Object.keys(patch).map(k => PATCH_LABEL[k] ?? k).join(', ')}` : ' → không có gì mới')
                    : ' → bỏ qua')}
                </p>
              </div>
            </li>
          );
        })}
        {drafts.length === 0 && <li className="py-8 text-center text-[13px] text-[#86868B]">Không có dòng nào có tên hoặc SĐT — kiểm tra lại cột ở trên.</li>}
        {drafts.length > SHOW && <li className="py-2.5 text-center text-[12.5px] text-[#86868B]">… và {drafts.length - SHOW} dòng nữa (vẫn được nhập theo cùng quy tắc)</li>}
      </ul>

      {error && <p className="mt-3 text-[13px] text-[#D70015]">{error}</p>}

      <div className={`${SHEET_FOOTER} mt-4 flex flex-wrap items-center gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <span className="flex-1 min-w-[180px] text-[12.5px] text-[#6E6E73]">
          Thêm <b className="text-[#1D1D1F]">{insertIdx.length}</b> mới
          {mergeIdx.length > 0 && <> · bổ sung <b className="text-[#1D1D1F]">{mergeIdx.length}</b></>}
          {' · '}bỏ qua {drafts.length - insertIdx.length - mergeIdx.length}
        </span>
        <button type="button" onClick={onClose} className="h-10 md:h-9 px-4 rounded-full text-[13px] font-medium text-[#1D1D1F] bg-black/[0.05] hover:bg-black/[0.08] transition">Huỷ</button>
        <button type="button" onClick={save} disabled={saving || (!insertIdx.length && !mergeIdx.length)}
          className="h-10 md:h-9 px-5 rounded-full text-[13px] font-semibold text-white bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 transition">
          {saving ? 'Đang lưu…' : 'Nhập vào bảng nháp'}
        </button>
      </div>
    </Sheet>
  );
}
