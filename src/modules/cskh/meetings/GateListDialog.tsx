// Hộp "Danh sách đăng ký ra vào cổng" của 1 buổi họp: trái = tuỳ chọn (pháp nhân, người tham dự + thứ tự,
// ngày ký, kính gửi, cột thêm, logo / chữ ký / con dấu), phải = bản xem trước A4 ngang. Xuất PDF · Excel · In.
// Pháp nhân + chữ ký + con dấu = quote_entities (dùng chung Phương án giá); ảnh chữ ký / con dấu chỉ admin nhận được.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowDown, ArrowUp, Download, FileSpreadsheet, Landmark, Loader2, Printer, X } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { logActivity } from '../../../lib/audit';
import { errorText } from '../../../lib/appVersion';
import { DEFAULT_LAYOUT, type QuoteEntity } from '../../../lib/costPlan/entity';
import { downloadBlob, printCss, renderElementToPdf } from '../../../lib/costPlan/pdf';
import { useInk } from '../../../components/workspace/costplan/useInk';
import {
  buildGateDoc, EXTRA_COL_LABEL, GATE_TITLE, gateFileName, gateIssues, resolvePlace,
} from '../../../lib/meetings/gateList';
import type { Attendee, GateExtraCol, GateOptions, Meeting, MeetingMember } from '../../../lib/meetings/types';
import { todayVN } from '../../../lib/cskh/dates';
import { inputCls } from '../ui';
import { Switch } from '../components/apple';
import { GateDocument, PAGE_H, PAGE_W } from './GateDocument';
import { isLetsGoEntity, letsGoLogoUrl, toPngDataUrl } from './gateImages';

const labelCls = 'block text-[12px] font-medium text-[#6E6E73] mb-1';
const sectionCls = 'px-4 md:px-5 py-3.5 border-b border-black/[0.06]';

export function GateListDialog({ meeting, members, entities, canSign, canEdit, onOpenEntities, onSave, onClose }: {
  meeting: Meeting;
  members: readonly MeetingMember[];
  entities: readonly QuoteEntity[];
  /** Admin: nhận được ảnh chữ ký / con dấu */
  canSign: boolean;
  canEdit: boolean;
  onOpenEntities: () => void;
  /** Lưu tuỳ chọn bản in + người tham dự + pháp nhân vào buổi họp. Trả câu lỗi hoặc null. */
  onSave: (patch: { gate: GateOptions; attendees: Attendee[]; entity_id: string | null }) => Promise<string | null>;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [opts, setOpts] = useState<GateOptions>(meeting.gate);
  const [attendees, setAttendees] = useState<Attendee[]>(meeting.attendees);
  const [entityId, setEntityId] = useState<string | null>(meeting.entity_id ?? entities[0]?.id ?? null);
  const [showLogo, setShowLogo] = useState(true);
  const [showSig, setShowSig] = useState(false);
  const [showSeal, setShowSeal] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'xlsx' | 'print' | 'save'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const today = todayVN();

  const entity = entities.find(e => e.id === entityId) ?? null;
  // Pháp nhân bị xoá sau khi chọn → về pháp nhân đầu tiên
  useEffect(() => { if (entityId && !entities.some(e => e.id === entityId)) setEntityId(entities[0]?.id ?? null); }, [entities, entityId]);
  const layout = entity?.layout ?? DEFAULT_LAYOUT;
  const signature = useInk(canSign && showSig ? entity?.signature : null, 'sig', layout.sigInk);
  const seal = useInk(canSign && showSeal ? entity?.seal : null, 'seal', layout.sealInk);
  const [fallbackLogo, setFallbackLogo] = useState<string | null>(null);
  const wantsFallback = showLogo && !entity?.logo && isLetsGoEntity(entity);
  useEffect(() => { if (wantsFallback && !fallbackLogo) void letsGoLogoUrl().then(setFallbackLogo); }, [wantsFallback, fallbackLogo]);
  const logo = showLogo ? entity?.logo ?? (wantsFallback ? fallbackLogo : null) : null;
  const images = { logo, signature, seal, layout };

  const membersById = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  const doc = useMemo(() => buildGateDoc({ meeting: { ...meeting, attendees }, members, profile: entity?.data ?? null, options: opts, today }),
    [meeting, attendees, members, entity, opts, today]);
  const issues = gateIssues(doc.rows, { entityMissing: !entity });
  const dirty = JSON.stringify(opts) !== JSON.stringify(meeting.gate) || JSON.stringify(attendees) !== JSON.stringify(meeting.attendees)
    || (entityId ?? null) !== (meeting.entity_id ?? null);

  const set = (p: Partial<GateOptions>) => { setOpts(o => ({ ...o, ...p })); setSaved(false); };
  const move = (i: number, d: -1 | 1) => setAttendees(a => {
    const j = i + d;
    if (j < 0 || j >= a.length) return a;
    const n = [...a]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const toggleExtra = (c: GateExtraCol) => {
    const cur = opts.extraCols ?? [];
    set({ extraCols: cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c] });
  };

  // ── Bản xem trước co theo bề ngang khung ──
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 24) / PAGE_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Chiều cao thật của tài liệu (bảng dài thì hơn 1 trang) để khung xem trước đủ cao
  const docRef = useRef<HTMLDivElement>(null);
  const [docH, setDocH] = useState(PAGE_H);
  useLayoutEffect(() => {
    const el = docRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDocH(el.offsetHeight || PAGE_H));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hostRef = useRef<HTMLDivElement>(null);
  const persist = async (): Promise<boolean> => {
    if (!canEdit || !dirty) return true;
    const e = await onSave({ gate: opts, attendees, entity_id: entityId });
    if (e) { setErr(e); return false; }
    setSaved(true);
    return true;
  };
  const audit = (how: string) => {
    if (!(signature || seal)) return;
    logActivity({
      user: user ?? null, action: 'update', table: 'meetings', recordId: meeting.id,
      description: `${how} danh sách vào cổng ${meeting.company_name || ''} ${meeting.meet_date} có ${[signature && 'chữ ký', seal && 'con dấu'].filter(Boolean).join(' + ')} (${entity?.label ?? ''})`,
    });
  };
  const exportPdf = async () => {
    if (!hostRef.current) return;
    setBusy('pdf'); setErr(null);
    try {
      void persist();
      downloadBlob(await renderElementToPdf(hostRef.current, { landscape: true }), gateFileName(meeting, 'pdf'));
      audit('Xuất PDF');
    } catch (e) { setErr(errorText(e, 'Không tạo được PDF: ')); }
    setBusy(null);
  };
  const exportXlsx = async () => {
    setBusy('xlsx'); setErr(null);
    try {
      void persist();
      const [{ buildGateXlsx }, lg, sg, sl] = await Promise.all([
        import('../../../lib/meetings/gateXlsx'),
        logo ? toPngDataUrl(logo) : null, signature ? toPngDataUrl(signature) : null, seal ? toPngDataUrl(seal) : null,
      ]);
      const buf = await buildGateXlsx(doc, { logo: lg, signature: sg, seal: sl, layout });
      downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), gateFileName(meeting, 'xlsx'));
      audit('Xuất Excel');
    } catch (e) { setErr(errorText(e, 'Không tạo được file Excel: ')); }
    setBusy(null);
  };
  const print = () => {
    setBusy('print'); setErr(null);
    void persist();
    audit('In');
    setTimeout(() => { window.print(); setBusy(null); }, 80);
  };
  const saveOnly = async () => { setBusy('save'); setErr(null); await persist(); setBusy(null); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const exportButtons = () => {
    const b = 'shrink-0 inline-flex items-center justify-center gap-1.5 h-10 md:h-9 px-4 rounded-full text-[13px] font-semibold whitespace-nowrap transition disabled:opacity-40';
    return (
      <>
        <button type="button" onClick={print} disabled={!!busy} className={`${b} bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]`}>
          {busy === 'print' ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}In
        </button>
        <button type="button" onClick={exportXlsx} disabled={!!busy} className={`${b} bg-[#34C759]/15 text-[#1F7A37] hover:bg-[#34C759]/25`}>
          {busy === 'xlsx' ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}Excel
        </button>
        <button type="button" onClick={exportPdf} disabled={!!busy} className={`${b} bg-[#0071E3] text-white hover:bg-[#0077ED]`}>
          {busy === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}Tải PDF
        </button>
      </>
    );
  };

  const available = members.filter(m => !m.deleted_at && !attendees.some(a => a.id === m.id));
  const placeHint = resolvePlace({}, entity?.data ?? null);

  return (
    <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[2px] flex md:items-center md:justify-center md:p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Danh sách đăng ký ra vào cổng"
        className="bg-[#F5F5F7] md:rounded-[22px] shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full md:max-w-[1280px] h-full md:h-[92vh] flex flex-col overflow-hidden text-[#1D1D1F]">
        {/* Đầu hộp */}
        <div className="shrink-0 flex items-center gap-3 px-4 md:px-5 py-3 bg-white border-b border-black/[0.06]">
          <button type="button" onClick={onClose} aria-label="Đóng" className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-[#6E6E73] hover:bg-black/[0.05]"><X size={18} /></button>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] md:text-[17px] font-semibold tracking-[-0.01em] truncate">Danh sách đăng ký ra vào cổng</div>
            <div className="text-[12px] text-[#86868B] truncate">{meeting.company_name || 'Chưa ghi công ty'} · {meeting.meet_date.split('-').reverse().join('/')}{meeting.meet_time ? ` · ${meeting.meet_time}` : ''}</div>
          </div>
          <div className="hidden md:flex items-center gap-2">
            {canEdit && dirty && <button type="button" onClick={saveOnly} disabled={!!busy} className="h-9 px-3.5 rounded-full text-[13px] font-medium text-[#0066CC] hover:bg-[#0071E3]/10 transition">Lưu tuỳ chọn</button>}
            {saved && !dirty && <span className="text-[12px] text-[#248A3D]">Đã lưu</span>}
            {exportButtons()}
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
          {/* Tuỳ chọn */}
          <div className="md:w-[380px] shrink-0 bg-white md:border-r border-black/[0.06] md:overflow-y-auto">
            {issues.length > 0 && (
              <div className="m-3 mb-0 rounded-[12px] bg-[#FFF8E6] px-3.5 py-2.5">
                <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#8A5A00]"><AlertTriangle size={14} />Xem lại trước khi gửi ({issues.length})</div>
                <ul className="mt-1 space-y-0.5 text-[12px] text-[#8A5A00] list-disc pl-4">{issues.map(i => <li key={i}>{i}</li>)}</ul>
              </div>
            )}

            <div className={sectionCls}>
              <div className="flex items-center justify-between mb-1">
                <span className={labelCls}>Pháp nhân đứng tên</span>
                <button type="button" onClick={onOpenEntities} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#0066CC] hover:opacity-70"><Landmark size={13} />Sửa pháp nhân, chữ ký</button>
              </div>
              {entities.length ? (
                <select value={entityId ?? ''} onChange={e => { setEntityId(e.target.value || null); setSaved(false); }} className={inputCls}>
                  {entities.map(e => <option key={e.id} value={e.id}>{e.label}{e.data.name ? ` — ${e.data.name}` : ''}</option>)}
                </select>
              ) : (
                <p className="text-[12.5px] text-[#B25000]">Chưa có pháp nhân — bấm “Sửa pháp nhân, chữ ký” để tạo (dùng chung với Phương án giá).</p>
              )}
              <div className="mt-2.5 space-y-1">
                <div className="flex flex-wrap gap-x-5">
                  <Switch checked={showLogo} onChange={setShowLogo} label={<span className="text-[13px]">Logo</span>} />
                  {canSign && (
                    <>
                      <Switch checked={showSig} onChange={setShowSig} label={<span className="text-[13px]">Chữ ký{entity && !entity.has_signature ? <span className="text-[#AEAEB2]"> (chưa có ảnh)</span> : ''}</span>} />
                      <Switch checked={showSeal} onChange={setShowSeal} label={<span className="text-[13px]">Con dấu{entity && !entity.has_seal ? <span className="text-[#AEAEB2]"> (chưa có ảnh)</span> : ''}</span>} />
                    </>
                  )}
                </div>
                {!canSign && <p className="text-[11.5px] text-[#86868B]">Chữ ký và con dấu chỉ admin chèn được — in ra rồi ký, đóng dấu tay.</p>}
                <Switch checked={opts.showSigner !== false} onChange={v => set({ showSigner: v })}
                  label={<span className="text-[13px]">In tên người đại diện{entity?.data.signerName ? <span className="text-[#86868B]"> ({entity.data.signerName})</span> : ''}</span>} />
              </div>
            </div>

            <div className={sectionCls}>
              <span className={labelCls}>Người tham dự · thứ tự in</span>
              {attendees.length === 0 && <p className="text-[12.5px] text-[#86868B] py-1">Chưa chọn ai.</p>}
              <div className="space-y-1.5">
                {attendees.map((a, i) => {
                  const m = membersById.get(a.id);
                  return (
                    <div key={a.id} className="rounded-[10px] bg-[#F5F5F7] px-2.5 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 text-[12px] tabular-nums text-[#86868B]">{String(i + 1).padStart(2, '0')}</span>
                        <span className={`min-w-0 flex-1 text-[13px] font-semibold truncate ${m?.deleted_at ? 'line-through text-[#86868B]' : ''}`}>{m?.full_name ?? 'Người đã xoá'}</span>
                        <button type="button" aria-label="Lên" disabled={i === 0} onClick={() => move(i, -1)} className="w-7 h-7 rounded-full flex items-center justify-center text-[#6E6E73] hover:bg-black/[0.06] disabled:opacity-30"><ArrowUp size={14} /></button>
                        <button type="button" aria-label="Xuống" disabled={i === attendees.length - 1} onClick={() => move(i, 1)} className="w-7 h-7 rounded-full flex items-center justify-center text-[#6E6E73] hover:bg-black/[0.06] disabled:opacity-30"><ArrowDown size={14} /></button>
                        <button type="button" aria-label="Bỏ khỏi danh sách" onClick={() => setAttendees(x => x.filter(y => y.id !== a.id))} className="w-7 h-7 rounded-full flex items-center justify-center text-[#6E6E73] hover:bg-black/[0.06]"><X size={14} /></button>
                      </div>
                      <input value={a.title} placeholder={m?.title ? `Chức vụ: ${m.title}` : 'Chức vụ'} title="Chức vụ in cho buổi này (trống = theo hồ sơ)"
                        onChange={e => setAttendees(x => x.map(y => (y.id === a.id ? { ...y, title: e.target.value } : y)))}
                        className="mt-1.5 w-full text-[12.5px] bg-white rounded-[8px] px-2.5 py-1.5 border border-black/[0.08] outline-none focus:border-[#0071E3]" />
                    </div>
                  );
                })}
              </div>
              {available.length > 0 && (
                <select value="" onChange={e => { const id = e.target.value; if (id) setAttendees(x => [...x, { id, title: '' }]); }} className={`${inputCls} mt-2`}>
                  <option value="">+ Thêm người…</option>
                  {available.map(m => <option key={m.id} value={m.id}>{m.full_name}{m.title ? ` — ${m.title}` : ''}</option>)}
                </select>
              )}
            </div>

            <div className={`${sectionCls} space-y-2.5`}>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={labelCls}>Ngày ký</label>
                  <input type="date" value={opts.docDate ?? today} onChange={e => set({ docDate: e.target.value || null })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Nơi ký</label>
                  <input value={opts.place ?? ''} onChange={e => set({ place: e.target.value })} placeholder={placeHint || 'Đồng Nai'} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Tiêu đề</label>
                <input value={opts.title ?? ''} onChange={e => set({ title: e.target.value })} placeholder={GATE_TITLE} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Kính gửi <span className="font-normal text-[#AEAEB2]">(trống = không in)</span></label>
                <input value={opts.recipient ?? ''} onChange={e => set({ recipient: e.target.value })} placeholder={`Ban bảo vệ ${meeting.company_name || 'Công ty …'}`} className={inputCls} />
              </div>
              <Switch checked={!!opts.showVisit} onChange={v => set({ showVisit: v })} label={<span className="text-[13px]">In thời gian · địa điểm · nội dung</span>} />
              <div>
                <span className={labelCls}>Cột thêm</span>
                <div className="flex flex-wrap gap-x-4">
                  {(['phone', 'vehicle_plate'] as const).map(c => (
                    <Switch key={c} checked={(opts.extraCols ?? []).includes(c)} onChange={() => toggleExtra(c)} label={<span className="text-[13px]">{EXTRA_COL_LABEL[c]}</span>} />
                  ))}
                </div>
              </div>
            </div>
            {err && <p className="m-3 text-[12.5px] text-[#D70015] bg-[#FF3B30]/10 rounded-[12px] px-3.5 py-2.5">{err}</p>}
          </div>

          {/* Xem trước */}
          <div ref={wrapRef} className="flex-1 min-w-0 md:overflow-auto p-3">
            <div style={{ width: PAGE_W * scale, height: docH * scale, margin: '0 auto' }} className="relative">
              <div ref={docRef} style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: PAGE_W }} className="absolute left-0 top-0 shadow-[0_2px_16px_rgba(0,0,0,0.12)] bg-white">
                <GateDocument doc={doc} images={images} />
              </div>
            </div>
          </div>
        </div>

        {/* Điện thoại: nút xuất ở đáy */}
        <div className="md:hidden shrink-0 bg-white border-t border-black/[0.06] px-3 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))] flex gap-2 overflow-x-auto no-scrollbar">
          {exportButtons()}
        </div>
      </div>

      {createPortal(
        <div id="quote-export-host" ref={hostRef}>
          <style>{printCss(PAGE_W, true)}</style>
          <GateDocument doc={doc} images={images} />
        </div>,
        document.body,
      )}
    </div>
  );
}
