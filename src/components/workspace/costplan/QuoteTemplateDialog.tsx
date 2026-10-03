// "Xuất theo mẫu": 1 file Excel chứa nhiều PHIÊN BẢN báo giá (mỗi sheet 1 bản: tiếng Việt, Việt–Trung, Anh–Việt…).
// Lưu file vào thư viện của công ty 1 lần; mỗi lần báo giá chỉ cần chọn phiên bản → hệ thống điền số vào ĐÚNG sheet đó
// và trả về file chỉ có phiên bản ấy. Người chưa đăng nhập (xem qua link) chỉ dùng được kiểu "chỉ dùng lần này".
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Download, FileSpreadsheet, Loader2, Pencil, Printer, Trash2, Upload, X } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { logActivity } from '../../../lib/audit';
import {
  QUOTE_TEMPLATE_MAX_BYTES, deleteQuoteTemplate, getQuoteTemplateFile, listQuoteTemplates, saveEntity, saveQuoteTemplate, type QuoteTemplateRow,
} from '../../../lib/costPlan/api';
import {
  FILL_TOKENS, LANG_LABEL, applyEditsToTemplate, buildFillValues, fillExcelTemplate, inspectTemplate, type FillReport, type TemplateLang, type TemplateVersion,
} from '../../../lib/costPlan/excelFill';
import { DEFAULT_LAYOUT, OFFSET_RANGE, SCALE_RANGE, pickEntity, type StampLayout } from '../../../lib/costPlan/entity';
import { enhanceInk } from '../../../lib/imageInk';
import { defaultDoc, normalizeDoc, type DocDefaults, type QuoteDoc } from '../../../lib/costPlan/quoteDoc';
import { downloadBlob, printCss, renderElementToPdf } from '../../../lib/costPlan/pdf';
import { buildSheetModel, type SheetCell, type SheetModel } from '../../../lib/costPlan/sheetModel';
import type { PlanData, PlanResult } from '../../../lib/costPlan/types';
import { formatDate } from '../../../lib/format';
import { fmt } from './fields';
import EntityManager, { Slider } from './EntityManager';
import { F, Section } from './QuoteDocDialog';
import SheetPreview, { SHEET_PAGE, sheetScale } from './SheetPreview';
import { lastEntityId, rememberEntity, useEntities } from './useEntities';
import { FONT, Select, Seg, Switch, btnGhost, btnLink, btnPrimary, field, labelCls } from './ui';

const NO_VERSIONS: TemplateVersion[] = [];
const LANG_KEY = 'lgvn_quote_lang';
const readLang = (): TemplateLang | null => { try { return localStorage.getItem(LANG_KEY) as TemplateLang | null; } catch { return null; } };
const writeLang = (l: TemplateLang) => { try { localStorage.setItem(LANG_KEY, l); } catch { /* chế độ riêng tư */ } };

/** File đang xem xét (vừa tải lên, chưa quyết lưu hay chỉ dùng 1 lần). `replaceId`: thay file của bộ mẫu đã có. */
interface Pending { name: string; fileName: string; buf: ArrayBuffer; versions: TemplateVersion[]; replaceId?: string | null }

export default function QuoteTemplateDialog({ data, result, meta, planTitle, planId, defaults, readOnly, onChange, onClose }: {
  data: PlanData; result: PlanResult;
  meta?: { company?: string | null; industry?: string | null; zone?: string | null };
  planTitle: string;
  planId?: string | null;
  /** Thông tin khách lấy sẵn từ hồ sơ CRM */
  defaults?: DocDefaults;
  readOnly?: boolean;
  onChange?: (next: PlanData) => void;
  onClose: () => void;
}) {
  const { token, user } = useAuth();
  const [tpls, setTpls] = useState<QuoteTemplateRow[] | null>(token ? null : []);
  const [libErr, setLibErr] = useState<string | null>(null);
  const [tplId, setTplId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [oneOff, setOneOff] = useState<Pending | null>(null);   // file dùng 1 lần (không lưu)
  const [editing, setEditing] = useState<{ id: string; name: string; versions: TemplateVersion[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [tab, setTab] = useState<'form' | 'preview'>('form');
  const [open, setOpen] = useState<Record<string, boolean>>({ file: true, info: true, sign: true });
  const tg = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<string | null>(null);

  const load = async () => {
    if (!token) return;
    try { const list = await listQuoteTemplates(token); setTpls(list); setLibErr(null); }
    catch (e) { setTpls([]); setLibErr(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = oneOff ? null : tpls?.find(t => t.id === tplId) ?? null;
  const versions: TemplateVersion[] = oneOff ? oneOff.versions : current?.versions ?? NO_VERSIONS;

  // Mặc định: bộ mẫu mới nhất + phiên bản cùng ngôn ngữ lần trước người dùng chọn
  useEffect(() => { if (!tplId && !oneOff && tpls?.length) setTplId(tpls[0].id); }, [tpls, tplId, oneOff]);
  useEffect(() => {
    if (!versions.length) { setSheet(null); return; }
    if (sheet && versions.some(v => v.sheet === sheet)) return;
    const last = readLang();
    setSheet((versions.find(v => v.lang === last) ?? versions[0]).sheet);
  }, [versions, sheet]);

  const chosen = versions.find(v => v.sheet === sheet) ?? null;
  const usable = !!chosen && (chosen.rows > 0 || chosen.tokens > 0);

  // ── Thông tin tài liệu (cùng nguồn với hộp "Xem & xuất PDF": data.doc) ──
  const base = useRef<QuoteDoc>(defaultDoc(new Date(), { name: meta?.company ?? '', sellerName: user?.full_name ?? '', sellerEmail: user?.email ?? '', ...defaults }, 'vi'));
  const doc: QuoteDoc = useMemo(() => (data.doc && normalizeDoc(data.doc)) || base.current, [data.doc]);
  const canEdit = !readOnly && !!onChange;
  const setDoc = (p: Partial<QuoteDoc>) => { if (canEdit) onChange!({ ...data, doc: { ...doc, ...p } }); };
  const setCustomer = (p: Partial<QuoteDoc['customer']>) => setDoc({ customer: { ...doc.customer, ...p } });
  const setSeller = (p: Partial<QuoteDoc['seller']>) => setDoc({ seller: { ...doc.seller, ...p } });


  // ── Pháp nhân + chữ ký / con dấu / logo (mặc định TẮT; chỉ admin có ảnh chữ ký & con dấu) ──
  const { entities, canSign: isAdmin, loading: entLoading, err: entErr, reload: reloadEntities } = useEntities(token);
  const entity = useMemo(() => pickEntity(entities, doc.entityId, lastEntityId()), [entities, doc.entityId]);
  const [entityDlg, setEntityDlg] = useState(false);
  const chooseEntity = (id: string) => { rememberEntity(id); setDoc({ entityId: id }); };
  const [signOn, setSignOn] = useState(false);
  const [sealOn, setSealOn] = useState(false);
  const [logoOn, setLogoOn] = useState(false);
  const sigAvail = isAdmin && !!entity?.signature, sealAvail = isAdmin && !!entity?.seal, logoAvail = !!entity?.logo;
  const [layoutEdit, setLayoutEdit] = useState<StampLayout | null>(null);     // chỉnh vị trí RIÊNG cho lần xuất này
  useEffect(() => { setLayoutEdit(null); }, [entity?.id]);
  const layout = layoutEdit ?? entity?.layout ?? DEFAULT_LAYOUT;
  const editLayout = (p: Partial<StampLayout>) => setLayoutEdit({ ...layout, ...p });
  const stampWanted = (signOn && sigAvail) || (sealOn && sealAvail);
  const signHint = !token ? 'Đăng nhập để dùng chữ ký / con dấu.' : entLoading ? '' : !entity ? 'Chưa có pháp nhân — bấm “Quản lý pháp nhân” để tạo.' : !isAdmin ? 'Chỉ admin được chèn chữ ký / con dấu.' : (!entity.signature && !entity.seal) ? 'Pháp nhân này chưa có ảnh chữ ký / con dấu.' : '';

  // ── Sửa chữ trực tiếp trên bản xem trước (vd bản dịch song ngữ sai) ──
  const [editMode, setEditMode] = useState(false);
  const [cellDlg, setCellDlg] = useState<{ cell: SheetCell; texts: string[]; lead: string[] } | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, string[]>>({});       // khi chỉ xem (không lưu được vào phương án)
  const allEdits = canEdit ? doc.edits : localEdits;
  const setAllEdits = (next: Record<string, string[]>) => { if (canEdit) setDoc({ edits: next }); else setLocalEdits(next); };
  const tplKey = oneOff ? `tmp:${oneOff.fileName}` : current?.id ?? '';
  const sheetEdits = useMemo(() => {
    const out: Record<string, string[]> = {};
    if (!chosen) return out;
    const pre = `${tplKey}|${chosen.sheet}!`;
    for (const [k, v] of Object.entries(allEdits)) if (k.startsWith(pre)) out[`${chosen.sheet}!${k.slice(pre.length)}`] = v;
    return out;
  }, [allEdits, tplKey, chosen]);
  const editedAddrs = useMemo(() => new Set(Object.keys(sheetEdits).map(k => k.slice(k.indexOf('!') + 1))), [sheetEdits]);
  const tplEditCount = Object.keys(allEdits).filter(k => k.startsWith(`${tplKey}|`)).length;

  // ── Điền file + dựng xem trước (chạy lại khi đổi bất kỳ đầu vào nào, có chờ 0,3 s) ──
  const srcBuf = useRef<{ key: string; buf: ArrayBuffer } | null>(null);
  const out = useRef<{ output: ArrayBuffer; report: FillReport } | null>(null);
  const seq = useRef(0);
  const [model, setModel] = useState<SheetModel | null>(null);
  const [report, setReport] = useState<FillReport | null>(null);
  const [pvBusy, setPvBusy] = useState(false);
  const [pvErr, setPvErr] = useState<string | null>(null);

  const sourceBuf = useCallback(async (): Promise<ArrayBuffer> => {
    if (oneOff) return oneOff.buf;
    if (!current || !token) throw new Error('Chưa chọn file mẫu.');
    const key = `${current.id}:${current.updated_at}`;
    if (srcBuf.current?.key === key) return srcBuf.current.buf;
    const buf = await getQuoteTemplateFile(token, current.id);
    srcBuf.current = { key, buf };
    return buf;
  }, [oneOff, current, token]);

  const compute = useCallback(async () => {
    if (!chosen) return null;
    const my = ++seq.current;
    setPvBusy(true); setPvErr(null);
    try {
      const buf = await sourceBuf();
      // ảnh chữ ký / con dấu được làm rõ + đậm màu theo mức đã chọn (scan nhạt, mờ → giống bản ký, đóng dấu thật)
      const ent = entity && (signOn || sealOn)
        ? { ...entity, signature: await enhanceInk(entity.signature, 'sig', layout.sigInk), seal: await enhanceInk(entity.seal, 'seal', layout.sealInk) }
        : entity;
      const vals = buildFillValues(data, result, meta ?? {}, { entity: ent, doc, use: { signature: signOn && sigAvail, seal: sealOn && sealAvail, logo: logoOn && logoAvail } });
      const res = await fillExcelTemplate(buf, { ...vals, layout, edits: sheetEdits }, { sheet: chosen.sheet });
      const m = await buildSheetModel(res.output, chosen.sheet);
      if (my !== seq.current) return null;                               // đã có lần tính mới hơn
      out.current = res; setReport(res.report); setModel(m);
      return res;
    } catch (e) { if (my === seq.current) { setPvErr(e instanceof Error ? e.message : String(e)); setModel(null); out.current = null; } return null; }
    finally { if (my === seq.current) setPvBusy(false); }
  }, [chosen, sourceBuf, data, result, meta, entity, doc, signOn, sealOn, logoOn, sigAvail, sealAvail, logoAvail, layout, sheetEdits]);

  useEffect(() => {
    if (pending || editing || !chosen) return;
    const t = setTimeout(() => { compute(); }, 300);
    return () => clearTimeout(t);
  }, [compute, pending, editing, chosen]);

  // ── Xem trước thu nhỏ vừa khung + dấu ngắt trang ──
  const page = model?.landscape ? SHEET_PAGE.landscape : SHEET_PAGE.portrait;
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);
  const [pageH, setPageH] = useState<number>(SHEET_PAGE.portrait.h);
  useLayoutEffect(() => {
    const w = wrapRef.current, d = pageRef.current;
    if (!w || !d) return;
    const ro = new ResizeObserver(() => { setScale(Math.min(1, Math.max(0.3, (w.clientWidth - 8) / page.w))); setPageH(d.offsetHeight); });
    ro.observe(w); ro.observe(d);
    return () => ro.disconnect();
  }, [page.w, model]);
  const pages = Math.max(1, Math.ceil((pageH - 2) / page.h));

  // ── Tải về / in ──
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const st = document.createElement('style'); st.id = 'quote-print-style'; st.textContent = printCss(page.w, !!model?.landscape); document.head.appendChild(st);
    return () => { st.remove(); };
  }, [page.w, model?.landscape]);

  const fileBase = () => {
    const name = oneOff ? oneOff.name : current?.name ?? 'Bao gia';
    return `${name} - ${chosen?.label ?? ''} - ${doc.customer.name || meta?.company || planTitle || 'bao-gia'}${stampWanted ? ' (đã ký)' : ''}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const afterExport = (how: string) => {
    if (canEdit && !data.doc) onChange!({ ...data, doc: { ...doc } });          // chốt số báo giá / ngày
    if (chosen) writeLang(chosen.lang);
    if (stampWanted) {
      logActivity({
        user: user ?? null, action: 'update', table: 'cost_plans', recordId: planId ?? '',
        description: `${how} báo giá theo mẫu Excel ${doc.number} gửi ${doc.customer.name || '—'} có ${[signOn && sigAvail && 'chữ ký', sealOn && sealAvail && 'con dấu'].filter(Boolean).join(' + ')}`,
      });
    }
  };
  /** Luôn tính lại ngay trước khi xuất để file đúng với những gì đang chọn. Không có chỗ điền → không tải file vô nghĩa. */
  const fresh = async () => {
    const r = await compute();
    if (!r) return null;
    if (!r.report.rows.length && !r.report.tokens && !r.report.fields) { setPvErr(`Không tìm thấy chỗ để điền trong phiên bản “${chosen?.label}”. Cần cột “Đơn giá” (hoặc “Unit price” / “单价”) hoặc ô dạng {{gia_ngay}}.`); return null; }
    return r;
  };
  const doXlsx = async () => {
    setBusy('xlsx'); setError(null);
    try {
      const r = await fresh();
      if (r) { downloadBlob(new Blob([r.output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileBase()}.xlsx`); afterExport('Xuất Excel'); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };
  const waitPaint = async () => {
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const imgs = [...(hostRef.current?.querySelectorAll('img') ?? [])];
    await Promise.all(imgs.map(i => (i.decode ? i.decode().catch(() => undefined) : undefined)));
  };
  const doPdf = async () => {
    setBusy('pdf'); setError(null);
    try {
      const r = await fresh();
      if (r && hostRef.current) {
        await waitPaint();
        downloadBlob(await renderElementToPdf(hostRef.current, { landscape: !!model?.landscape }), `${fileBase()}.pdf`);
        afterExport('Xuất PDF');
      }
    } catch (e) { setError(`Không tạo được PDF: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(null);
  };
  const doPrint = async () => {
    setBusy('print'); setError(null);
    try { const r = await fresh(); if (r) { await waitPaint(); afterExport('In'); setTimeout(() => { window.print(); setBusy(null); }, 80); return; } }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  // Dấu xuống dòng đầu đoạn (tách dòng dịch khỏi dòng chính) không cho người dùng thấy/xoá nhầm — tự gắn lại khi lưu
  const openCell = (cell: SheetCell) => setCellDlg({ cell, texts: cell.raw.map(t => t.replace(/^\n+/, '')), lead: cell.raw.map(t => /^\n+/.exec(t)?.[0] ?? '') });
  const saveCell = () => {
    if (!cellDlg || !chosen) return;
    const key = `${tplKey}|${chosen.sheet}!${cellDlg.cell.addr}`;
    const next = { ...allEdits };
    const full = cellDlg.texts.map((t, i) => (cellDlg.lead[i] ?? '') + t);
    if (JSON.stringify(full) === JSON.stringify(cellDlg.cell.raw)) delete next[key]; else next[key] = full;
    setAllEdits(next); setCellDlg(null);
  };
  const resetCell = () => {
    if (!cellDlg || !chosen) return;
    const next = { ...allEdits }; delete next[`${tplKey}|${chosen.sheet}!${cellDlg.cell.addr}`];
    setAllEdits(next); setCellDlg(null);
  };
  const resetAllEdits = () => {
    if (!window.confirm(`Bỏ ${tplEditCount} chỗ đã sửa tay và quay về nội dung của mẫu?`)) return;
    const next: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(allEdits)) if (!k.startsWith(`${tplKey}|`)) next[k] = v;
    setAllEdits(next);
  };
  /** Ghi các chỗ đã sửa vào chính file mẫu → mọi báo giá sau dùng luôn bản đã sửa. Ô trống (chỗ điền thông tin) không ghi cứng vào mẫu. */
  const bakeEdits = async () => {
    const mine: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(allEdits)) if (k.startsWith(`${tplKey}|`)) mine[k.slice(tplKey.length + 1)] = v;
    if (!Object.keys(mine).length) return;
    setBusy('Đang lưu vào mẫu…'); setError(null);
    try {
      const { output, applied } = await applyEditsToTemplate(await sourceBuf(), mine);
      if (!applied.length) { setError('Những chỗ đã sửa đều là ô thông tin điền theo từng khách nên không ghi vào mẫu.'); setBusy(null); return; }
      if (oneOff) setOneOff({ ...oneOff, buf: output });
      else if (current && token) { await saveQuoteTemplate(token, { id: current.id, name: current.name, versions: current.versions, fileName: current.file_name, file: output }); srcBuf.current = null; await load(); }
      else throw new Error('Cần đăng nhập để lưu vào thư viện mẫu.');
      const gone = new Set(applied.map(k => `${tplKey}|${k}`));
      const next: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(allEdits)) if (!gone.has(k)) next[k] = v;
      setAllEdits(next);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  // ── Thư viện file mẫu ──
  /** Mẫu báo giá có sẵn của Let's Go (dựng lại từ 4 file PDF mẫu): 4 phiên bản Việt / Anh–Việt / Trung–Việt / có cột tỉ lệ. */
  const loadBuiltin = async () => {
    setError(null); setBusy('Đang dựng mẫu…');
    try {
      const { buildLetsgoTemplate, LETSGO_TEMPLATE_NAME, LETSGO_VERSIONS } = await import('../../../lib/costPlan/letsgoTemplate');
      const buf = await buildLetsgoTemplate();
      const v = (await inspectTemplate(buf)).map(x => ({ ...x, label: LETSGO_VERSIONS.find(b => b.sheet === x.sheet)?.label ?? x.label }));
      setOneOff({ name: LETSGO_TEMPLATE_NAME, fileName: 'Mau-bao-gia-LetsGo.xlsx', buf, versions: v });
      setTplId(null); setSheet(null);
    } catch (e) { setError(`Không dựng được mẫu: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(null);
  };

  // Thư viện còn trống → vào thẳng mẫu Let's Go có sẵn (không bắt người dùng tải file lên mới dùng được)
  const autoBuiltin = useRef(false);
  useEffect(() => {
    if (autoBuiltin.current || tpls === null || tpls.length > 0 || oneOff || pending) return;
    autoBuiltin.current = true;
    loadBuiltin();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (file: File, replaceId?: string | null) => {
    setError(null);
    if (!/\.xlsx$/i.test(file.name)) { setError('Chỉ đọc được file .xlsx — nếu là .xls, mở bằng Excel rồi Lưu thành .xlsx.'); return; }
    setBusy('Đang đọc file…');
    try {
      const buf = await file.arrayBuffer();
      const v = await inspectTemplate(buf);
      if (!v.length) throw new Error('File không có sheet nào hiển thị.');
      setPending({ name: file.name.replace(/\.xlsx$/i, ''), fileName: file.name, buf, versions: v, replaceId });
    } catch (e) { setError(`Không đọc được file: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(null);
  };

  const savePending = async () => {
    if (!pending || !token) return;
    setBusy('Đang lưu…'); setError(null);
    try {
      const row = await saveQuoteTemplate(token, { id: pending.replaceId, name: pending.name, versions: pending.versions, fileName: pending.fileName, file: pending.buf });
      srcBuf.current = null;
      await load(); setOneOff(null); setTplId(row.id); setSheet(null); setPending(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  const saveEditing = async () => {
    if (!editing || !token) return;
    setBusy('Đang lưu…'); setError(null);
    try { await saveQuoteTemplate(token, { id: editing.id, name: editing.name, versions: editing.versions }); await load(); setEditing(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  const remove = async () => {
    if (!current || !token) return;
    if (!window.confirm(`Xoá bộ mẫu “${current.name}” (${current.versions.length} phiên bản) khỏi thư viện? Không khôi phục được.`)) return;
    setBusy('Đang xoá…');
    try { await deleteQuoteTemplate(token, current.id); setTplId(null); setSheet(null); setModel(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  const saveLayoutDefault = async () => {
    if (!token || !entity || !layoutEdit) return;
    setBusy('Đang lưu…'); setError(null);
    try { await saveEntity(token, { id: entity.id, label: entity.label, data: entity.data, layout: layoutEdit }); await reloadEntities(); setLayoutEdit(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  const langOptions = useMemo(() => (Object.keys(LANG_LABEL) as TemplateLang[]).map(k => <option key={k} value={k}>{LANG_LABEL[k]}</option>), []);
  const status = (v: TemplateVersion) => (v.rows > 0 || v.tokens > 0)
    ? <span className="text-[#1d6b34]">Nhận {v.rows} dòng giá{v.tokens ? ` · ${v.tokens} ô đánh dấu` : ''}</span>
    : <span className="text-[#b25e00]">Chưa thấy bảng giá — cần cột “Đơn giá” hoặc ô {'{{gia_ngay}}'}</span>;

  // Trình sửa nhãn các phiên bản (gọi như hàm — KHÔNG dùng như component con, nếu không ô nhập mất focus mỗi lần gõ)
  const versionEditor = (name: string, setName: (n: string) => void, vs: TemplateVersion[], setVs: (v: TemplateVersion[]) => void) => (
    <div className="space-y-3">
      <div><span className={labelCls}>Tên bộ mẫu</span><input value={name} onChange={e => setName(e.target.value)} className={`${field} w-full`} placeholder="vd: Mẫu báo giá 2026" /></div>
      <div>
        <span className={labelCls}>Các phiên bản trong file ({vs.length}) — kiểm tra hệ thống đoán ngôn ngữ đúng chưa</span>
        <div className="space-y-2">
          {vs.map((v, i) => (
            <div key={v.sheet} className="rounded-xl bg-[#f5f5f7] p-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={14} className="text-[#86868b] shrink-0" />
                <span className="text-[12.5px] font-medium text-[#1d1d1f] truncate">Sheet “{v.sheet}”</span>
                <span className="ml-auto text-[11.5px] shrink-0">{status(v)}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Select value={v.lang} onChange={l => setVs(vs.map((x, j) => (j === i ? { ...x, lang: l as TemplateLang, label: LANG_LABEL[l as TemplateLang] } : x)))}>{langOptions}</Select>
                <input value={v.label} onChange={e => setVs(vs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={`${field} !bg-white`} placeholder="Nhãn hiển thị" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const dis = !canEdit;
  const customer = doc.customer;
  const warnings = [...(report?.imageWarnings ?? []), ...(report?.skipped.slice(0, 5) ?? [])];

  // ───────────────────────── Bên trái ─────────────────────────
  const fileSection = (
    <>
      {libErr && <div className="flex gap-2 text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-xl px-3.5 py-2.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>{libErr}</span></div>}
      {tpls === null ? (
        <div className="flex justify-center py-6"><Loader2 className="animate-spin text-[#86868b]" /></div>
      ) : oneOff ? (
        <div className="flex items-center gap-2 rounded-xl bg-[#f5f5f7] px-3.5 py-2.5">
          <FileSpreadsheet size={15} className="text-[#86868b]" /><span className="text-[13px] font-medium truncate">{oneOff.fileName}</span><span className="text-[11.5px] text-[#86868b]">dùng lần này</span>
          <span className="ml-auto flex items-center gap-3 shrink-0">
            {token && <button type="button" onClick={() => setPending(oneOff)} className="text-[12px] font-medium text-[#0071e3]">Lưu vào thư viện</button>}
            <button type="button" onClick={() => { setOneOff(null); setSheet(null); setModel(null); }} className="text-[12px] font-medium text-[#6e6e73]">Bỏ</button>
          </span>
        </div>
      ) : tpls.length > 0 ? (
        <div>
          <span className={labelCls}>Bộ mẫu</span>
          {tpls.length > 1 ? (
            <Select value={tplId ?? ''} onChange={v => { setTplId(v); setSheet(null); }}>{tpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          ) : <div className="text-[14px] font-semibold">{tpls[0].name}</div>}
          {current && <div className="mt-1 text-[11.5px] text-[#86868b]">{current.file_name} · {(current.size_bytes / 1e3).toFixed(0)} KB · cập nhật {formatDate(current.updated_at)}{current.updated_by_name ? ` bởi ${current.updated_by_name}` : ''}</div>}
        </div>
      ) : (
        <div className="rounded-xl bg-[#f5f5f7] px-4 py-5 text-center">
          <FileSpreadsheet size={22} className="mx-auto text-[#86868b] mb-1.5" />
          <div className="text-[13.5px] font-medium">{token ? 'Chưa có file mẫu nào trong thư viện' : 'Chọn file Excel mẫu của bạn'}</div>
          <div className="text-[12px] text-[#86868b] mt-0.5">Tải lên 1 file chứa các phiên bản báo giá (mỗi sheet 1 bản: tiếng Việt, Việt–Trung, Anh–Việt…)</div>
          <button type="button" disabled={!!busy} onClick={loadBuiltin} className={`${btnPrimary} mt-3`}>Dùng mẫu Let's Go có sẵn</button>
        </div>
      )}

      {versions.length > 0 && (
        <div>
          <span className={labelCls}>Chọn phiên bản báo giá</span>
          <div className="space-y-2" role="radiogroup">
            {versions.map(v => {
              const on = v.sheet === sheet;
              return (
                <button key={v.sheet} type="button" role="radio" aria-checked={on} onClick={() => setSheet(v.sheet)}
                  className={`w-full text-left rounded-xl px-4 py-2.5 transition ring-1 ${on ? 'bg-[#eef5ff] ring-[#0071e3]' : 'bg-white ring-black/10 hover:ring-black/20'}`}>
                  <div className="flex items-center gap-2.5">
                    <span className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 ${on ? 'border-[#0071e3]' : 'border-[#c7c7cc]'}`}>{on && <span className="w-2 h-2 rounded-full bg-[#0071e3]" />}</span>
                    <span className="text-[14px] font-semibold">{v.label}</span>
                    <span className="ml-auto text-[11px] text-[#86868b] truncate max-w-[40%]">sheet “{v.sheet}”</span>
                  </div>
                  <div className="mt-0.5 pl-[28px] text-[11.5px]">{status(v)}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <button type="button" disabled={!!busy} onClick={() => { replaceRef.current = null; fileRef.current?.click(); }} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#0071e3] hover:text-[#0077ed]"><Upload size={13} />{tpls && tpls.length > 0 && !oneOff ? 'Tải thêm bộ mẫu mới' : 'Tải file mẫu lên'}</button>
        {!oneOff && <button type="button" disabled={!!busy} onClick={loadBuiltin} className="text-[13px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]">Mẫu Let's Go có sẵn</button>}
        {current && token && (
          <>
            <button type="button" onClick={() => setEditing({ id: current.id, name: current.name, versions: current.versions.map(v => ({ ...v })) })} className="text-[13px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]">Sửa tên / nhãn</button>
            <button type="button" onClick={() => { replaceRef.current = current.id; fileRef.current?.click(); }} className="text-[13px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]">Thay file</button>
            <button type="button" onClick={remove} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#d70015] hover:underline"><Trash2 size={12} />Xoá</button>
          </>
        )}
      </div>
    </>
  );

  const infoSection = (
    <>
      <div className="grid grid-cols-2 gap-3">
        <F label="Số báo giá"><input disabled={dis} value={doc.number} onChange={e => setDoc({ number: e.target.value })} className={`${field} w-full`} /></F>
        <F label="Ngày báo giá"><input type="date" disabled={dis} value={doc.date} onChange={e => setDoc({ date: e.target.value })} className={`${field} w-full`} /></F>
        <F label="Hiệu lực đến"><input type="date" disabled={dis} value={doc.validUntil} onChange={e => setDoc({ validUntil: e.target.value })} className={`${field} w-full`} /></F>
      </div>
      <F label="Kính gửi (tên công ty khách)"><input disabled={dis} value={customer.name} onChange={e => setCustomer({ name: e.target.value })} className={`${field} w-full`} /></F>
      <F label="Người nhận"><input disabled={dis} value={customer.attn} placeholder="vd: Chị Lan — Phòng Nhân sự" onChange={e => setCustomer({ attn: e.target.value })} className={`${field} w-full`} /></F>
      <F label="Địa chỉ"><input disabled={dis} value={customer.address} onChange={e => setCustomer({ address: e.target.value })} className={`${field} w-full`} /></F>
      <div className="grid grid-cols-2 gap-3">
        <F label="Mã số thuế"><input disabled={dis} value={customer.taxCode} onChange={e => setCustomer({ taxCode: e.target.value })} className={`${field} w-full`} /></F>
        <F label="Điện thoại"><input disabled={dis} value={customer.phone} onChange={e => setCustomer({ phone: e.target.value })} className={`${field} w-full`} /></F>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <F label="Di động người liên hệ"><input disabled={dis} value={customer.mobile} onChange={e => setCustomer({ mobile: e.target.value })} className={`${field} w-full`} /></F>
        <F label="Email khách"><input disabled={dis} value={customer.email} onChange={e => setCustomer({ email: e.target.value })} className={`${field} w-full`} /></F>
      </div>
      <div className="pt-1 text-[11px] font-semibold text-[#6e6e73]">Người phụ trách (bên mình)</div>
      <div className="grid grid-cols-2 gap-3">
        <F label="Họ tên"><input disabled={dis} value={doc.seller.name} onChange={e => setSeller({ name: e.target.value })} className={`${field} w-full`} /></F>
        <F label="Chức vụ"><input disabled={dis} value={doc.seller.title} onChange={e => setSeller({ title: e.target.value })} className={`${field} w-full`} /></F>
        <F label="Di động"><input disabled={dis} value={doc.seller.mobile} onChange={e => setSeller({ mobile: e.target.value })} className={`${field} w-full`} /></F>
        <F label="Email"><input disabled={dis} value={doc.seller.email} onChange={e => setSeller({ email: e.target.value })} className={`${field} w-full`} /></F>
      </div>
      <div className="text-[11.5px] text-[#86868b] leading-snug">Điền vào ô trống bên phải các nhãn “Khách hàng”, “MST”, “Ngày ban hành”, “Người phụ trách”… của file mẫu (hoặc ô đánh dấu như {'{{ten_khach}}'}). Ô nào đã có chữ thì giữ nguyên.</div>
    </>
  );

  const signSection = (
    <>
      {entErr && <div className="flex gap-2 text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-xl px-3.5 py-2.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>{entErr}</span></div>}
      {!token ? <div className="text-[12.5px] text-[#86868b]">Đăng nhập để chọn pháp nhân, chữ ký và con dấu.</div> : (
        <>
          <F label="Pháp nhân gửi báo giá">
            {entities.length > 0
              ? <Select value={entity?.id ?? ''} disabled={dis} onChange={chooseEntity}>{entities.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</Select>
              : <div className="text-[12.5px] text-[#86868b]">{entLoading ? 'Đang tải…' : 'Chưa có pháp nhân nào.'}</div>}
          </F>
          {entity && <div className="text-[11.5px] text-[#86868b] leading-snug">{entity.data.name || '(chưa có tên công ty)'}{entity.data.taxCode ? ` · MST ${entity.data.taxCode}` : ''}{entity.has_signature ? ' · có chữ ký' : ''}{entity.has_seal ? ' · có con dấu' : ''}</div>}
          <div className="space-y-2.5 pt-1">
            <label className={`flex items-center gap-2 text-[13px] ${sigAvail ? '' : 'opacity-50'}`}><Switch on={signOn && sigAvail} disabled={!sigAvail} onChange={setSignOn} />Chèn chữ ký</label>
            <label className={`flex items-center gap-2 text-[13px] ${sealAvail ? '' : 'opacity-50'}`}><Switch on={sealOn && sealAvail} disabled={!sealAvail} onChange={setSealOn} />Chèn con dấu</label>
            <label className={`flex items-center gap-2 text-[13px] ${logoAvail ? '' : 'opacity-50'}`}><Switch on={logoOn && logoAvail} disabled={!logoAvail} onChange={setLogoOn} />Chèn logo <span className="text-[11.5px] text-[#86868b]">(vào ô {'{{logo}}'})</span></label>
            {signHint && <div className="text-[11.5px] text-[#86868b]">{signHint}</div>}
          </div>
          {(signOn && sigAvail || sealOn && sealAvail) && (
            <div className="rounded-xl bg-[#f5f5f7] p-3 space-y-2">
              <div className="text-[12px] font-semibold text-[#1d1d1f]">Chỉnh vị trí <span className="font-normal text-[#86868b]">— xem kết quả ngay bên phải</span></div>
              {signOn && sigAvail && (<>
                <Slider label="Chữ ký" value={layout.sigScale} min={SCALE_RANGE.min} max={SCALE_RANGE.max} step={0.05} unit="%" onChange={v => editLayout({ sigScale: v })} />
                <Slider label="Làm rõ, đậm màu" value={layout.sigInk} min={0} max={1} step={0.05} unit="%" onChange={v => editLayout({ sigInk: v })} />
                <Slider label="Sang ngang" value={layout.sigDx} min={OFFSET_RANGE.min} max={OFFSET_RANGE.max} step={2} unit="px" onChange={v => editLayout({ sigDx: v })} />
                <Slider label="Lên / xuống" value={layout.sigDy} min={OFFSET_RANGE.min} max={OFFSET_RANGE.max} step={2} unit="px" onChange={v => editLayout({ sigDy: v })} />
              </>)}
              {sealOn && sealAvail && (<>
                <Slider label="Con dấu" value={layout.sealScale} min={SCALE_RANGE.min} max={SCALE_RANGE.max} step={0.05} unit="%" onChange={v => editLayout({ sealScale: v })} />
                <Slider label="Làm rõ, đậm màu" value={layout.sealInk} min={0} max={1} step={0.05} unit="%" onChange={v => editLayout({ sealInk: v })} />
                <Slider label="Sang ngang" value={layout.sealDx} min={OFFSET_RANGE.min} max={OFFSET_RANGE.max} step={2} unit="px" onChange={v => editLayout({ sealDx: v })} />
                <Slider label="Lên / xuống" value={layout.sealDy} min={OFFSET_RANGE.min} max={OFFSET_RANGE.max} step={2} unit="px" onChange={v => editLayout({ sealDy: v })} />
              </>)}
              {layoutEdit && (
                <div className="flex gap-4 pt-1">
                  <button type="button" onClick={saveLayoutDefault} disabled={!!busy} className={btnLink + ' !text-[12px]'}>Lưu làm vị trí mặc định của pháp nhân</button>
                  <button type="button" onClick={() => setLayoutEdit(null)} className="text-[12px] font-medium text-[#6e6e73]">Hoàn tác</button>
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={() => setEntityDlg(true)} className={btnLink}>{isAdmin ? 'Quản lý pháp nhân, chữ ký, con dấu…' : 'Xem danh sách pháp nhân…'}</button>
        </>
      )}
    </>
  );

  const helpBlock = (
    <div className="border-t border-[#f2f2f4] px-5 py-3">
      <button type="button" onClick={() => setHelp(h => !h)} className="text-[12.5px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]">{help ? 'Ẩn' : 'Xem'} cách file mẫu nhận số, chữ ký, con dấu</button>
      {help && (
        <div className="mt-2 space-y-2.5 text-[12.5px] text-[#6e6e73] leading-relaxed">
          <p><b className="text-[#1d1d1f]">Mỗi sheet là một phiên bản.</b> Hệ thống tự đoán ngôn ngữ từng sheet (có chữ Hán → Việt–Trung; nhiều từ Unit price / Overtime… → Anh–Việt; còn lại → Việt) — bạn sửa lại nhãn được.</p>
          <p><b className="text-[#1d1d1f]">Tự nhận bảng giá:</b> tìm ô tiêu đề “Đơn giá” / “Unit price” / “单价”, đọc tên từng dòng (tiếng Việt, Anh hoặc Trung) rồi ghi giá vào đúng ô của dòng đó (lương cơ bản, phụ cấp ca đêm, tăng ca, BHXH, phí dịch vụ…). Dòng không nhận ra hoặc ô có công thức thì giữ nguyên và báo lại. Thông tin khách / người phụ trách điền vào ô trống bên phải nhãn tương ứng.</p>
          <p><b className="text-[#1d1d1f]">Chữ ký &amp; con dấu:</b> gõ <code className="text-[11.5px] text-[#0071e3] bg-[#eef5ff] px-1 rounded">{'{{chu_ky}}'}</code> và <code className="text-[11.5px] text-[#0071e3] bg-[#eef5ff] px-1 rounded">{'{{con_dau}}'}</code> vào ô muốn đóng (hoặc cả hai vào cùng 1 ô để dấu đè nhẹ lên chữ ký như bản ký tay). Không có ô đánh dấu thì hệ thống tự tìm khối “ĐẠI DIỆN / Giám đốc / Representative / 法定代表人” và đặt ảnh ngay dưới chức danh. Nên chừa 4–5 dòng trống ở đó.</p>
          <p><b className="text-[#1d1d1f]">Ô đánh dấu</b> (gõ trong file, có 2 dấu ngoặc nhọn):</p>
          <div className="grid grid-cols-1 gap-y-1">
            {FILL_TOKENS.map(t => <div key={t.token} className="flex gap-2 items-baseline"><code className="text-[11.5px] text-[#0071e3] bg-[#eef5ff] px-1.5 rounded shrink-0">{`{{${t.token}}}`}</code><span className="text-[11.5px]">{t.desc}</span></div>)}
          </div>
          <p className="text-[11.5px] text-[#86868b]">Chỉ đọc .xlsx. Giá vốn tổng hợp và lợi nhuận không bao giờ được ghi ra file; BHXH và Phí dịch vụ chỉ được ghi khi file mẫu có đúng dòng đó. Bản xem trước và PDF được dựng lại gần giống Excel (cùng cột, dòng, ô gộp, màu, viền, ảnh) nên có thể lệch nhẹ về phông chữ; file Excel tải về là bản gốc của bạn.</p>
        </div>
      )}
    </div>
  );

  const manage = pending || editing;
  const form = manage ? (
    <div className="p-5 space-y-4">
      {pending ? (
        <>
          {versionEditor(pending.name, n => setPending({ ...pending, name: n }), pending.versions, v => setPending({ ...pending, versions: v }))}
          <div className="flex flex-col gap-2">
            {token && <button type="button" disabled={!!busy || !pending.name.trim() || pending.buf.byteLength > QUOTE_TEMPLATE_MAX_BYTES} onClick={savePending} className={`${btnPrimary} !h-10`}>{busy ? <Loader2 size={14} className="animate-spin" /> : null}{pending.replaceId ? 'Thay file trong thư viện' : 'Lưu vào thư viện (cả công ty dùng chung)'}</button>}
            {token && pending.buf.byteLength > QUOTE_TEMPLATE_MAX_BYTES && <div className="text-[11.5px] text-[#b25e00]">File {(pending.buf.byteLength / 1e6).toFixed(1)} MB lớn hơn mức lưu được (2,5 MB) — chỉ dùng lần này, hoặc nén bớt hình trong file.</div>}
            {!pending.replaceId && <button type="button" onClick={() => { setOneOff(pending); setTplId(null); setSheet(null); setPending(null); }} className={`${btnGhost} !h-10`}>Chỉ dùng lần này (không lưu)</button>}
            <button type="button" onClick={() => setPending(null)} className="h-9 text-[13px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]">Huỷ</button>
          </div>
        </>
      ) : editing && (
        <>
          {versionEditor(editing.name, n => setEditing({ ...editing, name: n }), editing.versions, v => setEditing({ ...editing, versions: v }))}
          <div className="flex gap-2">
            <button type="button" disabled={!!busy || !editing.name.trim()} onClick={saveEditing} className={`${btnPrimary} !h-10 flex-1`}>Lưu thay đổi</button>
            <button type="button" onClick={() => setEditing(null)} className={`${btnGhost} !h-10`}>Huỷ</button>
          </div>
        </>
      )}
    </div>
  ) : (
    <div>
      <Section title="File mẫu & phiên bản" summary={chosen ? `${oneOff ? oneOff.name : current?.name ?? ''} · ${chosen.label}` : 'Chưa chọn'} open={!!open.file} onToggle={() => tg('file')}>{fileSection}</Section>
      <Section title="Thông tin điền vào mẫu" summary={`${doc.number} · ${customer.name || 'chưa có tên khách'}`} open={!!open.info} onToggle={() => tg('info')}>{infoSection}</Section>
      <Section title="Pháp nhân, chữ ký & con dấu" summary={entity ? `${entity.label}${stampWanted ? ' · đang ký' : ''}` : entLoading ? 'Đang tải…' : token ? 'Chưa có pháp nhân' : 'Cần đăng nhập'} open={!!open.sign} onToggle={() => tg('sign')}>{signSection}</Section>
      {helpBlock}
    </div>
  );

  // ───────────────────────── Bên phải: xem trước ─────────────────────────
  const preview = (
    <div ref={wrapRef} className="p-3 sm:p-5 min-h-full">
      {manage ? (
        <div className="text-center text-[13px] text-[#86868b] py-24">Kiểm tra các phiên bản trong file, rồi lưu hoặc dùng 1 lần.</div>
      ) : !chosen ? (
        <div className="text-center text-[13px] text-[#86868b] py-24">{tpls === null ? 'Đang tải…' : 'Chọn hoặc tải lên file Excel mẫu để xem báo giá.'}</div>
      ) : pvErr ? (
        <div className="max-w-md mx-auto mt-16 flex gap-2 text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-xl px-4 py-3"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>{pvErr}</span></div>
      ) : !model ? (
        <div className="flex justify-center py-24"><Loader2 className="animate-spin text-[#86868b]" /></div>
      ) : (
        <>
          <div className="mx-auto mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl bg-white/90 px-4 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" style={{ maxWidth: page.w * scale }}>
            <label className="flex items-center gap-2 text-[13px] font-medium"><Switch on={editMode} onChange={setEditMode} /><Pencil size={13} className="text-[#6e6e73]" />Sửa chữ trực tiếp</label>
            {editMode && <span className="text-[11.5px] text-[#6e6e73]">Bấm vào chữ cần sửa trên bản xem trước</span>}
            {tplEditCount > 0 && (
              <span className="ml-auto flex items-center gap-3 text-[12px]">
                <span className="rounded-full bg-[#fff4cc] px-2 py-0.5 font-medium text-[#8a5a00]">{tplEditCount} chỗ đã sửa</span>
                {!readOnly && <button type="button" disabled={!!busy} onClick={bakeEdits} title="Ghi vào file mẫu để mọi báo giá sau dùng luôn bản đã sửa" className={btnLink + ' !text-[12px]'}>Lưu vào mẫu</button>}
                <button type="button" onClick={resetAllEdits} className="text-[12px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]">Bỏ hết</button>
              </span>
            )}
          </div>
          <div className="mx-auto relative" style={{ width: page.w * scale, height: pageH * scale, opacity: pvBusy ? 0.6 : 1, transition: 'opacity .15s' }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: page.w }} className="shadow-[0_2px_20px_rgba(0,0,0,0.18)] ring-1 ring-black/5">
              <div ref={pageRef}><SheetPreview model={model} onEdit={editMode ? openCell : undefined} edited={editedAddrs} /></div>
            </div>
            {Array.from({ length: pages - 1 }, (_, k) => (
              <div key={k} className="absolute left-0 right-0 border-t border-dashed border-[#d70015]/60 pointer-events-none" style={{ top: (k + 1) * page.h * scale }}>
                <span className="absolute right-1 -top-4 text-[10px] font-medium text-[#d70015]/80 bg-white/80 px-1 rounded">hết trang {k + 1}</span>
              </div>
            ))}
          </div>
          <div className="text-center text-[11.5px] text-[#86868b] mt-3">Bản xem trước dựng lại từ file Excel của bạn · {pages} trang A4{model.landscape ? ' ngang' : ''} · sheet “{model.name}”</div>
          {report && (report.rows.length > 0 || report.tokens > 0 || report.fields > 0 || report.images.length > 0) && (
            <div className="max-w-xl mx-auto mt-3 rounded-xl bg-[#e8f8ed] text-[#1d6b34] px-4 py-2.5 text-[12px] leading-snug flex gap-2">
              <Check size={14} className="shrink-0 mt-0.5" />
              <span>Đã điền <b>{report.rows.length}</b> ô giá{report.fields ? <>, <b>{report.fields}</b> ô thông tin</> : ''}{report.tokens ? <> và <b>{report.tokens}</b> ô đánh dấu</> : ''}{report.images.length ? <> · chèn {report.images.map(i => `${i.what} (${i.where})`).join(', ')}</> : ''}. {report.rows.length ? `Kiểm tra: ${report.rows.map(r => `${r.cell}=${fmt(r.value)}`).join(' · ')}` : ''}</span>
            </div>
          )}
          {warnings.length > 0 && (
            <ul className="max-w-xl mx-auto mt-2 rounded-xl bg-[#fff8e6] text-[#8a5a00] px-4 py-2.5 text-[12px] leading-snug space-y-1">
              {warnings.map((w, i) => <li key={i} className="flex gap-2"><AlertTriangle size={12} className="shrink-0 mt-0.5" /><span>{w}</span></li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-2 sm:p-4" style={{ fontFamily: FONT }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-[1280px] h-[94vh] flex flex-col overflow-hidden text-[#1d1d1f]">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-[#f0f0f2] shrink-0">
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-semibold tracking-tight">Xuất báo giá trên file Excel của bạn</div>
              <div className="text-[12px] text-[#86868b] truncate">Điền số · chèn chữ ký, con dấu đúng chỗ · tải Excel hoặc PDF</div>
            </div>
            <div className="w-48 lg:hidden"><Seg value={tab} onChange={setTab} options={[{ value: 'form', label: 'Thiết lập' }, { value: 'preview', label: 'Xem trước' }]} /></div>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7]"><X size={17} /></button>
          </div>

          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f, replaceRef.current); replaceRef.current = null; }} />

          <div className="flex-1 min-h-0 flex">
            <div className={`${tab === 'form' ? 'block' : 'hidden'} lg:block w-full lg:w-[400px] lg:shrink-0 overflow-y-auto border-r border-[#f0f0f2]`}>
              {error && <div className="m-5 mb-0 flex gap-2 text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-xl px-3.5 py-2.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>{error}</span></div>}
              {form}
            </div>
            <div className={`${tab === 'preview' ? 'block' : 'hidden'} lg:block flex-1 min-w-0 overflow-y-auto bg-[#e8e8ed]`}>{preview}</div>
          </div>

          <div className="shrink-0 border-t border-[#f0f0f2] bg-white/90 px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="text-[11.5px] text-[#86868b]">{stampWanted ? 'Bản xuất sẽ có chữ ký / con dấu — ghi nhật ký.' : 'Chữ ký / con dấu đang tắt.'}</div>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={doPrint} disabled={!usable || !!busy || !!manage} className={`${btnGhost} !h-9`}>{busy === 'print' ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}In</button>
              <button type="button" onClick={doXlsx} disabled={!usable || !!busy || !!manage} className={`${btnGhost} !h-9`}>{busy === 'xlsx' ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}Tải Excel</button>
              <button type="button" onClick={doPdf} disabled={!usable || !!busy || !!manage} className={`${btnPrimary} !h-9 !px-5`}>{busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Tải PDF{stampWanted ? ' (đã ký/đóng dấu)' : ''}</button>
            </div>
          </div>
        </div>
      </div>

      {cellDlg && (
        <div className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center p-4" style={{ fontFamily: FONT }} onMouseDown={e => { if (e.target === e.currentTarget) setCellDlg(null); }}>
          <div className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-md p-5 text-[#1d1d1f]">
            <div className="flex items-start justify-between">
              <div><div className="text-[16px] font-semibold tracking-tight">Sửa nội dung ô {cellDlg.cell.addr}</div><div className="text-[12px] text-[#86868b]">Sheet “{chosen?.sheet}” · kiểu chữ của ô giữ nguyên</div></div>
              <button onClick={() => setCellDlg(null)} className="w-8 h-8 -mr-2 -mt-1 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7]"><X size={16} /></button>
            </div>
            <div className="mt-3 space-y-2.5">
              {cellDlg.texts.map((t, i) => (
                <label key={i} className="block">
                  {(cellDlg.cell.runs?.length ?? 0) > 1 && <span className={labelCls}>Đoạn {i + 1}{cellDlg.cell.runs![i]?.italic ? ' · chữ nghiêng (thường là bản dịch)' : ''}{cellDlg.cell.runs![i]?.bold ? ' · chữ đậm' : ''}</span>}
                  <textarea autoFocus={i === 0} rows={Math.min(6, Math.max(2, t.split('\n').length + 1))} value={t}
                    onChange={e => setCellDlg({ ...cellDlg, texts: cellDlg.texts.map((x, j) => (j === i ? e.target.value : x)) })}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveCell(); if (e.key === 'Escape') setCellDlg(null); }}
                    className={`${field} !h-auto w-full py-2.5 leading-relaxed resize-y`} style={{ fontFamily: 'Times New Roman, serif', fontSize: 15 }} />
                </label>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button type="button" onClick={saveCell} className={`${btnPrimary} !h-9`}>Lưu chỗ sửa</button>
              <button type="button" onClick={() => setCellDlg(null)} className={`${btnGhost} !h-9`}>Huỷ</button>
              {editedAddrs.has(cellDlg.cell.addr) && <button type="button" onClick={resetCell} className="ml-auto text-[12.5px] font-medium text-[#d70015] hover:underline">Khôi phục như mẫu</button>}
            </div>
            <div className="mt-2 text-[11px] text-[#86868b]">Ctrl/⌘ + Enter để lưu. Chỉ áp cho báo giá này; muốn dùng mãi thì bấm “Lưu vào mẫu” sau khi sửa.</div>
          </div>
        </div>
      )}
      {entityDlg && <EntityManager entities={entities} canSign={isAdmin} selectedId={entity?.id ?? null} onClose={() => setEntityDlg(false)} onChanged={reloadEntities} onSelect={chooseEntity} />}

      {/* Bản dùng để chụp PDF / in: ngoài màn hình khi bình thường, thành nội dung duy nhất của trang khi in */}
      {model && createPortal(<div id="quote-export-host" ref={hostRef}><SheetPreview model={model} k={sheetScale(model)} /></div>, document.body)}
    </>
  );
}
