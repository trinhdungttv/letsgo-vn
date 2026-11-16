// "Khu vực" của Bảng nháp đầu mối — 2 việc:
//   1. Ghép chữ cũ: mọi cụm chữ khu vực chưa ghép (Thủ Đức, Vsip1, Bình Dương…) gộp qua tất cả đầu mối —
//      chọn 1 lần là áp cho mọi người có cụm đó. Cụm trùng tên mục trong danh sách được chọn sẵn.
//      Chữ rác (tên người lỡ dán vào cột khu vực…) thì "Bỏ qua".
//   2. Danh sách: thêm / đổi tên / xoá khu vực ngoài KCN (bảng sale_lead_areas — migration 229).
//      KCN thì quản lý ở Thị trường → Khu vực (dùng chung với hồ sơ Sale / CTV).
import { useMemo, useState } from 'react';
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { deleteSaleLeadArea, renameSaleLeadArea, setLeadAreas, SALE_LEAD_AREAS_MIGRATION_HINT } from '../../../lib/saleLeads/api';
import {
  applyAreaDecisions, areaKey, matchAreaZones, pendingAreaParts, type AreaDecision, type NamedItem,
} from '../../../lib/saleLeads/match';
import type { SaleLead } from '../../../lib/saleLeads/types';
import { Segmented } from '../components/apple';
import { Sheet, SHEET_FOOTER } from '../components/Sheet';
import { inputCls } from '../ui';
import { AreaPicker } from './AreaPicker';
import { AREA_CHIP, shortZone } from './helpers';

type Tab = 'map' | 'list';

export function LeadAreaManageSheet({ leads, zones, areas, areasReady, onCreateArea, reloadAreas, toast, onClose, onSaved }: {
  leads: readonly SaleLead[];
  zones: readonly NamedItem[];
  areas: readonly NamedItem[];
  areasReady: boolean;
  onCreateArea: (name: string) => Promise<NamedItem | null>;
  reloadAreas: () => Promise<void>;
  toast: (m: string) => void;
  onClose: () => void;
  /** Đã ghi đầu mối → nạp lại bảng. */
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const parts = useMemo(() => pendingAreaParts(leads, zones, areas), [leads, zones, areas]);
  const [tab, setTab] = useState<Tab>(parts.length ? 'map' : 'list');
  const [picked, setPicked] = useState<ReadonlyMap<string, AreaDecision>>(() => new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const byId = useMemo(() => new Map(leads.map(l => [l.id, l])), [leads]);
  const zoneName = useMemo(() => new Map(zones.map(z => [z.id, z.name])), [zones]);
  const areaName = useMemo(() => new Map(areas.map(a => [a.id, a.name])), [areas]);
  const catalogKeys = useMemo(() => new Set([...zones, ...areas].map(x => areaKey(x.name))), [zones, areas]);

  // Cụm trùng tên 1 mục trong danh sách → chọn sẵn mục đó
  const auto = useMemo(() => {
    const m = new Map<string, AreaDecision>();
    for (const p of parts) {
      const r = matchAreaZones(p.text, zones, areas);
      if (r.ids.length || r.areaIds.length) m.set(p.key, { zoneIds: r.ids, areaIds: r.areaIds });
    }
    return m;
  }, [parts, zones, areas]);
  const decisions = useMemo(() => {
    const m = new Map(auto);
    for (const [k, d] of picked) m.set(k, d);
    return m;
  }, [auto, picked]);
  const decisionOf = (key: string): AreaDecision => decisions.get(key) ?? { zoneIds: [], areaIds: [] };
  const setDecision = (key: string, d: AreaDecision) => setPicked(prev => new Map(prev).set(key, d));

  const plan = useMemo(() => leads.flatMap(l => {
    const next = applyAreaDecisions(l, zones, areas, decisions);
    return next ? [{ lead: l, next }] : [];
  }), [leads, zones, areas, decisions]);
  const decidedParts = parts.filter(p => { const d = decisions.get(p.key); return !!d && (d.skip || d.zoneIds.length > 0 || d.areaIds.length > 0); }).length;

  const createFor = async (key: string, text: string) => {
    const made = await onCreateArea(text);
    if (made) setDecision(key, { zoneIds: [], areaIds: [made.id] });
  };

  const apply = async () => {
    if (!plan.length) return;
    setBusy(true);
    setError('');
    let n = 0;
    try {
      for (const { lead, next } of plan) {
        await setLeadAreas(lead.id, next, user);
        n++;
      }
      toast(`Đã ghép khu vực cho ${n} đầu mối`);
      setPicked(new Map());
      setOpen(null);
      onSaved();
    } catch (e) {
      setError(`${(e as Error).message}${n ? ` — đã lưu ${n} đầu mối trước đó` : ''}`);
      if (n) onSaved();
    } finally {
      setBusy(false);
    }
  };

  // ── Danh sách ──
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) for (const id of l.areaIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [leads]);
  const zoneUsed = useMemo(() => new Set(leads.flatMap(l => l.zoneIds)).size, [leads]);

  const addNew = async () => {
    if (!newName.trim()) return;
    const made = await onCreateArea(newName);
    if (made) setNewName('');
  };
  const rename = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await renameSaleLeadArea(editing.id, editing.name);
      await reloadAreas();
      setEditing(null);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (a: NamedItem) => {
    const n = usage.get(a.id) ?? 0;
    if (!confirm(`Xoá khu vực "${a.name}" khỏi danh sách?${n ? `\n\nĐang gắn cho ${n} đầu mối — sẽ gỡ khỏi các đầu mối này.` : ''}\n\nKhôi phục được ở trang Lịch sử (Hoàn tác).`)) return;
    setBusy(true);
    try {
      await deleteSaleLeadArea(a.id, leads, user);
      await reloadAreas();
      if (n) onSaved();
      toast(`Đã xoá khu vực "${a.name}"`);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  const chip = (label: string, cls: string, key: string) => (
    <span key={key} className={`px-2 h-6 inline-flex items-center rounded-full text-[11.5px] font-medium whitespace-nowrap ${cls}`}>{label}</span>
  );

  return (
    <Sheet label="Khu vực đầu mối" onClose={onClose} wide>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] pr-10">Khu vực</h2>
      <p className="text-[13px] text-[#6E6E73] mt-0.5 leading-snug">Mỗi khu vực là 1 mục trong danh sách — chọn cho đầu mối để lọc được.</p>

      {!areasReady ? (
        <p className="mt-4 rounded-[12px] bg-[#FF9500]/[0.12] px-3.5 py-3 text-[13px] leading-snug text-[#7A3E00]">{SALE_LEAD_AREAS_MIGRATION_HINT}</p>
      ) : (
        <>
          <div className="mt-3">
            <Segmented label="Khu vực" value={tab} onChange={setTab}
              options={[{ key: 'map', label: 'Ghép chữ cũ', badge: parts.length }, { key: 'list', label: 'Danh sách', badge: areas.length + zones.length }]} />
          </div>

          {tab === 'map' && (
            parts.length === 0 ? (
              <p className="mt-6 mb-4 text-center text-[13px] text-[#86868B]">Mọi đầu mối đã có khu vực trong danh sách — không còn chữ nào cần ghép.</p>
            ) : (
              <>
                <p className="mt-3 text-[12.5px] text-[#6E6E73] leading-snug">
                  Chữ khu vực lúc nhập chưa khớp danh sách. Chọn mục đúng cho từng cụm — áp cho <b>mọi</b> đầu mối có cụm đó.
                  Cụm trùng tên đã được chọn sẵn.
                </p>
                <ul className="mt-2 rounded-[14px] bg-white md:bg-[#F5F5F7] divide-y divide-[#E5E5EA]">
                  {parts.map(p => {
                    const d = decisionOf(p.key);
                    const isOpen = open === p.key;
                    const names = p.leadIds.map(id => byId.get(id)?.fullName || byId.get(id)?.phone).filter(Boolean);
                    const done = d.skip || d.zoneIds.length > 0 || d.areaIds.length > 0;
                    return (
                      <li key={p.key} className="px-3 md:px-4 py-2.5">
                        <div className="flex items-start gap-2.5">
                          <span className={`mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center ${done ? 'bg-[#34C759] text-white' : 'border-[1.5px] border-[#C7C7CC]'}`}>
                            {done && <Check size={12} strokeWidth={3} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <b className="text-[14px] font-semibold text-[#1D1D1F]">«{p.text}»</b>
                              <span className="text-[12px] text-[#86868B] truncate max-w-full" title={names.join(', ')}>
                                {p.leadIds.length} người · {names.slice(0, 3).join(', ')}{names.length > 3 ? '…' : ''}
                              </span>
                            </div>
                            {!isOpen && <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              {d.skip
                                ? <span className="text-[12px] text-[#86868B] italic">Bỏ qua — không gắn khu vực nào, thôi hiện chữ này</span>
                                : (d.zoneIds.length || d.areaIds.length)
                                  ? [
                                    ...d.zoneIds.map(id => chip(shortZone(zoneName.get(id) ?? '?'), AREA_CHIP.zone, `z${id}`)),
                                    ...d.areaIds.map(id => chip(areaName.get(id) ?? '?', AREA_CHIP.area, `a${id}`)),
                                  ]
                                  : <span className="text-[12px] text-[#B25000]">Chưa chọn</span>}
                            </div>}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <button type="button" onClick={() => setOpen(isOpen ? null : p.key)}
                                className={`inline-flex items-center gap-1 h-8 md:h-7 px-3 rounded-full text-[12.5px] font-medium transition ${isOpen ? 'bg-[#0071E3] text-white' : 'bg-[#0071E3]/10 text-[#0066CC] hover:bg-[#0071E3]/[0.16]'}`}>
                                Chọn từ danh sách <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                              </button>
                              {!catalogKeys.has(p.key) && !done && (
                                <button type="button" onClick={() => void createFor(p.key, p.text)}
                                  className="inline-flex items-center gap-1 h-8 md:h-7 px-3 rounded-full text-[12.5px] font-medium bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08] transition">
                                  <Plus size={13} strokeWidth={2.4} /> Tạo mục «{p.text.length > 24 ? `${p.text.slice(0, 24)}…` : p.text}»
                                </button>
                              )}
                              <button type="button" onClick={() => setDecision(p.key, d.skip ? { zoneIds: [], areaIds: [] } : { zoneIds: [], areaIds: [], skip: true })}
                                className="inline-flex items-center gap-1 h-8 md:h-7 px-3 rounded-full text-[12.5px] font-medium text-[#6E6E73] hover:bg-black/[0.05] transition">
                                {d.skip ? 'Thôi bỏ qua' : <><X size={13} /> Bỏ qua</>}
                              </button>
                            </div>
                            {isOpen && (
                              <div className="mt-2.5">
                                <AreaPicker zones={zones} areas={areas} areasReady={areasReady} initialQuery={p.text} listClass="max-h-[260px]"
                                  value={{ zoneIds: [...d.zoneIds], areaIds: [...d.areaIds] }}
                                  onChange={v => setDecision(p.key, v)} onCreate={onCreateArea} />
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {error && <p className="mt-3 text-[13px] text-[#D70015]">{error}</p>}
                <div className={`${SHEET_FOOTER} mt-4 flex flex-wrap items-center gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
                  <span className="flex-1 min-w-[160px] text-[12.5px] text-[#6E6E73]">
                    Đã chọn <b className="text-[#1D1D1F]">{decidedParts}</b> / {parts.length} cụm
                  </span>
                  <button type="button" onClick={onClose} className="h-10 md:h-9 px-4 rounded-full text-[13px] font-medium text-[#1D1D1F] bg-black/[0.05] hover:bg-black/[0.08] transition">Đóng</button>
                  <button type="button" onClick={() => void apply()} disabled={busy || !plan.length}
                    className="h-10 md:h-9 px-5 rounded-full text-[13px] font-semibold text-white bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 transition">
                    {busy ? 'Đang lưu…' : `Áp dụng · ${plan.length} đầu mối`}
                  </button>
                </div>
              </>
            )
          )}

          {tab === 'list' && (
            <div className="mt-3 space-y-3">
              <form onSubmit={e => { e.preventDefault(); void addNew(); }} className="flex gap-2">
                <input value={newName} onChange={e => setNewName(e.target.value)} className={inputCls} placeholder="Thêm khu vực — VD: Thuận An, Bến Lức, Quận 12" aria-label="Tên khu vực mới" />
                <button type="submit" disabled={!newName.trim()}
                  className="shrink-0 inline-flex items-center gap-1 h-10 md:h-9 px-4 rounded-full text-[13px] font-semibold text-white bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 transition">
                  <Plus size={15} strokeWidth={2.4} /> Thêm
                </button>
              </form>

              <section>
                <h3 className="px-1 mb-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B]">Khu vực · {areas.length}</h3>
                <ul className="rounded-[14px] bg-white md:bg-[#F5F5F7] divide-y divide-[#E5E5EA]">
                  {areas.length === 0 && <li className="px-4 py-4 text-center text-[13px] text-[#86868B]">Chưa có khu vực nào</li>}
                  {areas.map(a => (
                    <li key={a.id} className="flex items-center gap-2 px-3 md:px-4 min-h-[46px] md:min-h-[40px]">
                      {editing?.id === a.id ? (
                        <form onSubmit={e => { e.preventDefault(); void rename(); }} className="flex-1 flex items-center gap-1.5 py-1.5">
                          <input value={editing.name} onChange={e => setEditing({ id: a.id, name: e.target.value })} autoFocus aria-label="Tên mới"
                            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }} className={`${inputCls} !py-1.5`} />
                          <button type="submit" disabled={busy} className="shrink-0 h-8 px-3 rounded-full text-[12.5px] font-semibold text-white bg-[#0071E3] disabled:opacity-40">Lưu</button>
                          <button type="button" onClick={() => setEditing(null)} className="shrink-0 h-8 px-2.5 rounded-full text-[12.5px] text-[#6E6E73] hover:bg-black/[0.05]">Huỷ</button>
                        </form>
                      ) : (
                        <>
                          <span className={`px-2.5 h-7 inline-flex items-center rounded-full text-[12.5px] font-medium ${AREA_CHIP.area}`}>{a.name}</span>
                          <span className="flex-1 text-[12px] text-[#86868B] tabular-nums">{usage.get(a.id) ? `${usage.get(a.id)} đầu mối` : ''}</span>
                          <button type="button" onClick={() => setEditing({ id: a.id, name: a.name })} aria-label={`Đổi tên ${a.name}`} title="Đổi tên"
                            className="w-8 h-8 rounded-full flex items-center justify-center text-[#86868B] hover:bg-black/[0.05] hover:text-[#1D1D1F]"><Pencil size={14} /></button>
                          <button type="button" onClick={() => void remove(a)} disabled={busy} aria-label={`Xoá ${a.name}`} title="Xoá khỏi danh sách"
                            className="w-8 h-8 rounded-full flex items-center justify-center text-[#86868B] hover:bg-[#FF3B30]/10 hover:text-[#D70015] disabled:opacity-40"><Trash2 size={14} /></button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <p className="px-1 text-[12px] text-[#86868B] leading-snug">
                Cùng danh sách còn <b className="text-[#3C3C43]">{zones.length} KCN</b> ({zoneUsed} KCN đang có đầu mối) lấy từ <b>Thị trường → Khu vực</b> —
                thêm / sửa KCN ở đó vì dùng chung với hồ sơ Sale / CTV.
              </p>
              <div className={`${SHEET_FOOTER} mt-2 flex items-center gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
                <span className="flex-1" />
                <button type="button" onClick={onClose} className="h-10 md:h-9 px-5 rounded-full text-[13px] font-semibold text-white bg-[#0071E3] hover:bg-[#0077ED] transition">Xong</button>
              </div>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
