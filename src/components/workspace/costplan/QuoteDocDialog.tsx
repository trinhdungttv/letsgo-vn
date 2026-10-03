// "Xem & xuất PDF": dựng TÀI LIỆU BÁO GIÁ khổ A4 từ phương án, xem trước ngay trên app, sửa từng trường, rồi xuất PDF
// (có tuỳ chọn chèn chữ ký người đại diện + con dấu để gửi bản mềm luôn) hoặc in.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronRight, Download, Loader2, Printer, X } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { logActivity } from '../../../lib/audit';
import { computePriceList, includedNoteAuto, normalizeQuoteSheet } from '../../../lib/costPlan/quoteSheet';
import {
  DOC_LANGS, defaultDoc, docFileName, docIssues, emptyProfile, normalizeDoc, resolveDoc, type DocDefaults, type DocLang, type QuoteDoc,
} from '../../../lib/costPlan/quoteDoc';
import { downloadBlob, renderElementToPdf } from '../../../lib/costPlan/pdf';
import { DEFAULT_LAYOUT, pickEntity } from '../../../lib/costPlan/entity';
import type { PlanData, PlanResult, QuoteSheet } from '../../../lib/costPlan/types';
import QuoteDocument, { A4_H, A4_W } from './QuoteDocument';
import { MoneyInput, fmt } from './fields';
import EntityManager from './EntityManager';
import { lastEntityId, rememberEntity, useEntities } from './useEntities';
import { useInk } from './useInk';
import { FONT, Select, Seg, Switch, btnGhost, btnLink, btnPrimary, field, labelCls } from './ui';

const LANG_KEY = 'lgvn_doc_lang';
const readLang = (): DocLang => { try { const v = localStorage.getItem(LANG_KEY); return v === 'zh' || v === 'en' ? v : 'vi'; } catch { return 'vi'; } };
const writeLang = (l: DocLang) => { try { localStorage.setItem(LANG_KEY, l); } catch { /* chế độ riêng tư */ } };

const PRINT_CSS = `
#quote-export-host{position:fixed;left:-10000px;top:0;width:${A4_W}px;pointer-events:none}
@media print{
  body > *:not(#quote-export-host){display:none!important}
  #quote-export-host{position:static!important;left:auto!important;width:210mm!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{size:A4;margin:0}
}`;

export function Section({ title, summary, open, onToggle, children }: { title: string; summary?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border-b border-[#f0f0f2] last:border-0">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-2 px-5 py-3 text-left">
        <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-[#1d1d1f]">{title}</div>{!open && summary && <div className="text-[11.5px] text-[#86868b] truncate">{summary}</div>}</div>
        <ChevronRight size={15} className={`text-[#86868b] transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="px-5 pb-4 space-y-3">{children}</div>}
    </div>
  );
}
export const F = ({ label, children }: { label: string; children: ReactNode }) => <label className="block"><span className={labelCls}>{label}</span>{children}</label>;

/** Ô chữ có "câu mặc định": để trống = dùng câu mặc định của ngôn ngữ đang chọn (hiện mờ làm gợi ý). */
function Override({ value, onChange, placeholder, rows = 3, disabled }: { value: string | null; onChange: (v: string | null) => void; placeholder: string; rows?: number; disabled?: boolean }) {
  return (
    <div>
      <textarea rows={rows} disabled={disabled} value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value.trim() === '' ? null : e.target.value)} className={`${field} !h-auto w-full py-2.5 leading-relaxed resize-y`} />
      {value != null && !disabled && <button type="button" onClick={() => onChange(null)} className={btnLink + ' !text-[12px]'}>Dùng lại câu mặc định</button>}
    </div>
  );
}

export default function QuoteDocDialog({ data, result, meta, planId, defaults, readOnly, onChange, onClose }: {
  data: PlanData; result: PlanResult;
  meta?: { company?: string | null; industry?: string | null; zone?: string | null };
  planId?: string | null;
  /** Thông tin khách lấy sẵn từ hồ sơ CRM */
  defaults?: DocDefaults;
  readOnly?: boolean;
  onChange: (next: PlanData) => void;
  onClose: () => void;
}) {
  const { token, user } = useAuth();
  const base = useRef<QuoteDoc>(defaultDoc(new Date(), { name: meta?.company ?? '', ...defaults }, readLang()));
  const doc: QuoteDoc = (data.doc && normalizeDoc(data.doc)) || base.current;
  const q = normalizeQuoteSheet(data.quote);

  const setDoc = (p: Partial<QuoteDoc>) => { if (!readOnly) onChange({ ...data, doc: { ...doc, ...p } }); };
  const setCustomer = (p: Partial<QuoteDoc['customer']>) => setDoc({ customer: { ...doc.customer, ...p } });
  const setQuote = (nq: QuoteSheet) => { if (!readOnly) onChange({ ...data, quote: nq }); };

  // ── Pháp nhân gửi báo giá (mỗi pháp nhân có thông tin, logo, chữ ký, con dấu, cách căn riêng) ──
  const { entities, canSign: isAdmin, loading: entLoading, err: profErr, reload: reloadEntities } = useEntities(token);
  const entity = useMemo(() => pickEntity(entities, doc.entityId, lastEntityId()), [entities, doc.entityId]);
  const [entityDlg, setEntityDlg] = useState(false);
  const effData = entity?.data ?? emptyProfile();
  const effLogo = entity?.logo ?? null;
  const effSig = entity?.signature ?? null;
  const effSeal = entity?.seal ?? null;
  const layout = entity?.layout ?? DEFAULT_LAYOUT;
  const chooseEntity = (id: string) => { rememberEntity(id); setDoc({ entityId: id }); };

  // ── Chữ ký / con dấu: mặc định TẮT, bật chủ động. Chỉ admin có ảnh. ──
  const [signOn, setSignOn] = useState(false);
  const [sealOn, setSealOn] = useState(false);
  const sigAvail = isAdmin && !!effSig;
  const sealAvail = isAdmin && !!effSeal;
  const signHint = !token ? 'Đăng nhập để dùng chữ ký / con dấu.' : entLoading ? '' : !entity ? 'Chưa có pháp nhân — tạo ở mục “Pháp nhân & chữ ký”.' : !isAdmin ? 'Chỉ admin được chèn chữ ký / con dấu.' : (!effSig && !effSeal) ? 'Pháp nhân này chưa có ảnh chữ ký / con dấu.' : '';

  // ── Tài liệu ──
  const view = useMemo(() => resolveDoc(doc, data, result, effData, { industry: meta?.industry }), [doc, data, result, effData, meta?.industry]);
  const defView = useMemo(() => resolveDoc({ ...doc, title: null, intro: null, serviceLines: null, closing: null }, data, result, effData, { industry: meta?.industry }), [doc, data, result, effData, meta?.industry]);
  const issues = useMemo(() => docIssues(doc, view, effData, { sign: signOn && sigAvail, seal: sealOn && sealAvail }), [doc, view, effData, signOn, sealOn, sigAvail, sealAvail]);
  const rows = useMemo(() => computePriceList(data, result).rows, [data, result]);
  const showSig = signOn && sigAvail, showSeal = sealOn && sealAvail;
  const inkSig = useInk(effSig, 'sig', layout.sigInk), inkSeal = useInk(effSeal, 'seal', layout.sealInk);
  const images = { logo: effLogo, signature: inkSig, seal: inkSeal };
  const bi2 = (b: { a: string; b?: string }) => (b.b ? `${b.a}\n${b.b}` : b.a);

  // ── Xem trước (thu nhỏ vừa khung) + dấu ngắt trang ──
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);
  const [docH, setDocH] = useState(A4_H);
  useLayoutEffect(() => {
    const w = wrapRef.current, d = docRef.current;
    if (!w || !d) return;
    const ro = new ResizeObserver(() => { setScale(Math.min(1, Math.max(0.3, (w.clientWidth - 8) / A4_W))); setDocH(d.offsetHeight); });
    ro.observe(w); ro.observe(d);
    return () => ro.disconnect();
  }, []);
  const pages = Math.max(1, Math.ceil((docH - 2) / A4_H));
  const [fit, setFit] = useState(1);
  const [autoFit, setAutoFit] = useState(true);

  // ── Xuất PDF / In ──
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const st = document.createElement('style'); st.id = 'quote-print-style'; st.textContent = PRINT_CSS; document.head.appendChild(st);
    return () => { st.remove(); };
  }, []);
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'form' | 'preview'>('form');
  const [open, setOpen] = useState<Record<string, boolean>>({ basic: true, customer: true });
  const tg = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const guard = (): boolean => {
    const errs = issues.filter(i => i.level === 'error');
    return !errs.length || window.confirm(`Còn ${errs.length} lỗi chưa sửa:\n• ${errs.map(e => e.text).join('\n• ')}\n\nVẫn xuất?`);
  };
  const afterExport = (how: string) => {
    if (!readOnly && !data.doc) onChange({ ...data, doc: { ...doc } });          // chốt số báo giá / ngày để lần sau mở lại vẫn thế
    writeLang(doc.lang);
    if (showSig || showSeal) {
      logActivity({
        user: user ?? null, action: 'update', table: 'cost_plans', recordId: planId ?? '',
        description: `${how} báo giá ${view.number} gửi ${view.customer.name || '—'} có ${[showSig && 'chữ ký', showSeal && 'con dấu'].filter(Boolean).join(' + ')}`,
      });
    }
  };
  const exportPdf = async () => {
    if (!hostRef.current || !guard()) return;
    setBusy('pdf'); setErr(null);
    try { downloadBlob(await renderElementToPdf(hostRef.current), docFileName(view)); afterExport('Xuất PDF'); }
    catch (e) { setErr(`Không tạo được PDF: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(null);
  };
  const print = () => {
    if (!guard()) return;
    setBusy('print'); setErr(null);
    afterExport('In');
    setTimeout(() => { window.print(); setBusy(null); }, 80);
  };

  const patchRow = (id: string, p: Partial<QuoteSheet['rows'][number]>) => setQuote({ ...q, rows: q.rows.map(r => (r.id === id ? { ...r, ...p } : r)) });
  const dis = !!readOnly;
  const customer = doc.customer;

  const form = (
    <div className="divide-y-0">
      {issues.length > 0 && (
        <div className="m-5 mb-2 rounded-xl bg-[#fff8e6] px-4 py-3 space-y-1">
          <div className="text-[12.5px] font-semibold text-[#8a5a00]">Cần xem lại trước khi gửi ({issues.length})</div>
          {issues.map((i, k) => <div key={k} className={`flex gap-2 text-[12px] leading-snug ${i.level === 'error' ? 'text-[#b3140a]' : 'text-[#8a5a00]'}`}><AlertTriangle size={12} className="shrink-0 mt-0.5" /><span>{i.text}</span></div>)}
        </div>
      )}

      <Section title="Phiên bản & số báo giá" summary={`${DOC_LANGS.find(l => l.value === doc.lang)!.label} · ${doc.number}`} open={!!open.basic} onToggle={() => tg('basic')}>
        <div><span className={labelCls}>Phiên bản ngôn ngữ</span><Seg value={doc.lang} disabled={dis} onChange={v => setDoc({ lang: v })} options={DOC_LANGS} /></div>
        <div className="grid grid-cols-2 gap-3">
          <F label="Số báo giá"><input disabled={dis} value={doc.number} onChange={e => setDoc({ number: e.target.value })} className={`${field} w-full`} /></F>
          <F label="Ngày báo giá"><input type="date" disabled={dis} value={doc.date} onChange={e => setDoc({ date: e.target.value })} className={`${field} w-full`} /></F>
          <F label="Hiệu lực đến"><input type="date" disabled={dis} value={doc.validUntil} onChange={e => setDoc({ validUntil: e.target.value })} className={`${field} w-full`} /></F>
        </div>
        <F label="Tiêu đề (để trống = mặc định)"><input disabled={dis} value={doc.title ?? ''} placeholder={bi2(defView.title).split('\n')[0]} onChange={e => setDoc({ title: e.target.value.trim() ? e.target.value : null })} className={`${field} w-full`} /></F>
      </Section>

      <Section title="Khách hàng" summary={customer.name || 'Chưa điền'} open={!!open.customer} onToggle={() => tg('customer')}>
        <F label="Kính gửi (tên công ty khách)"><input disabled={dis} value={customer.name} onChange={e => setCustomer({ name: e.target.value })} className={`${field} w-full`} /></F>
        <F label="Người nhận"><input disabled={dis} value={customer.attn} placeholder="vd: Chị Lan — Phòng Nhân sự" onChange={e => setCustomer({ attn: e.target.value })} className={`${field} w-full`} /></F>
        <F label="Địa chỉ"><input disabled={dis} value={customer.address} onChange={e => setCustomer({ address: e.target.value })} className={`${field} w-full`} /></F>
        <div className="grid grid-cols-2 gap-3">
          <F label="Mã số thuế"><input disabled={dis} value={customer.taxCode} onChange={e => setCustomer({ taxCode: e.target.value })} className={`${field} w-full`} /></F>
          <F label="Điện thoại"><input disabled={dis} value={customer.phone} onChange={e => setCustomer({ phone: e.target.value })} className={`${field} w-full`} /></F>
        </div>
      </Section>

      <Section title="Nội dung báo giá" summary="Lời mở đầu, nội dung dịch vụ, ghi chú" open={!!open.content} onToggle={() => tg('content')}>
        <F label="Lời mở đầu"><Override disabled={dis} value={doc.intro} onChange={v => setDoc({ intro: v })} placeholder={bi2(defView.intro)} rows={3} /></F>
        <F label="Nội dung dịch vụ (mỗi dòng 1 ý)"><Override disabled={dis} value={doc.serviceLines} onChange={v => setDoc({ serviceLines: v })} placeholder={defView.serviceLines.map(l => l.a).join('\n')} rows={5} /></F>
        <F label="Điều khoản thanh toán (nếu có)"><input disabled={dis} value={doc.payment} placeholder="vd: Chuyển khoản trong 30 ngày kể từ ngày nhận hoá đơn" onChange={e => setDoc({ payment: e.target.value })} className={`${field} w-full`} /></F>
        <F label="Ghi chú dưới bảng giá (mỗi dòng 1 ý)"><textarea rows={4} disabled={dis} value={q.generalNotes} onChange={e => setQuote({ ...q, generalNotes: e.target.value })} className={`${field} !h-auto w-full py-2.5 leading-relaxed resize-y`} /></F>
        <F label="Ô “Bao gồm” cạnh dòng giá ngày"><textarea rows={2} disabled={dis} value={q.includedNote ?? includedNoteAuto(data)} onChange={e => setQuote({ ...q, includedNote: e.target.value })} className={`${field} !h-auto w-full py-2.5 leading-relaxed resize-y`} /></F>
        <F label="Lời kết"><Override disabled={dis} value={doc.closing} onChange={v => setDoc({ closing: v })} placeholder={bi2(defView.closing)} rows={2} /></F>
      </Section>

      <Section title="Dòng giá hiển thị" summary={`${rows.filter(r => !r.hidden).length}/${rows.length} dòng`} open={!!open.rows} onToggle={() => tg('rows')}>
        <div className="text-[11.5px] text-[#86868b] -mt-1">Bật/tắt dòng, đổi tên hoặc sửa giá — thay đổi này cũng áp dụng cho Bảng giá dịch vụ của phương án.</div>
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className={`rounded-xl bg-[#f5f5f7] p-2.5 ${r.hidden ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2">
                <Switch on={!r.hidden} disabled={dis} onChange={v => patchRow(r.id, { hidden: !v })} />
                <input disabled={dis} value={r.name} onChange={e => patchRow(r.id, { name: e.target.value })} className={`${field} !h-8 !bg-white flex-1 min-w-0`} />
                <MoneyInput value={r.price} disabled={dis} onChange={n => patchRow(r.id, { override: n })} className={`${field} !h-8 !bg-white w-[104px] text-right font-semibold ${r.overridden ? '!text-[#b25e00]' : ''}`} />
              </div>
              {r.overridden && !dis && <button type="button" onClick={() => patchRow(r.id, { override: null })} className={btnLink + ' !text-[11.5px] mt-1 ml-12'}>Khôi phục giá tự tính ({fmt(r.auto ?? 0)})</button>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Người ký" summary={view.signer.name ? `${view.signer.name}${view.signer.role ? ` — ${view.signer.role}` : ''}` : 'Chưa có'} open={!!open.signer} onToggle={() => tg('signer')}>
        <F label="Họ tên người đại diện"><input disabled={dis} value={doc.signerName ?? ''} placeholder={effData.signerName || 'vd: Nguyễn Văn A'} onChange={e => setDoc({ signerName: e.target.value.trim() ? e.target.value : null })} className={`${field} w-full`} /></F>
        <div className="grid grid-cols-2 gap-3">
          <F label="Chức danh"><input disabled={dis} value={doc.signerTitle ?? ''} placeholder={effData.signerTitle || 'vd: Giám đốc'} onChange={e => setDoc({ signerTitle: e.target.value.trim() ? e.target.value : null })} className={`${field} w-full`} /></F>
          <F label="Nơi ký"><input disabled={dis} value={doc.place ?? ''} placeholder={effData.place || 'vd: Biên Hòa'} onChange={e => setDoc({ place: e.target.value.trim() ? e.target.value : null })} className={`${field} w-full`} /></F>
        </div>
      </Section>

      <Section title="Pháp nhân & chữ ký" summary={entity ? entity.label : entLoading ? 'Đang tải…' : token ? 'Chưa có pháp nhân' : 'Cần đăng nhập'} open={!!open.company} onToggle={() => tg('company')}>
        {profErr && <div className="flex gap-2 text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-xl px-3.5 py-2.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>{profErr}</span></div>}
        {!token && <div className="text-[12.5px] text-[#86868b]">Đăng nhập để chọn pháp nhân, chữ ký và con dấu.</div>}
        {token && (
          <>
            <F label="Pháp nhân gửi báo giá">
              {entities.length > 0
                ? <Select value={entity?.id ?? ''} disabled={dis} onChange={chooseEntity}>{entities.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</Select>
                : <div className="text-[12.5px] text-[#86868b]">{entLoading ? 'Đang tải…' : 'Chưa có pháp nhân nào.'}</div>}
            </F>
            {entity && <div className="text-[11.5px] text-[#86868b] leading-snug">{entity.data.name || '(chưa có tên công ty)'}{entity.data.taxCode ? ` · MST ${entity.data.taxCode}` : ''}{entity.has_signature ? ' · có chữ ký' : ''}{entity.has_seal ? ' · có con dấu' : ''}</div>}
            <button type="button" onClick={() => setEntityDlg(true)} className={btnLink}>{isAdmin ? 'Quản lý pháp nhân, chữ ký, con dấu…' : 'Xem danh sách pháp nhân…'}</button>
          </>
        )}
      </Section>
    </div>
  );

  const preview = (
    <div ref={wrapRef} className="p-3 sm:p-5">
      <div className="mx-auto relative" style={{ width: A4_W * scale, height: docH * scale }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: A4_W }} className="shadow-[0_2px_20px_rgba(0,0,0,0.18)] ring-1 ring-black/5">
          <div ref={docRef}><QuoteDocument view={view} images={images} layout={layout} showSignature={showSig} showSeal={showSeal} autoFit={autoFit} onFit={setFit} /></div>
        </div>
        {Array.from({ length: pages - 1 }, (_, k) => (
          <div key={k} className="absolute left-0 right-0 border-t border-dashed border-[#d70015]/60 pointer-events-none" style={{ top: (k + 1) * A4_H * scale }}>
            <span className="absolute right-1 -top-4 text-[10px] font-medium text-[#d70015]/80 bg-white/80 px-1 rounded">hết trang {k + 1}</span>
          </div>
        ))}
      </div>
      <div className="text-center text-[11.5px] text-[#86868b] mt-3">{pages} trang A4 · {DOC_LANGS.find(l => l.value === doc.lang)!.label}{fit < 1 ? ` · đã thu nhỏ chữ còn ${Math.round(fit * 100)}% để vừa 1 trang` : ''}</div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-2 sm:p-4" style={{ fontFamily: FONT }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-[1280px] h-[94vh] flex flex-col overflow-hidden text-[#1d1d1f]">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-[#f0f0f2] shrink-0">
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-semibold tracking-tight">Báo giá gửi khách</div>
              <div className="text-[12px] text-[#86868b] truncate">Xem trước · sửa từng trường · xuất PDF {readOnly ? '(chế độ chỉ xem)' : ''}</div>
            </div>
            <div className="w-48 lg:hidden"><Seg value={tab} onChange={setTab} options={[{ value: 'form', label: 'Điền thông tin' }, { value: 'preview', label: 'Xem trước' }]} /></div>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7]"><X size={17} /></button>
          </div>

          <div className="flex-1 min-h-0 flex">
            <div className={`${tab === 'form' ? 'block' : 'hidden'} lg:block w-full lg:w-[400px] lg:shrink-0 overflow-y-auto border-r border-[#f0f0f2]`}>{form}</div>
            <div className={`${tab === 'preview' ? 'block' : 'hidden'} lg:block flex-1 min-w-0 overflow-y-auto bg-[#e8e8ed]`}>{preview}</div>
          </div>

          <div className="shrink-0 border-t border-[#f0f0f2] bg-white/90 px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-4 flex-wrap">
              <label className={`flex items-center gap-2 text-[13px] ${sigAvail ? '' : 'opacity-50'}`}><Switch on={signOn && sigAvail} disabled={!sigAvail} onChange={setSignOn} />Chữ ký</label>
              <label className={`flex items-center gap-2 text-[13px] ${sealAvail ? '' : 'opacity-50'}`}><Switch on={sealOn && sealAvail} disabled={!sealAvail} onChange={setSealOn} />Con dấu</label>
              <label className="flex items-center gap-2 text-[13px]" title="Tự thu nhỏ chữ (tối đa còn 80%) để báo giá vừa 1 trang"><Switch on={autoFit} onChange={setAutoFit} />Vừa 1 trang</label>
              {signHint && <span className="text-[11.5px] text-[#86868b]">{signHint}</span>}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {err && <span className="text-[12px] text-[#b3140a] max-w-[260px] truncate" title={err}>{err}</span>}
              <button type="button" onClick={print} disabled={!!busy} className={`${btnGhost} !h-9`}>{busy === 'print' ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}In</button>
              <button type="button" onClick={exportPdf} disabled={!!busy} className={`${btnPrimary} !h-9 !px-5`}>{busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Tải PDF{showSig || showSeal ? ' (đã ký/đóng dấu)' : ''}</button>
            </div>
          </div>
        </div>
      </div>

      {entityDlg && <EntityManager entities={entities} canSign={isAdmin} selectedId={entity?.id ?? null} onClose={() => setEntityDlg(false)} onChanged={reloadEntities} onSelect={chooseEntity} />}

      {/* Bản dùng để chụp PDF / in: ngoài màn hình khi bình thường, thành nội dung duy nhất của trang khi in */}
      {createPortal(<div id="quote-export-host" ref={hostRef}><QuoteDocument view={view} images={images} layout={layout} showSignature={showSig} showSeal={showSeal} autoFit={autoFit} /></div>, document.body)}
    </>
  );
}
