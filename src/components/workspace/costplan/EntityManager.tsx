// Quản lý PHÁP NHÂN gửi báo giá (tối đa 5): mỗi pháp nhân có tên gọi, thông tin công ty, logo, chữ ký, con dấu và cách căn chữ ký/con dấu.
// Chỉ admin sửa được; người khác chỉ xem danh sách.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, X } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { deleteEntity, saveEntity } from '../../../lib/costPlan/api';
import { DEFAULT_LAYOUT, MAX_ENTITIES, OFFSET_RANGE, SCALE_RANGE, stampBoxes, type QuoteEntity, type StampLayout } from '../../../lib/costPlan/entity';
import { emptyProfile, type CompanyProfileData } from '../../../lib/costPlan/quoteDoc';
import ImagePicker, { CHECKER } from './ImagePicker';
import { useInk } from './useInk';
import { FONT, Switch, btnGhost, btnPrimary, field, labelCls } from './ui';

const NEW = 'new';
interface Draft { label: string; data: CompanyProfileData; layout: StampLayout; logo?: string | null; signature?: string | null; seal?: string | null }
const F = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block"><span className={labelCls}>{label}</span>{children}</label>;

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

export default function EntityManager({ entities, canSign, selectedId, onClose, onChanged, onSelect }: {
  entities: QuoteEntity[]; canSign: boolean; selectedId: string | null;
  onClose: () => void; onChanged: () => Promise<void> | void; onSelect: (id: string) => void;
}) {
  const { token } = useAuth();
  const [cur, setCur] = useState<string>(selectedId && entities.some(e => e.id === selectedId) ? selectedId : entities[0]?.id ?? (canSign ? NEW : ''));
  const entity = entities.find(e => e.id === cur) ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Đổi pháp nhân đang sửa → nạp lại bản nháp từ dữ liệu đã lưu
  useEffect(() => {
    setErr(null);
    if (cur === NEW) setDraft({ label: '', data: emptyProfile(), layout: DEFAULT_LAYOUT, logo: null, signature: null, seal: null });
    else if (entity) setDraft({ label: entity.label, data: entity.data, layout: entity.layout });
    else setDraft(null);
  }, [cur, entity?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!draft && (cur === NEW || !entity || JSON.stringify({ l: draft.label, d: draft.data, y: draft.layout }) !== JSON.stringify({ l: entity.label, d: entity.data, y: entity.layout }) || 'logo' in draft || 'signature' in draft || 'seal' in draft);
  const data = draft?.data ?? emptyProfile();
  const editData = (p: Partial<CompanyProfileData>) => setDraft(d => (d ? { ...d, data: { ...d.data, ...p } } : d));
  const editLayout = (p: Partial<StampLayout>) => setDraft(d => (d ? { ...d, layout: { ...d.layout, ...p } } : d));
  const img = (k: 'logo' | 'signature' | 'seal', v: string | null) => setDraft(d => (d ? { ...d, [k]: v } : d));
  const logo = draft && 'logo' in draft ? draft.logo ?? null : entity?.logo ?? null;
  const sig = draft && 'signature' in draft ? draft.signature ?? null : entity?.signature ?? null;
  const seal = draft && 'seal' in draft ? draft.seal ?? null : entity?.seal ?? null;

  const save = async () => {
    if (!token || !draft) return;
    if (!draft.label.trim()) { setErr('Đặt tên gọi cho pháp nhân (vd: Let’s Go VN – HCM) để dễ chọn.'); return; }
    setBusy(true); setErr(null);
    try {
      const id = await saveEntity(token, { id: cur === NEW ? null : cur, label: draft.label, data: draft.data, layout: draft.layout, logo: 'logo' in draft ? draft.logo ?? null : undefined, signature: 'signature' in draft ? draft.signature ?? null : undefined, seal: 'seal' in draft ? draft.seal ?? null : undefined });
      await onChanged();
      setCur(id); onSelect(id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const remove = async () => {
    if (!token || !entity) return;
    if (!window.confirm(`Xoá pháp nhân “${entity.label}” cùng ảnh chữ ký và con dấu? Không khôi phục được.`)) return;
    setBusy(true);
    try { await deleteEntity(token, entity.id); await onChanged(); setCur(entities.find(e => e.id !== entity.id)?.id ?? (canSign ? NEW : '')); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const dis = !canSign;
  return (
    <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-3" style={{ fontFamily: FONT }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-2xl max-h-[92vh] flex flex-col text-[#1d1d1f]">
        <div className="flex items-start justify-between px-6 pt-5 pb-3 shrink-0">
          <div>
            <div className="text-[19px] font-semibold tracking-tight">Pháp nhân gửi báo giá</div>
            <div className="text-[12.5px] text-[#86868b] mt-0.5">Mỗi pháp nhân có thông tin, logo, chữ ký, con dấu riêng — chọn khi xuất báo giá (tối đa {MAX_ENTITIES})</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 -mr-2 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7]"><X size={17} /></button>
        </div>

        <div className="px-6 flex flex-wrap items-center gap-2 pb-3 shrink-0">
          {entities.map(e => (
            <button key={e.id} type="button" onClick={() => setCur(e.id)} className={`h-8 px-3.5 rounded-full text-[13px] font-medium transition ${cur === e.id ? 'bg-[#1d1d1f] text-white' : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'}`}>{e.label}</button>
          ))}
          {cur === NEW && <span className="h-8 px-3.5 rounded-full text-[13px] font-medium bg-[#0071e3] text-white inline-flex items-center">Pháp nhân mới</span>}
          {canSign && entities.length < MAX_ENTITIES && cur !== NEW && (
            <button type="button" onClick={() => setCur(NEW)} className="h-8 px-3 rounded-full text-[13px] font-medium text-[#0071e3] hover:bg-[#eef5ff] inline-flex items-center gap-1"><Plus size={14} />Thêm pháp nhân</button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-5 space-y-4 border-t border-[#f2f2f4] pt-4">
          {!canSign && <div className="text-[12.5px] text-[#86868b] bg-[#f5f5f7] rounded-xl px-4 py-3">Bạn xem được thông tin và logo. Chữ ký, con dấu và việc thêm/sửa pháp nhân chỉ dành cho admin.</div>}
          {err && <div className="flex gap-2 text-[12.5px] text-[#b3140a] bg-[#fff1f0] rounded-xl px-3.5 py-2.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>{err}</span></div>}
          {!draft && <div className="text-[13px] text-[#86868b] py-8 text-center">{canSign ? 'Chưa có pháp nhân nào.' : 'Chưa có pháp nhân nào — nhờ admin tạo.'}</div>}

          {draft && (
            <>
              <F label="Tên gọi (để chọn nhanh)"><input disabled={dis} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} className={`${field} w-full`} placeholder="vd: Let’s Go VN – TP.HCM" /></F>
              <F label="Tên công ty (in đầu báo giá)"><input disabled={dis} value={data.name} onChange={e => editData({ name: e.target.value })} className={`${field} w-full`} placeholder="CÔNG TY TNHH …" /></F>
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

              <ImagePicker label="Logo công ty" hint="Hiện ở đầu báo giá. Nên dùng PNG nền trong suốt." value={logo} onChange={v => img('logo', v)} cutoutDefault={false} disabled={dis} />
              {(canSign || entity?.has_signature) && <ImagePicker label="Chữ ký người đại diện" hint={canSign ? 'Ảnh chụp/scan chữ ký trên giấy trắng — hệ thống tự xoá nền.' : 'Chỉ admin xem và dùng được.'} value={sig} onChange={v => img('signature', v)} cutoutDefault disabled={dis} />}
              {(canSign || entity?.has_seal) && <ImagePicker label="Con dấu công ty" hint={canSign ? 'Ảnh con dấu (dấu đỏ trên giấy trắng) — hệ thống tự xoá nền.' : 'Chỉ admin xem và dùng được.'} value={seal} onChange={v => img('seal', v)} cutoutDefault disabled={dis} />}

              {canSign && (
                <div className="space-y-2.5">
                  <div className="text-[13px] font-semibold">Căn chỉnh chữ ký & con dấu</div>
                  <div className="text-[11.5px] text-[#86868b] -mt-1.5">Mặc định: chữ ký ở giữa, con dấu lệch trái và đè một phần lên chữ ký. Chỉnh cho khớp ý bạn — áp dụng cho cả bản PDF và file Excel mẫu.</div>
                  <StampPreview layout={draft.layout} signature={sig} seal={seal} name={data.signerName} />
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
                    <button type="button" onClick={() => setDraft({ ...draft, layout: DEFAULT_LAYOUT })} className="text-[12px] font-medium text-[#0071e3] pt-1">Về vị trí mặc định</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {canSign && draft && (
          <div className="shrink-0 border-t border-[#f2f2f4] px-6 py-3 flex items-center gap-3">
            <button type="button" disabled={!dirty || busy} onClick={save} className={btnPrimary}>{busy && <Loader2 size={13} className="animate-spin" />}{cur === NEW ? 'Tạo pháp nhân' : 'Lưu thay đổi'}</button>
            {dirty && cur !== NEW && <span className="text-[11.5px] text-[#b25e00]">Có thay đổi chưa lưu</span>}
            {cur === NEW && <button type="button" onClick={() => setCur(entities[0]?.id ?? NEW)} className={btnGhost}>Huỷ</button>}
            {entity && cur !== NEW && <button type="button" disabled={busy} onClick={remove} className="ml-auto text-[13px] font-medium text-[#d70015] hover:underline">Xoá pháp nhân</button>}
          </div>
        )}
        {canSign && <div className="px-6 pb-4 -mt-1 text-[11.5px] text-[#86868b] leading-snug shrink-0">Ảnh chữ ký và con dấu được lưu riêng, chỉ admin lấy được. Mỗi lần xuất có chèn chữ ký/con dấu đều được ghi vào nhật ký.</div>}
      </div>
    </div>
  );
}
