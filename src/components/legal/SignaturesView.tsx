// Pháp lý → tab "Chữ ký": KHO CHỮ KÝ. Tải ảnh gốc (chưa tách nền) 1 lần, chọn chữ ký đi với pháp nhân nào.
// Tách nền / làm đậm / lên màu mực xem trực tiếp trên ảnh mẫu; lưu xong app tự đẩy sang bộ ký/dấu của các pháp nhân đã chọn.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, PenLine, Plus, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { listEntities } from '../../lib/costPlan/api';
import type { QuoteEntity } from '../../lib/costPlan/entity';
import { prepareStampImage } from '../../lib/imageCutout';
import { enhanceInk } from '../../lib/imageInk';
import { deleteSignature, listSignatures, processSignature, pushSignature, saveSignature, type LegalSignature, type SigSettings } from '../../lib/legal/signatures';
import { Sheet } from '../../modules/cskh/components/Sheet';
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from '../workspace/wsTheme';
import { CHECKER } from '../workspace/costplan/ImagePicker';
import { Slider } from '../workspace/costplan/EntityManager';
import { Switch } from '../workspace/costplan/ui';

/** Ảnh chữ ký đã xử lý như khi dùng trên giấy tờ (tách nền + làm đậm + màu mực). */
function useProcessed(original: string | null, settings: SigSettings) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!original) { setUrl(null); return; }
    (async () => {
      try {
        const base = await processSignature({ original, settings });
        const out = await enhanceInk(base, 'sig', settings.ink);
        if (alive) setUrl(out);
      } catch { if (alive) setUrl(original); }
    })();
    return () => { alive = false; };
  }, [original, settings.cutout, settings.ink]);  // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

function SigThumb({ sig, className = '' }: { sig: Pick<LegalSignature, 'original' | 'settings'>; className?: string }) {
  const url = useProcessed(sig.original, sig.settings);
  return <div className={`rounded-lg ring-1 ring-black/10 flex items-center justify-center overflow-hidden ${className}`} style={CHECKER}>{url ? <img src={url} alt="" className="max-w-full max-h-full object-contain" /> : <Loader2 size={14} className="animate-spin text-[#a1a1a6]" />}</div>;
}

export default function SignaturesView({ toast }: { toast: (m: string) => void }) {
  const { token } = useAuth();
  const [sigs, setSigs] = useState<LegalSignature[] | null>(null);
  const [entities, setEntities] = useState<QuoteEntity[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ sig: LegalSignature | null; original?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [s, e] = await Promise.all([listSignatures(token), listEntities(token)]);
      setSigs(s); setEntities(e.entities.filter(x => x.legal_id)); setErr(null);
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); setSigs([]); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const pickFile = async (f: File) => {
    setBusy(true);
    try { const r = await prepareStampImage(f, { cutout: false }); setEdit({ sig: null, original: r.original }); }
    catch (x) { toast(x instanceof Error ? x.message : String(x)); }
    setBusy(false);
  };
  const entName = (id: string) => entities.find(e => e.legal_id === id)?.label ?? 'Pháp nhân đã xoá';

  return (
    <div className="h-full overflow-y-auto p-3 md:p-5">
      <div className="max-w-[980px] mx-auto space-y-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Kho chữ ký</h2>
            <p className="text-[12.5px] text-[#86868B] mt-0.5">Tải ảnh chữ ký gốc (chưa tách nền) 1 lần — hệ thống tách nền, làm đậm, lên màu mực như ký thật. Chọn chữ ký đi với pháp nhân nào, giấy tờ tự dùng.</p>
          </div>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={`${BTN_PRIMARY} h-9 px-4 text-[13px] shrink-0`}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Tải chữ ký
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickFile(f); }} />
        </div>
        {err && <div className="text-[12.5px] text-[#D70015] bg-[#FF3B30]/10 rounded-[12px] px-3.5 py-2.5">{err}</div>}
        {sigs === null && <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-[#86868B]" /></div>}
        {sigs && sigs.length === 0 && !err && (
          <div className={`${CARD} p-8 text-center text-[13px] text-[#86868B]`}><PenLine className="mx-auto mb-2" size={22} />Kho chưa có chữ ký. Bấm “Tải chữ ký” để thêm.</div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(sigs ?? []).map(s => (
            <button key={s.id} type="button" onClick={() => setEdit({ sig: s })} className={`${CARD} p-3 text-left hover:shadow-md transition`}>
              <SigThumb sig={s} className="h-24 w-full" />
              <div className="mt-2 text-[13.5px] font-semibold text-[#1D1D1F] truncate">{s.owner_name || 'Chưa ghi tên người ký'}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {s.entity_ids.length === 0 && <span className="text-[11.5px] text-[#AEAEB2]">Chưa gán pháp nhân</span>}
                {s.entity_ids.map(id => <span key={id} className="text-[11.5px] px-2 py-0.5 rounded-full bg-[#EAF3FF] text-[#0066CC]">{entName(id)}</span>)}
              </div>
            </button>
          ))}
        </div>
      </div>
      {edit && token && (
        <SignatureEditor token={token} sig={edit.sig} original={edit.original ?? edit.sig?.original ?? ''} entities={entities} all={sigs ?? []}
          onClose={() => setEdit(null)} toast={toast} onSaved={async () => { setEdit(null); await load(); }} />
      )}
    </div>
  );
}

function SignatureEditor({ token, sig, original: initial, entities, all, onClose, onSaved, toast }: {
  token: string; sig: LegalSignature | null; original: string; entities: QuoteEntity[]; all: LegalSignature[];
  onClose: () => void; onSaved: () => Promise<void>; toast: (m: string) => void;
}) {
  const [original, setOriginal] = useState(initial);
  const [owner, setOwner] = useState(sig?.owner_name ?? '');
  const [settings, setSettings] = useState<SigSettings>(sig?.settings ?? { cutout: true, ink: 0.7 });
  const [ids, setIds] = useState<string[]>(sig?.entity_ids ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useProcessed(original, settings);
  const usedBy = useMemo(() => {
    const m = new Map<string, LegalSignature>();
    for (const s of all) if (s.id !== sig?.id) for (const id of s.entity_ids) m.set(id, s);
    return m;
  }, [all, sig]);

  const toggle = (id: string) => setIds(x => (x.includes(id) ? x.filter(y => y !== id) : [...x, id]));
  const replace = async (f: File) => {
    try { setOriginal((await prepareStampImage(f, { cutout: false })).original); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
  };

  const save = async () => {
    if (!owner.trim()) { setErr('Ghi tên người ký (chủ chữ ký) để dễ phân biệt.'); return; }
    setBusy(true); setErr(null);
    try {
      const id = await saveSignature(token, { id: sig?.id, owner, original: !sig || original !== sig.original ? original : undefined, settings, entityIds: ids });
      const saved: LegalSignature = { id, owner_name: owner.trim(), original, settings, entity_ids: ids, updated_by: null, updated_at: '' };
      const removed = (sig?.entity_ids ?? []).filter(x => !ids.includes(x));
      for (const lid of ids) { const e = entities.find(x => x.legal_id === lid); if (e) await pushSignature(token, e, saved); }
      for (const lid of removed) {
        const e = entities.find(x => x.legal_id === lid);
        const other = all.find(s => s.id !== id && s.entity_ids.includes(lid));
        if (e && !other) await pushSignature(token, e, null);
      }
      toast(ids.length ? `Đã lưu chữ ký và áp dụng cho ${ids.length} pháp nhân` : 'Đã lưu chữ ký vào kho');
      await onSaved();
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); setBusy(false); }
  };
  const remove = async () => {
    if (!sig) return;
    const n = sig.entity_ids.length;
    if (!window.confirm(`Xoá chữ ký của “${sig.owner_name || 'chưa đặt tên'}” khỏi kho?${n ? `\n\n${n} pháp nhân đang dùng chữ ký này vẫn giữ bản đã áp dụng cho tới khi bạn gán chữ ký khác.` : ''}\n\nẢnh gốc đã xoá không khôi phục được.`)) return;
    setBusy(true);
    try { await deleteSignature(token, sig.id); await onSaved(); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); setBusy(false); }
  };

  return (
    <Sheet label="Chữ ký" onClose={onClose} wide>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">{sig ? 'Sửa chữ ký' : 'Thêm chữ ký'}</h2>
      <div className="mt-3 rounded-xl overflow-hidden ring-1 ring-black/10 h-40 flex items-center justify-center" style={CHECKER}>
        {preview ? <img src={preview} alt="" className="max-w-full max-h-full object-contain" /> : <Loader2 size={16} className="animate-spin text-[#a1a1a6]" />}
      </div>
      <div className="mt-1 flex items-center justify-between text-[12px] text-[#86868B]">
        <span>Xem trước đúng như khi in lên giấy tờ</span>
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 font-medium text-[#0066CC]"><Upload size={12} />Đổi ảnh gốc</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void replace(f); }} />
      </div>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="block text-[12px] font-medium text-[#6E6E73] mb-1">Tên người ký</span>
          <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="Nguyễn Thị Tâm" maxLength={120} className="w-full h-10 rounded-[10px] bg-[#F5F5F7] px-3 text-[14px] outline-none focus:ring-2 focus:ring-[#0071E3]/40" />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-[#1D1D1F]"><Switch on={settings.cutout} onChange={v => setSettings(s => ({ ...s, cutout: v }))} />Xoá nền trắng (ảnh chụp / scan trên giấy)</label>
        <Slider label="Rõ & đậm" value={settings.ink} min={0} max={1} step={0.05} unit="%" onChange={v => setSettings(s => ({ ...s, ink: v }))} />
        <p className="text-[11.5px] text-[#86868B] -mt-1.5">Kéo lên để nét chữ ký đậm hơn, mực xanh đậm như bút ký thật. 0% = giữ nguyên màu ảnh.</p>
        <div>
          <span className="block text-[12px] font-medium text-[#6E6E73] mb-1">Dùng cho pháp nhân</span>
          <div className="space-y-1">
            {entities.map(e => {
              const other = usedBy.get(e.legal_id as string);
              return (
                <label key={e.id} className="flex items-center gap-2.5 rounded-[10px] bg-[#F5F5F7] px-3 py-2 cursor-pointer">
                  <input type="checkbox" checked={ids.includes(e.legal_id as string)} onChange={() => toggle(e.legal_id as string)} className="w-4 h-4 accent-[#0071E3]" />
                  <span className="min-w-0 flex-1 text-[13px] font-medium truncate">{e.label}</span>
                  {e.legal?.legal_rep && <span className="text-[11.5px] text-[#86868B] truncate max-w-[40%]">ĐD: {e.legal.legal_rep}</span>}
                  {other && ids.includes(e.legal_id as string) && <span className="text-[11px] text-[#B25000] shrink-0">thay chữ ký của {other.owner_name || 'người khác'}</span>}
                </label>
              );
            })}
            {entities.length === 0 && <p className="text-[12.5px] text-[#86868B]">Chưa có pháp nhân ở Pháp lý.</p>}
          </div>
          <p className="text-[11.5px] text-[#86868B] mt-1">Mỗi pháp nhân dùng 1 chữ ký; chọn ở đây sẽ thay chữ ký đang dùng. Bỏ chọn = gỡ chữ ký khỏi pháp nhân đó.</p>
        </div>
      </div>
      {err && <p className="mt-3 text-[12.5px] text-[#D70015] bg-[#FF3B30]/10 rounded-[12px] px-3.5 py-2.5">{err}</p>}
      <div className="mt-4 flex items-center gap-2">
        {sig && <button type="button" onClick={remove} disabled={busy} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#D70015] px-2"><Trash2 size={14} />Xoá</button>}
        <div className="flex-1" />
        <button type="button" onClick={onClose} className={`${BTN_SECONDARY} h-9 px-4 text-[13px]`}>Huỷ</button>
        <button type="button" onClick={save} disabled={busy || !original} className={`${BTN_PRIMARY} h-9 px-5 text-[13px]`}>{busy && <Loader2 size={14} className="animate-spin" />}Lưu</button>
      </div>
    </Sheet>
  );
}
