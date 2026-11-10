// Quản lý PHÁP NHÂN cho giấy tờ — DÙNG CHUNG: báo giá ở Phương án giá + danh sách vào cổng ở CSKH → Đi họp.
//   • Danh sách + THÔNG TIN (tên, viết tắt, MST, địa chỉ, ĐT, người đại diện, logo) lấy từ PHÁP LÝ (Workspace → Pháp lý) —
//     nguồn duy nhất; ở đây chỉ xem + nút "Sửa ở Pháp lý". Tên viết tắt (hiện trên nút chọn) đổi được ngay tại đây
//     (ghi thẳng vào Pháp lý).
//   • Ở đây giữ phần riêng của giấy tờ: chữ ký, con dấu, cách căn, nơi ký, người ký khác (uỷ quyền), logo riêng.
//   • Pháp nhân cũ (tạo trước khi có Pháp lý, chưa khớp được) vẫn dùng/sửa như trước + nút gắn vào pháp nhân Pháp lý.
// Chỉ admin sửa được; người khác chỉ xem.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Link2, Loader2, Pencil, Plus, X } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { deleteEntity, saveEntity } from '../../../lib/costPlan/api';
import { DEFAULT_LAYOUT, OFFSET_RANGE, SCALE_RANGE, stampBoxes, type QuoteEntity, type StampLayout } from '../../../lib/costPlan/entity';
import { isGenericLabel, shortEntityName } from '../../../lib/costPlan/legalLink';
import { emptyProfile, type CompanyProfileData } from '../../../lib/costPlan/quoteDoc';
import { patchEntity } from '../../../lib/legal/api';
import ImagePicker, { CHECKER } from './ImagePicker';
import { useInk } from './useInk';
import { openLegalEntity } from './useEntities';
import { FONT, Switch, btnGhost, btnPrimary, field, labelCls } from './ui';

interface Draft { label: string; data: CompanyProfileData; layout: StampLayout; logo?: string | null; signature?: string | null; seal?: string | null }
const F = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block"><span className={labelCls}>{label}</span>{children}{hint && <span className="block text-[11px] text-[#86868b] mt-1 leading-snug">{hint}</span>}</label>
);

export function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-[12px] text-[#6e6e73]">
      <span className="w-20 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="flex-1 accent-[#0071e3]" />
      <span className="w-12 text-right tabular-nums text-[#1d1d1f]">{unit === '%' ? Math.round(value * 100) : Math.round(value)}{unit}</span>
    </label>
  );
}

/** Ô xem trước: khối chữ ký giả lập (chức danh – vùng ký – họ tên) với chữ ký + con dấu đặt theo cấu hình. */
function StampPreview({ layout, signature: sigRaw, seal: sealRaw, name }: { layout: StampLayout; signature: string | null; seal: string | null; name: string }) {
  const BOX = { w: 280, h: 92 };
  const signature = useInk(sigRaw, 'sig', layout.sigInk);
  const seal = useInk(sealRaw, 'seal', layout.sealInk);
  const { sig, seal: sl } = useMemo(() => stampBoxes(layout, BOX), [layout]);
  return (
    <div className="rounded-xl ring-1 ring-black/10 p-3 flex justify-center" style={{ background: '#fff' }}>
      <div style={{ width: BOX.w, textAlign: 'center' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0c2340', letterSpacing: 0.3 }}>ĐẠI DIỆN CÔNG TY</div>
        <div style={{ position: 'relative', width: BOX.w, height: BOX.h, ...CHECKER, backgroundSize: '10px 10px', backgroundPosition: '0 0,5px 5px', opacity: 1 }}>
          {(layout.sealOnTop === false ? ['seal', 'sig'] : ['sig', 'seal']).map(k => (k === 'sig'
            ? (signature ? <img key="sig" src={signature} alt="" style={{ position: 'absolute', left: sig.x, top: sig.y, width: sig.w, height: sig.h, objectFit: 'contain' }} /> : null)
            : (seal ? <img key="seal" src={seal} alt="" style={{ position: 'absolute', left: sl.x, top: sl.y, width: sl.w, height: sl.h, objectFit: 'contain' }} /> : null)))}
          {!signature && !seal && <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[#a1a1a6]">Tải ảnh chữ ký / con dấu để xem vị trí</div>}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{name || 'Nguyễn Văn A'}</div>
      </div>
    </div>
  );
}

/** 1 dòng thông tin (chỉ xem) lấy từ Pháp lý. */
function InfoRow({ label, value, old }: { label: string; value: string; old?: boolean }) {
  return (
    <div className="flex gap-3 py-1.5 border-b border-black/[0.05] last:border-0">
      <span className="w-[92px] shrink-0 text-[12px] text-[#86868b]">{label}</span>
      <span className={`min-w-0 flex-1 text-[13px] break-words ${value ? 'text-[#1d1d1f]' : 'text-[#c7c7cc]'}`}>
        {value || 'chưa nhập'}{old && value && <span className="ml-1.5 text-[11px] text-[#b25e00]">(dữ liệu cũ — Pháp lý chưa có)</span>}
      </span>
    </div>
  );
}

export default function EntityManager({ entities, canSign, selectedId, onClose, onChanged, onSelect }: {
  entities: QuoteEntity[]; canSign: boolean; selectedId: string | null;
  onClose: () => void; onChanged: () => Promise<void> | void; onSelect: (id: string) => void;
}) {
  const { token, user } = useAuth();
  const pickId = (id: string | null) => entities.find(e => e.id === id || e.stamp_id === id)?.id ?? entities[0]?.id ?? '';
  const [cur, setCur] = useState<string>(() => pickId(selectedId));
  const entity = entities.find(e => e.id === cur) ?? null;
  const legal = entity?.legal ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [cur]);

  // Danh sách đổi (vd vừa xoá) mà pháp nhân đang chọn không còn → chọn cái đầu
  useEffect(() => { if (entities.length && !entities.some(e => e.id === cur)) setCur(pickId(cur)); }, [entities]); // eslint-disable-line react-hooks/exhaustive-deps

  // Đổi pháp nhân đang sửa → nạp lại bản nháp từ dữ liệu đã lưu. Pháp nhân Pháp lý: tên = tên viết tắt bên Pháp lý,
  // data = phần lưu riêng ở bộ ký/dấu (người ký khác, nơi ký) — thông tin công ty không sửa ở đây.
  const fresh = (): Draft | null => (!entity ? null : legal
    ? { label: legal.short_name, data: entity.own.data, layout: entity.layout }
    : { label: entity.own.label, data: entity.own.data, layout: entity.layout });
  useEffect(() => { setErr(null); setDraft(fresh()); }, [cur, entity?.updated_at, legal?.short_name]); // eslint-disable-line react-hooks/exhaustive-deps

  const imgTouched = !!draft && ('logo' in draft || 'signature' in draft || 'seal' in draft);
  const stampDirty = !!draft && !!entity && (
    JSON.stringify({ d: draft.data, y: draft.layout }) !== JSON.stringify({ d: entity.own.data, y: entity.layout })
    || (!legal && draft.label !== entity.own.label) || imgTouched);
  const nameDirty = !!draft && !!legal && draft.label.trim() !== legal.short_name.trim();
  const dirty = stampDirty || nameDirty;
  const data = draft?.data ?? emptyProfile();
  const editData = (p: Partial<CompanyProfileData>) => setDraft(d => (d ? { ...d, data: { ...d.data, ...p } } : d));
  const editLayout = (p: Partial<StampLayout>) => setDraft(d => (d ? { ...d, layout: { ...d.layout, ...p } } : d));
  const img = (k: 'logo' | 'signature' | 'seal', v: string | null) => setDraft(d => (d ? { ...d, [k]: v } : d));
  const ownLogo = draft && 'logo' in draft ? draft.logo ?? null : entity?.own.logo ?? null;
  const sig = draft && 'signature' in draft ? draft.signature ?? null : entity?.signature ?? null;
  const seal = draft && 'seal' in draft ? draft.seal ?? null : entity?.seal ?? null;
  const hasLegalLogo = !!legal?.logo_url;
  const useOwnLogo = !hasLegalLogo || draft?.layout.logoOwn === true;
  const autoShort = shortEntityName(entity?.data.name ?? '');
  /** Pháp nhân Pháp lý chưa có bộ ký/dấu — để gắn pháp nhân cũ vào */
  const linkTargets = entities.filter(e => e.legal_id && !e.stamp_id);

  const save = async () => {
    if (!token || !draft || !entity) return;
    if (!legal && !draft.label.trim()) { setErr('Đặt tên gọi cho pháp nhân (vd: LGVN) để dễ chọn.'); return; }
    setBusy(true); setErr(null);
    try {
      if (nameDirty && legal) await patchEntity(legal.id, { short_name: draft.label.trim() }, user?.full_name || user?.username || '');
      if (stampDirty) {
        await saveEntity(token, {
          id: entity.stamp_id, label: legal ? (draft.label.trim() || entity.label) : draft.label, data: draft.data, layout: draft.layout,
          logo: 'logo' in draft ? draft.logo ?? null : undefined, signature: 'signature' in draft ? draft.signature ?? null : undefined,
          seal: 'seal' in draft ? draft.seal ?? null : undefined, legalEntityId: entity.legal_id,
        });
      }
      await onChanged();
      onSelect(entity.id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const remove = async () => {
    if (!token || !entity?.stamp_id) return;
    const msg = legal
      ? `Xoá CHỮ KÝ, CON DẤU, cách căn và logo riêng của “${entity.label}”?\n\nThông tin pháp nhân bên Pháp lý giữ nguyên. Ảnh chữ ký / con dấu đã xoá không khôi phục được.`
      : `Xoá pháp nhân “${entity.label}” cùng ảnh chữ ký và con dấu?\n\nGiấy tờ cũ đang chọn pháp nhân này sẽ chuyển sang pháp nhân đầu tiên. Không khôi phục được.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try { await deleteEntity(token, entity.stamp_id); await onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const linkTo = async (target: QuoteEntity) => {
    if (!token || !entity?.stamp_id || !target.legal_id) return;
    if (!window.confirm(`Gắn chữ ký, con dấu, logo của “${entity.label}” vào pháp nhân “${target.label}” (Pháp lý)?\n\nTừ giờ thông tin công ty lấy theo Pháp lý.`)) return;
    setBusy(true); setErr(null);
    try {
      await saveEntity(token, { id: entity.stamp_id, label: target.label, data: entity.own.data, layout: entity.layout, legalEntityId: target.legal_id });
      await onChanged();
      setCur(target.legal_id);
      onSelect(target.legal_id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const dis = !canSign;
  const renameChip = () => { nameRef.current?.focus(); nameRef.current?.select(); };
  return (
    <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-3" style={{ fontFamily: FONT }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-2xl max-h-[92vh] flex flex-col text-[#1d1d1f]">
        <div className="flex items-start justify-between px-6 pt-5 pb-3 shrink-0">
          <div>
            <div className="text-[19px] font-semibold tracking-tight">Pháp nhân · chữ ký · con dấu</div>
            <div className="text-[12.5px] text-[#86868b] mt-0.5">Thông tin pháp nhân lấy từ <b className="font-medium text-[#1d1d1f]">Pháp lý</b> (Workspace). Ở đây giữ chữ ký, con dấu, cách căn — dùng chung cho báo giá ở Phương án giá và danh sách vào cổng ở CSKH → Đi họp</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 -mr-2 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7]"><X size={17} /></button>
        </div>

        <div className="px-6 flex flex-wrap items-center gap-2 pb-3 shrink-0">
          {entities.map(e => {
            const on = cur === e.id;
            return (
              <button key={e.id} type="button" onClick={() => (on && canSign ? renameChip() : setCur(e.id))} title={on && canSign ? 'Đổi tên viết tắt' : e.data.name}
                className={`h-8 px-3.5 rounded-full text-[13px] font-medium transition inline-flex items-center gap-1.5 ${on ? 'bg-[#1d1d1f] text-white' : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'}`}>
                {e.legal && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.legal.color }} />}
                {!on || !draft ? e.label : legal ? (draft.label.trim() || autoShort || e.label)
                  : isGenericLabel(draft.label) ? (shortEntityName(draft.data.name) || e.label) : draft.label}
                {!e.legal_id && <span className={`text-[10.5px] ${on ? 'text-white/60' : 'text-[#86868b]'}`}>cũ</span>}
                {on && canSign && <Pencil size={11} className="opacity-60" />}
              </button>
            );
          })}
          {canSign && (
            <button type="button" onClick={() => openLegalEntity(null)} className="h-8 px-3 rounded-full text-[13px] font-medium text-[#0071e3] hover:bg-[#eef5ff] inline-flex items-center gap-1"><Plus size={14} />Thêm ở Pháp lý</button>
          )}
        </div>

        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-6 pb-5 space-y-4 border-t border-[#f2f2f4] pt-4">
          {!canSign && <div className="text-[12.5px] text-[#86868b] bg-[#f5f5f7] rounded-xl px-4 py-3">Bạn xem được thông tin và logo. Việc sửa pháp nhân, chữ ký, con dấu chỉ dành cho admin. Khi làm giấy tờ bạn vẫn chèn được chữ ký / con dấu — quản trị viên sẽ được báo ngay.</div>}
          {err && <div className="flex gap-2 text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-xl px-3.5 py-2.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>{err}</span></div>}
          {!entity && <div className="text-[13px] text-[#86868b] py-8 text-center">Chưa có pháp nhân nào — thêm ở Workspace → Pháp lý.</div>}

          {draft && entity && legal && (
            <>
              <F label="Tên viết tắt (hiện trên nút chọn)" hint={canSign ? `Lưu thẳng vào Pháp lý. Để trống = tự lấy “${autoShort || entity.label}”.` : undefined}>
                <input ref={nameRef} disabled={dis} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} className={`${field} w-full`} placeholder={autoShort || 'vd: LGVN'} />
              </F>
              <div className="rounded-xl bg-[#f5f5f7] px-4 py-2.5">
                <div className="flex items-center justify-between gap-2 pb-1">
                  <span className="text-[12px] font-semibold text-[#1d1d1f]">Thông tin từ Pháp lý</span>
                  <button type="button" onClick={() => openLegalEntity(legal.id)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#0071e3] hover:opacity-70">Sửa ở Pháp lý<ExternalLink size={12} /></button>
                </div>
                <InfoRow label="Tên công ty" value={entity.data.name} old={!legal.name.trim()} />
                <InfoRow label="Địa chỉ" value={entity.data.address} old={!legal.address.trim()} />
                <InfoRow label="Mã số thuế" value={entity.data.taxCode} old={!legal.tax_code.trim()} />
                <InfoRow label="Điện thoại" value={entity.data.phone} old={!legal.phone.trim()} />
                <InfoRow label="Email" value={entity.data.email} old={!legal.email.trim()} />
                <InfoRow label="Website" value={entity.data.website} old={!legal.website.trim()} />
                <InfoRow label="Đại diện PL" value={[legal.legal_rep, legal.legal_rep_title].filter(s => s.trim()).join(' — ')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <F label="Người ký trên giấy tờ" hint={legal.legal_rep ? `Để trống = ${legal.legal_rep}` : undefined}>
                  <input disabled={dis} value={data.signerName} onChange={e => editData({ signerName: e.target.value })} className={`${field} w-full`} placeholder={legal.legal_rep || 'Người đại diện'} />
                </F>
                <F label="Chức danh" hint={legal.legal_rep_title && !data.signerName.trim() ? `Để trống = ${legal.legal_rep_title}` : undefined}>
                  <input disabled={dis} value={data.signerTitle} onChange={e => editData({ signerTitle: e.target.value })} className={`${field} w-full`} placeholder={data.signerName.trim() ? 'Giám đốc' : legal.legal_rep_title || 'Giám đốc'} />
                </F>
              </div>
              <F label="Nơi ký"><input disabled={dis} value={data.place} onChange={e => editData({ place: e.target.value })} className={`${field} w-full`} placeholder="vd: Biên Hòa (trống = đoán từ địa chỉ)" /></F>

              {hasLegalLogo && (
                <div className="rounded-xl bg-[#f5f5f7] p-3 flex items-center gap-3">
                  <div className="w-[88px] h-[60px] rounded-lg bg-white ring-1 ring-black/[0.06] flex items-center justify-center overflow-hidden shrink-0">
                    <img src={legal.logo_url ?? ''} alt="" className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">Logo lấy từ Pháp lý</div>
                    {canSign && (
                      <label className="mt-1 flex items-center gap-2 text-[12px] text-[#6e6e73]">
                        <Switch on={draft.layout.logoOwn === true} onChange={v => editLayout({ logoOwn: v || undefined })} />Dùng ảnh khác cho giấy tờ
                      </label>
                    )}
                  </div>
                </div>
              )}
              {useOwnLogo && (canSign || ownLogo) && (
                <ImagePicker label={hasLegalLogo ? 'Logo riêng cho giấy tờ' : 'Logo công ty'} hint={hasLegalLogo ? 'Chỉ dùng cho báo giá / danh sách vào cổng.' : 'Pháp lý chưa có logo — tải ở đây hoặc thêm bên Pháp lý. Nên dùng PNG nền trong suốt.'} value={ownLogo} onChange={v => img('logo', v)} cutoutDefault={false} disabled={dis} />
              )}
            </>
          )}

          {draft && entity && !legal && (
            <>
              <div className="rounded-xl bg-[#fff8e6] px-4 py-3 space-y-2">
                <div className="text-[12.5px] text-[#8a5a00]"><b className="font-semibold">Pháp nhân cũ — chưa có trong Pháp lý.</b> Thông tin đang lưu riêng ở đây. Gắn vào pháp nhân bên Pháp lý để từ nay lấy thông tin từ đó (chữ ký, con dấu giữ nguyên).</div>
                {canSign && (
                  <div className="flex flex-wrap items-center gap-2">
                    {linkTargets.length > 0 && (
                      <select value="" disabled={busy} onChange={e => { const t = entities.find(x => x.id === e.target.value); if (t) void linkTo(t); }} className={`${field} !h-8 !text-[12.5px]`}>
                        <option value="">Gắn vào pháp nhân Pháp lý…</option>
                        {linkTargets.map(t => <option key={t.id} value={t.id}>{t.label}{t.data.name && t.data.name !== t.label ? ` — ${t.data.name}` : ''}</option>)}
                      </select>
                    )}
                    <button type="button" onClick={() => openLegalEntity(null)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#0071e3] hover:opacity-70"><Link2 size={12} />Tạo bên Pháp lý (nút “Lấy từ pháp nhân báo giá”)<ExternalLink size={11} /></button>
                  </div>
                )}
              </div>
              <F label="Tên gọi (hiện trên nút chọn)"><input ref={nameRef} disabled={dis} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} className={`${field} w-full`} placeholder={autoShort || 'vd: LGVN'} /></F>
              <F label="Tên công ty (in đầu báo giá, danh sách vào cổng)"><input disabled={dis} value={data.name} onChange={e => editData({ name: e.target.value })} className={`${field} w-full`} placeholder="CÔNG TY TNHH …" /></F>
              <F label="Địa chỉ"><input disabled={dis} value={data.address} onChange={e => editData({ address: e.target.value })} className={`${field} w-full`} /></F>
              <div className="grid grid-cols-2 gap-3">
                <F label="Mã số thuế"><input disabled={dis} value={data.taxCode} onChange={e => editData({ taxCode: e.target.value })} className={`${field} w-full`} /></F>
                <F label="Điện thoại"><input disabled={dis} value={data.phone} onChange={e => editData({ phone: e.target.value })} className={`${field} w-full`} /></F>
                <F label="Email"><input disabled={dis} value={data.email} onChange={e => editData({ email: e.target.value })} className={`${field} w-full`} /></F>
                <F label="Website"><input disabled={dis} value={data.website} onChange={e => editData({ website: e.target.value })} className={`${field} w-full`} /></F>
                <F label="Người đại diện"><input disabled={dis} value={data.signerName} onChange={e => editData({ signerName: e.target.value })} className={`${field} w-full`} /></F>
                <F label="Chức danh"><input disabled={dis} value={data.signerTitle} onChange={e => editData({ signerTitle: e.target.value })} className={`${field} w-full`} placeholder="Giám đốc" /></F>
              </div>
              <F label="Nơi ký"><input disabled={dis} value={data.place} onChange={e => editData({ place: e.target.value })} className={`${field} w-full`} placeholder="vd: Biên Hòa" /></F>
              <ImagePicker label="Logo công ty" hint="Hiện ở đầu báo giá. Nên dùng PNG nền trong suốt." value={ownLogo} onChange={v => img('logo', v)} cutoutDefault={false} disabled={dis} />
            </>
          )}

          {draft && entity && (
            <>
              {(canSign || entity.has_signature) && <ImagePicker label="Chữ ký người đại diện" hint={canSign ? 'Ảnh chụp/scan chữ ký trên giấy trắng — hệ thống tự xoá nền.' : 'Chỉ admin xem được ảnh — khi làm giấy tờ bạn vẫn chèn được (admin được báo).'} value={sig} onChange={v => img('signature', v)} cutoutDefault disabled={dis} />}
              {(canSign || entity.has_seal) && <ImagePicker label="Con dấu công ty" hint={canSign ? 'Ảnh con dấu (dấu đỏ trên giấy trắng) — hệ thống tự xoá nền.' : 'Chỉ admin xem được ảnh — khi làm giấy tờ bạn vẫn chèn được (admin được báo).'} value={seal} onChange={v => img('seal', v)} cutoutDefault disabled={dis} />}
              {canSign && legal && !entity.has_signature && !entity.has_seal && !imgTouched && (
                <div className="text-[12px] text-[#86868b] -mt-2">Pháp nhân này chưa có chữ ký / con dấu — tải ảnh lên rồi bấm Lưu.</div>
              )}

              {canSign && (
                <div className="space-y-2.5">
                  <div className="text-[13px] font-semibold">Căn chỉnh chữ ký & con dấu</div>
                  <div className="text-[11.5px] text-[#86868b] -mt-1.5">Mặc định: chữ ký ở giữa, con dấu lệch trái và đè một phần lên chữ ký. Chỉnh cho khớp ý bạn — áp dụng cho cả bản PDF và file Excel mẫu.</div>
                  <StampPreview layout={draft.layout} signature={sig} seal={seal} name={entity.data.signerName} />
                  <div className="rounded-xl bg-[#f5f5f7] p-3 space-y-1.5">
                    <div className="text-[12px] font-semibold text-[#1d1d1f]">Chữ ký</div>
                    <Slider label="Kích thước" value={draft.layout.sigScale} min={SCALE_RANGE.min} max={SCALE_RANGE.max} step={0.05} unit="%" onChange={v => editLayout({ sigScale: v })} />
                    <Slider label="Sang ngang" value={draft.layout.sigDx} min={OFFSET_RANGE.min} max={OFFSET_RANGE.max} step={2} unit="px" onChange={v => editLayout({ sigDx: v })} />
                    <Slider label="Lên / xuống" value={draft.layout.sigDy} min={OFFSET_RANGE.min} max={OFFSET_RANGE.max} step={2} unit="px" onChange={v => editLayout({ sigDy: v })} />
                    <Slider label="Làm rõ, đậm màu" value={draft.layout.sigInk} min={0} max={1} step={0.05} unit="%" onChange={v => editLayout({ sigInk: v })} />
                    <div className="text-[12px] font-semibold text-[#1d1d1f] pt-1.5">Con dấu</div>
                    <Slider label="Kích thước" value={draft.layout.sealScale} min={SCALE_RANGE.min} max={SCALE_RANGE.max} step={0.05} unit="%" onChange={v => editLayout({ sealScale: v })} />
                    <Slider label="Sang ngang" value={draft.layout.sealDx} min={OFFSET_RANGE.min} max={OFFSET_RANGE.max} step={2} unit="px" onChange={v => editLayout({ sealDx: v })} />
                    <Slider label="Lên / xuống" value={draft.layout.sealDy} min={OFFSET_RANGE.min} max={OFFSET_RANGE.max} step={2} unit="px" onChange={v => editLayout({ sealDy: v })} />
                    <Slider label="Làm rõ, đậm màu" value={draft.layout.sealInk} min={0} max={1} step={0.05} unit="%" onChange={v => editLayout({ sealInk: v })} />
                    <label className="flex items-center gap-2 text-[12.5px] text-[#1d1d1f] pt-2"><Switch on={draft.layout.sealOnTop} onChange={v => editLayout({ sealOnTop: v })} />Ký trước, đóng dấu sau <span className="text-[11.5px] text-[#86868b]">(con dấu nằm trên chữ ký)</span></label>
                    <button type="button" onClick={() => setDraft({ ...draft, layout: { ...DEFAULT_LAYOUT, logoOwn: draft.layout.logoOwn, header: draft.layout.header } })} className="text-[12px] font-medium text-[#0071e3] pt-1">Về vị trí mặc định</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {canSign && draft && entity && (
          <div className="shrink-0 border-t border-[#f2f2f4] px-6 py-3 flex items-center gap-3">
            <button type="button" disabled={!dirty || busy} onClick={save} className={btnPrimary}>{busy && <Loader2 size={13} className="animate-spin" />}Lưu thay đổi</button>
            {dirty && <button type="button" disabled={busy} onClick={() => { setDraft(fresh()); setErr(null); }} className={btnGhost}>Huỷ</button>}
            {dirty && <span className="text-[11.5px] text-[#b25e00]">Có thay đổi chưa lưu</span>}
            {entity.stamp_id && <button type="button" disabled={busy} onClick={remove} className="ml-auto text-[13px] font-medium text-[#d70015] hover:underline">{legal ? 'Xoá chữ ký, con dấu' : 'Xoá pháp nhân'}</button>}
          </div>
        )}
        {canSign && <div className="px-6 pb-4 -mt-1 text-[11.5px] text-[#86868b] leading-snug shrink-0">Ảnh chữ ký và con dấu được lưu riêng. Nhân viên chèn vào giấy tờ thì quản trị viên được báo ngay; mỗi lần xuất có chữ ký/con dấu đều được ghi vào nhật ký.</div>}
      </div>
    </div>
  );
}
