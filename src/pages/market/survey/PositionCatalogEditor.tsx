// Sửa danh mục ngành nghề của ảnh chỉ tiêu: thêm / đổi tên / gộp / bỏ ngành, và CHỌN LẠI ngành cho từng công ty
// đang dùng ngành đó (ảnh lưu ngành dạng chữ → đổi tên là sửa chữ trên từng ảnh; mọi lần sửa ảnh có Lịch sử dữ liệu).
// Ngành gõ tay (chưa có trong danh mục) cũng hiện ở đây để chuẩn hoá: gộp vào ngành có sẵn hoặc thêm vào danh mục.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { planPositionChange, positionKey, positionUsage, type PositionUsage, type UsagePhoto } from '../../../lib/kcnSurvey/positions';
import {
  addCatalogPosition, findCatalogItem, loadPositionUsagePhotos, POSITIONS_MIGRATION_HINT, PositionsMissingTable,
  removeCatalogPosition, renameCatalogPosition, writePhotoPositions, type PositionItem,
} from '../../../lib/kcnSurvey/positionsApi';
import { reloadPositionCatalog, usePositionCatalog } from './usePositionCatalog';

const KEEP = '__keep__';
const DROP = '__drop__';

export default function PositionCatalogEditor({ onClose, say, onPhotosPatched }: {
  onClose: () => void;
  say: (m: string) => void;
  /** Các ảnh vừa được sửa chữ ngành — để danh sách / ảnh đang xem cập nhật ngay. `rename` = đổi tên mặc định (để sửa ô đang gõ dở) */
  onPhotosPatched: (changes: { id: string; positions: string }[], rename: { from: string; to: string | null } | null) => void;
}) {
  const { items, missing } = usePositionCatalog();
  const { user } = useAuth();
  const userName = user?.full_name || user?.username || '';
  const [photos, setPhotos] = useState<UsagePhoto[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPositionUsagePhotos().then(p => { if (alive) setPhotos(p); }).catch(e => { if (alive) setLoadErr((e as Error).message); });
    return () => { alive = false; };
  }, []);

  const usage = useMemo(() => positionUsage(photos ?? []), [photos]);
  const customs = useMemo(() => [...usage.values()].filter(u => !findCatalogItem(items, u.name))
    .sort((a, b) => b.photoCount - a.photoCount || a.name.localeCompare(b.name, 'vi')), [usage, items]);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    if (missing) { say(POSITIONS_MIGRATION_HINT); return; }
    if (findCatalogItem(items, name)) { say(`Đã có ngành “${name}” trong danh mục`); return; }
    setBusy(true);
    try {
      await addCatalogPosition(name, items.reduce((m, i) => Math.max(m, i.sort), 0) + 10, userName);
      await reloadPositionCatalog();
      setNewName('');
      say(`Đã thêm ngành “${name}”`);
    } catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };

  const applied = (changes: { id: string; positions: string }[], rename: { from: string; to: string | null } | null) => {
    if (!changes.length && !rename) return;
    const m = new Map(changes.map(c => [c.id, c.positions]));
    if (changes.length) setPhotos(list => (list ?? []).map(p => (m.has(p.id) ? { ...p, positions: m.get(p.id)! } : p)));
    onPhotosPatched(changes, rename);
  };

  const detailUsage = detail ? usage.get(detail) ?? null : null;
  const detailItem = detail ? items.find(i => positionKey(i.name) === detail) ?? null : null;

  return (
    <div className="fixed inset-0 z-[1370] flex items-stretch md:items-center justify-center bg-black/50">
      <div className="relative w-full md:max-w-xl md:h-[86vh] md:rounded-2xl bg-[#F2F2F7] text-[#1D1D1F] flex flex-col overflow-hidden pt-[env(safe-area-inset-top)] md:pt-0">
        {detail ? (
          <DetailView key={detail} name={detailItem?.name ?? detailUsage?.name ?? ''} item={detailItem} usage={detailUsage} items={items} missing={missing}
            userName={userName} say={say} onBack={() => setDetail(null)} onApplied={applied} />
        ) : (
          <>
            <div className="flex items-center h-12 px-2 border-b border-black/5 bg-white shrink-0">
              <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center text-[#8E8E93]" aria-label="Đóng"><X size={20} /></button>
              <div className="flex-1 text-center text-[16px] font-semibold">Danh mục ngành nghề</div>
              <div className="w-10" />
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
              {missing && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[12.5px] px-3 py-2 flex gap-2">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span>{POSITIONS_MIGRATION_HINT}. Trong lúc chờ vẫn đổi được chữ ngành trên ảnh (chọn lại cho từng công ty).</span>
                </div>
              )}
              <div className="flex gap-2">
                <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
                  placeholder="Thêm ngành mới — VD: Công nhân điện tử"
                  className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-white text-[14px] outline-none border border-black/5 focus:ring-2 focus:ring-[#0A84FF]/40" />
                <button onClick={() => void add()} disabled={busy || !newName.trim()} className="h-10 px-3.5 rounded-xl bg-[#0A84FF] text-white text-[14px] font-semibold inline-flex items-center gap-1 disabled:opacity-40">
                  <Plus size={15} /> Thêm
                </button>
              </div>
              {loadErr && <div className="text-[12.5px] text-[#D70015]">Không tải được số công ty đang dùng: {loadErr}</div>}

              <section>
                <div className="px-1 pb-1.5 text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide">Trong danh mục ({items.length})</div>
                <div className="rounded-xl bg-white divide-y divide-black/5 overflow-hidden">
                  {items.map(i => <Row key={i.id ?? i.name} name={i.name} u={usage.get(positionKey(i.name))} loading={!photos && !loadErr} onClick={() => setDetail(positionKey(i.name))} />)}
                </div>
              </section>

              {customs.length > 0 && (
                <section>
                  <div className="px-1 pb-1 text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide">Gõ tay — chưa có trong danh mục ({customs.length})</div>
                  <div className="px-1 pb-1.5 text-[11.5px] text-[#8E8E93]">Bấm để gộp vào ngành có sẵn hoặc thêm vào danh mục cho chuẩn.</div>
                  <div className="rounded-xl bg-white divide-y divide-black/5 overflow-hidden">
                    {customs.map(u => <Row key={u.key} name={u.name} u={u} loading={false} onClick={() => setDetail(u.key)} />)}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ name, u, loading, onClick }: { name: string; u: PositionUsage | undefined; loading: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 px-3 py-2.5 text-left active:bg-black/5">
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] truncate">{name}</span>
        <span className="block text-[11.5px] text-[#8E8E93]">
          {loading ? 'Đang đếm…' : u ? `${u.companies.length} công ty · ${u.photoCount} ảnh` : 'Chưa ảnh nào chọn'}
        </span>
      </span>
      <ChevronRight size={16} className="text-[#C7C7CC] shrink-0" />
    </button>
  );
}

function DetailView({ name, item, usage, items, missing, userName, say, onBack, onApplied }: {
  name: string;
  item: PositionItem | null;
  usage: PositionUsage | null;
  items: PositionItem[];
  missing: boolean;
  userName: string;
  say: (m: string) => void;
  onBack: () => void;
  onApplied: (changes: { id: string; positions: string }[], rename: { from: string; to: string | null } | null) => void;
}) {
  const inCatalog = !!item;
  const [rename, setRename] = useState(name);
  const [removeAsked, setRemoveMode] = useState(false);
  // Chưa có bảng danh mục (migration 225) thì không có gì để "bỏ khỏi danh mục"
  const removeMode = removeAsked && !missing;
  const [addToCatalog, setAddToCatalog] = useState(true);
  /** Mỗi công ty: KEEP = giữ ngành này (theo tên mới) · DROP = bỏ · hoặc tên 1 ngành khác trong danh mục */
  const [targets, setTargets] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);

  const finalTyped = rename.trim();
  const others = items.filter(i => positionKey(i.name) !== positionKey(name));
  // Đổi sang đúng tên 1 ngành khác đang có → gộp vào ngành đó
  const mergeInto = finalTyped ? others.find(i => positionKey(i.name) === positionKey(finalTyped)) ?? null : null;
  const finalName = mergeInto?.name ?? finalTyped;
  const renamed = finalTyped !== name;
  const companies = usage?.companies ?? [];

  const keepLabel = removeMode ? `Giữ chữ “${name}” (gõ tay)` : renamed && finalName ? `→ ${finalName}` : `Giữ “${name}”`;
  const resolve = (v: string | undefined): string | null => {
    if (!v || v === KEEP) return removeMode ? name : (finalName || name);
    if (v === DROP) return null;
    return v;
  };
  const resolved = new Map(companies.map(c => [c.key, resolve(targets.get(c.key))]));
  const changes = usage ? planPositionChange(usage, resolved, resolve(undefined)) : [];
  const touchedCompanies = companies.filter(c => c.photos.some(p => changes.some(x => x.id === p.id))).length;

  const setAll = (v: string) => setTargets(new Map(companies.map(c => [c.key, v])));
  const setOne = (k: string, v: string) => setTargets(m => new Map(m).set(k, v));

  const catalogOp = (): (() => Promise<void>) | null => {
    if (missing) return null;
    if (item?.id) {
      if (removeMode || mergeInto) return () => removeCatalogPosition(item.id!, userName);
      if (renamed && finalName) return () => renameCatalogPosition(item.id!, finalName, userName);
      return null;
    }
    if (!item && !removeMode && addToCatalog && !mergeInto && finalName) {
      return () => addCatalogPosition(finalName, items.reduce((m, i) => Math.max(m, i.sort), 0) + 10, userName).then(() => undefined);
    }
    return null;
  };
  const op = catalogOp();
  const nothing = !op && !changes.length;

  const apply = async () => {
    if (!removeMode && !finalName) { say('Tên ngành không được để trống'); return; }
    if (changes.length) {
      const what = removeMode ? `Bỏ “${name}” khỏi danh mục` : mergeInto ? `Gộp “${name}” vào “${mergeInto.name}”` : renamed ? `Đổi “${name}” → “${finalName}”` : `Chọn lại ngành “${name}”`;
      if (!window.confirm(`${what}\n\nSẽ sửa chữ ngành trên ${changes.length} ảnh của ${touchedCompanies} công ty (theo lựa chọn từng công ty bên dưới).\nMỗi ảnh có Lịch sử dữ liệu — khôi phục được nếu sửa nhầm.\n\nTiếp tục?`)) return;
    }
    setBusy('Đang lưu…');
    const rename = !removeMode && finalName && (renamed || mergeInto) ? { from: name, to: finalName } : null;
    try {
      if (changes.length) {
        const r = await writePhotoPositions(changes, n => setBusy(`Đang sửa ảnh ${n}/${changes.length}…`));
        onApplied(r.done, r.error ? null : rename);
        if (r.error) { say(`Mới sửa được ${r.done.length}/${changes.length} ảnh — lỗi: ${r.error}. Bấm Lưu lần nữa để sửa tiếp.`); return; }
      }
      if (op) {
        try { await op(); } catch (e) {
          if (e instanceof PositionsMissingTable) say(POSITIONS_MIGRATION_HINT); else throw e;
        }
        await reloadPositionCatalog();
      }
      if (!changes.length && rename) onApplied([], rename);
      say(changes.length ? `Đã sửa ngành trên ${changes.length} ảnh của ${touchedCompanies} công ty` : 'Đã lưu danh mục');
      onBack();
    } catch (e) { say((e as Error).message); } finally { setBusy(null); }
  };

  // Điện thoại: ô chọn xuống dòng dưới tên công ty, rộng hết hàng (đọc được đủ chữ); máy tính: nằm cạnh
  const select = 'h-9 w-[calc(100%-50px)] ml-[50px] sm:ml-0 sm:w-auto sm:max-w-[52%] pl-2 pr-7 rounded-lg bg-[#F2F2F7] text-[13px] outline-none border-0';
  const options = (
    <>
      <option value={KEEP}>{keepLabel}</option>
      {others.filter(i => !mergeInto || i !== mergeInto).map(i => <option key={i.id ?? i.name} value={i.name}>→ {i.name}</option>)}
      <option value={DROP}>✕ Bỏ ngành này khỏi công ty</option>
    </>
  );

  return (
    <>
      <div className="flex items-center h-12 px-1 border-b border-black/5 bg-white shrink-0">
        <button onClick={onBack} disabled={!!busy} className="h-10 pl-1 pr-3 text-[16px] text-[#0A84FF] inline-flex items-center"><ChevronLeft size={22} /> Danh mục</button>
        <div className="flex-1" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <section className="space-y-2">
          <div className="text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide px-1">{inCatalog ? 'Tên ngành' : 'Ngành gõ tay (chưa có trong danh mục)'}</div>
          <input value={rename} onChange={e => setRename(e.target.value)} disabled={removeMode}
            className="w-full h-11 px-3 rounded-xl bg-white text-[15px] outline-none border border-black/5 focus:ring-2 focus:ring-[#0A84FF]/40 disabled:opacity-50" />
          {mergeInto && !removeMode && (
            <div className="text-[12.5px] text-[#0A6B2E] bg-[#E8F7EE] rounded-lg px-3 py-2">Trùng tên ngành có sẵn “{mergeInto.name}” → sẽ GỘP vào ngành đó{inCatalog && !missing ? ' (bỏ “' + name + '” khỏi danh mục)' : ''}.</div>
          )}
          {!inCatalog && !removeMode && !mergeInto && (
            <label className="flex items-center gap-2 px-1 text-[13.5px]">
              <input type="checkbox" checked={addToCatalog} onChange={e => setAddToCatalog(e.target.checked)} className="w-4 h-4 accent-[#0A84FF]" />
              Thêm vào danh mục để lần sau chọn nhanh
            </label>
          )}
          {inCatalog && !missing && (
            <button onClick={() => { setRemoveMode(v => !v); setRename(name); }}
              className={`h-9 px-3 rounded-full text-[13px] font-medium inline-flex items-center gap-1.5 ${removeMode ? 'bg-[#D70015] text-white' : 'bg-white text-[#D70015] border border-[#D70015]/30'}`}>
              <Trash2 size={13} /> {removeMode ? 'Sẽ bỏ khỏi danh mục — bấm để thôi' : 'Bỏ ngành này khỏi danh mục'}
            </button>
          )}
          {missing && <div className="text-[11.5px] text-amber-700 px-1">{POSITIONS_MIGRATION_HINT} — lần này chỉ sửa chữ ngành trên ảnh.</div>}
        </section>

        <section>
          <div className="flex items-end gap-2 px-1 pb-1.5">
            <div className="flex-1 text-[12px] font-semibold text-[#8E8E93] uppercase tracking-wide">
              {companies.length ? `${companies.length} công ty đang chọn ngành này` : 'Chưa công ty nào chọn ngành này'}
            </div>
            {companies.length > 1 && (
              <select value="" onChange={e => { if (e.target.value) setAll(e.target.value); }} className="h-8 pl-2 pr-6 rounded-lg bg-white text-[12px] text-[#0A84FF] border border-black/5 max-w-[50%]">
                <option value="">Chọn cho tất cả…</option>
                {options}
              </select>
            )}
          </div>
          {companies.length > 0 && (
            <>
              <div className="px-1 pb-1.5 text-[11.5px] text-[#8E8E93]">Chọn lại cho từng công ty nếu ngành “{name}” chưa đúng với công ty đó.</div>
              <div className="rounded-xl bg-white divide-y divide-black/5 overflow-hidden">
                {companies.map(c => {
                  const v = targets.get(c.key) ?? KEEP;
                  const thumb = c.photos.find(p => p.thumb_url)?.thumb_url ?? c.photos[0]?.url;
                  return (
                    <div key={c.key} className="flex flex-wrap sm:flex-nowrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2">
                      {thumb ? <img src={thumb} alt="" loading="lazy" className="w-10 h-10 rounded-lg object-cover bg-[#E5E5EA] shrink-0" /> : <div className="w-10 h-10 rounded-lg bg-[#E5E5EA] shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className={`text-[14px] truncate ${c.name ? '' : 'text-[#8E8E93] italic'}`}>{c.name || 'Chưa rõ công ty'}</div>
                        <div className="text-[11.5px] text-[#8E8E93] truncate">{c.photos.length} ảnh{c.zones.length ? ` · ${c.zones.join(', ')}` : ''}</div>
                      </div>
                      <select value={v} onChange={e => setOne(c.key, e.target.value)} className={`${select} ${v === DROP ? 'text-[#D70015]' : v === KEEP ? '' : 'text-[#0A84FF] font-medium'}`}>
                        {options}
                      </select>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
      <div className="shrink-0 bg-white border-t border-black/5 px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] space-y-1.5">
        <div className="text-[12px] text-[#8E8E93] text-center min-h-[16px]">
          {busy ?? (changes.length ? `Sẽ sửa ${changes.length} ảnh của ${touchedCompanies} công ty` : nothing ? 'Chưa có gì thay đổi' : 'Chỉ sửa danh mục, không đổi ảnh nào')}
        </div>
        <button onClick={() => void apply()} disabled={!!busy || nothing || (!removeMode && !finalName)}
          className="w-full h-11 rounded-full bg-[#0A84FF] text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40">
          {busy && <Loader2 size={16} className="animate-spin" />} Lưu thay đổi
        </button>
      </div>
    </>
  );
}
