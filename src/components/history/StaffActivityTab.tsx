// Lịch sử → "Nhật ký nhân viên": ai nhập / sửa / xoá gì, bao nhiêu, ngày nào — và khôi phục các thay đổi đã chọn.
// Nguồn: data_history có cột người sửa (migration 218). Chỉ admin mở được trang Lịch sử.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, UserRound, X, Database } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { activitySummary, fetchActorEvents, NotInstalledError, type ActivityRow } from '../../lib/dataGuard';
import { tableLabel } from '../../lib/historyTables';
import { ROLE_LABELS, ROLE_COLORS } from '../../lib/constants';
import type { DataHistoryEntry } from '../../lib/types';
import EventDiff, { ACTION_UI, changeSummary, EventLine } from './EventDiff';
import RevertDialog from './RevertDialog';

interface Props {
  toast: (msg: string) => void;
  onReload: () => void;
}

type RangeKey = 'today' | '7d' | '30d' | 'month' | '90d';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
  { key: 'month', label: 'Tháng này' },
  { key: '90d', label: '90 ngày' },
];

function rangeOf(key: RangeKey): { from: Date; to: Date } {
  const to = new Date(Date.now() + 60_000);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (key === 'today') return { from: start, to };
  if (key === 'month') return { from: new Date(start.getFullYear(), start.getMonth(), 1), to };
  const days = key === '7d' ? 6 : key === '30d' ? 29 : 89;
  return { from: new Date(start.getTime() - days * 86_400_000), to };
}

/** yyyy-mm-dd theo giờ máy (khớp cột day = giờ Việt Nam của RPC). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Totals { ins: number; upd: number; del: number }
interface ActorAgg extends Totals {
  id: string; name: string; role: string;
  days: Set<string>;
  byTable: Map<string, Totals>;
  byDay: Map<string, Totals>;
}

const add = (t: Totals, action: string, n: number) => {
  if (action === 'INSERT') t.ins += n; else if (action === 'UPDATE') t.upd += n; else t.del += n;
};

function aggregate(rows: ActivityRow[]): ActorAgg[] {
  const m = new Map<string, ActorAgg>();
  for (const r of rows) {
    let a = m.get(r.actor_id);
    if (!a) {
      a = { id: r.actor_id, name: r.actor_name || '(không rõ tên)', role: r.actor_role || '', ins: 0, upd: 0, del: 0, days: new Set(), byTable: new Map(), byDay: new Map() };
      m.set(r.actor_id, a);
    }
    add(a, r.action, r.n);
    a.days.add(r.day);
    const t = a.byTable.get(r.table_name) ?? { ins: 0, upd: 0, del: 0 };
    add(t, r.action, r.n); a.byTable.set(r.table_name, t);
    const d = a.byDay.get(r.day) ?? { ins: 0, upd: 0, del: 0 };
    add(d, r.action, r.n); a.byDay.set(r.day, d);
  }
  return [...m.values()].sort((x, y) => (y.ins + y.upd + y.del) - (x.ins + x.upd + x.del));
}

const sumT = (t: Totals) => t.ins + t.upd + t.del;

export default function StaffActivityTab({ toast, onReload }: Props) {
  const { token } = useAuth();
  const [range, setRange] = useState<RangeKey>('7d');
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { from, to } = useMemo(() => rangeOf(range), [range]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setRows(null);
    activitySummary(token, from, to)
      .then(r => { if (alive) { setRows(r); setNotReady(false); } })
      .catch(e => {
        if (!alive) return;
        if (e instanceof NotInstalledError) setNotReady(true);
        else toast('Lỗi tải nhật ký nhân viên: ' + (e instanceof Error ? e.message : String(e)));
        setRows([]);
      });
    return () => { alive = false; };
  }, [token, from, to, toast]);

  const actors = useMemo(() => aggregate(rows ?? []), [rows]);
  const selected = actors.find(a => a.id === selectedId) ?? null;

  if (notReady) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-[10px] p-5 text-[12.5px] text-amber-800 space-y-2">
        <div className="flex items-center gap-2 font-semibold"><Database size={15} /> Chưa bật ghi người sửa</div>
        <p>Cần chạy migration <code className="bg-amber-100 px-1 rounded">218_role_guard_actor_history.sql</code> trên Supabase SQL Editor. Từ lúc chạy, mọi thêm / sửa / xoá sẽ được ghi kèm tên người làm.</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-blue-50 border border-blue-200 rounded-[10px] px-4 py-2.5 text-[12px] text-blue-800">
        Mỗi thay đổi dữ liệu đều được database ghi kèm <b>tên người làm</b>. Chọn 1 nhân viên để xem chi tiết họ nhập / sửa / xoá gì,
        so sánh <b>trước → sau</b>, và <b>khôi phục</b> các thay đổi chưa đúng. Thay đổi trước khi bật tính năng hiện là "Không rõ" ở tab Nhật ký Database.
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {RANGES.map(r => (
          <button key={r.key} onClick={() => setRange(r.key)}
            className={`px-3 py-1 rounded-full text-[12px] font-medium transition ${range === r.key ? 'bg-[#1D1D1F] text-white' : 'bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]'}`}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr>
                {['Nhân viên', 'Vai trò', 'Thêm', 'Sửa', 'Xoá', 'Ngày có nhập liệu', 'Làm nhiều nhất ở'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr><td colSpan={7} className="text-center py-8 text-[#aaa]">Đang tải…</td></tr>
              ) : actors.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-[#aaa]">Không có thay đổi nào có ghi tên người làm trong khoảng này</td></tr>
              ) : actors.map(a => {
                const top = [...a.byTable.entries()].sort((x, y) => sumT(y[1]) - sumT(x[1])).slice(0, 2);
                return (
                  <tr key={a.id} onClick={() => setSelectedId(a.id === selectedId ? null : a.id)}
                    className={`border-b border-[#F0EEE9] last:border-0 cursor-pointer ${a.id === selectedId ? 'bg-blue-50/60' : 'hover:bg-[#FAFAF8]'}`}>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap"><UserRound size={12} className="inline mr-1.5 text-[#999]" />{a.name}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10.5px] ${ROLE_COLORS[a.role] || 'bg-gray-100 text-gray-600'}`}>{ROLE_LABELS[a.role] || a.role || '—'}</span>
                    </td>
                    <td className="px-3 py-2 text-emerald-700 tabular-nums">{a.ins || '—'}</td>
                    <td className="px-3 py-2 text-blue-700 tabular-nums">{a.upd || '—'}</td>
                    <td className={`px-3 py-2 tabular-nums ${a.del ? 'text-red-700 font-semibold' : 'text-[#bbb]'}`}>{a.del || '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-[#555]">{a.days.size}</td>
                    <td className="px-3 py-2 text-[#666] whitespace-nowrap">{top.map(([t, v]) => `${tableLabel(t)} (${sumT(v)})`).join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <ActorDetail key={`${selected.id}-${range}`} actor={selected} from={from} to={to} range={range}
          onClose={() => setSelectedId(null)} toast={toast} onReload={onReload} />
      )}
    </>
  );
}

const PAGE = 200;

function ActorDetail({ actor, from, to, range, onClose, toast, onReload }: {
  actor: ActorAgg; from: Date; to: Date; range: RangeKey;
  onClose: () => void; toast: (m: string) => void; onReload: () => void;
}) {
  const [events, setEvents] = useState<DataHistoryEntry[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [actionFilter, setActionFilter] = useState<'all' | 'INSERT' | 'UPDATE' | 'DELETE'>('all');
  const [tableFilter, setTableFilter] = useState('all');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [revertOpen, setRevertOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await fetchActorEvents({
        actorId: actor.id, from: from.toISOString(), to: to.toISOString(), limit,
        actions: actionFilter === 'all' ? undefined : [actionFilter],
        table: tableFilter === 'all' ? undefined : tableFilter,
      });
      setEvents(rows);
    } catch (e) {
      toast('Lỗi tải chi tiết: ' + (e instanceof Error ? e.message : String(e)));
      setEvents([]);
    }
  }, [actor.id, from, to, limit, actionFilter, tableFilter, toast]);

  useEffect(() => { load(); }, [load]);

  // Biểu đồ theo ngày: mỗi ngày 1 cột chồng Thêm / Sửa / Xoá (tối đa 90 ngày)
  const days = useMemo(() => {
    const out: { key: string; label: string; t: Totals }[] = [];
    const start = new Date(from); start.setHours(0, 0, 0, 0);
    for (let d = new Date(start); d <= to && out.length < 92; d.setDate(d.getDate() + 1)) {
      const key = dayKey(d);
      out.push({ key, label: `${d.getDate()}/${d.getMonth() + 1}`, t: actor.byDay.get(key) ?? { ins: 0, upd: 0, del: 0 } });
    }
    return out;
  }, [actor, from, to]);
  const maxDay = Math.max(1, ...days.map(d => sumT(d.t)));
  const tables = [...actor.byTable.entries()].sort((x, y) => sumT(y[1]) - sumT(x[1]));

  const toggle = (id: number) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allShownPicked = !!events?.length && events.every(e => picked.has(e.id));
  const pickAllShown = () => setPicked(prev => {
    const n = new Set(prev);
    if (allShownPicked) events?.forEach(e => n.delete(e.id)); else events?.forEach(e => n.add(e.id));
    return n;
  });
  const pickedEvents = (events ?? []).filter(e => picked.has(e.id));

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="font-semibold text-[14px] text-[#111] flex-1">
          {actor.name} <span className="font-normal text-[#888] text-[12px]">· {RANGES.find(r => r.key === range)?.label} · {sumT(actor)} thay đổi</span>
        </div>
        <button onClick={onClose} className="text-[#888] hover:text-[#111]"><X size={16} /></button>
      </div>

      {days.length > 1 && (
        <div>
          <div className="flex items-center gap-3 text-[11px] text-[#666] mb-1.5">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />Thêm</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />Sửa</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" />Xoá</span>
            <span className="ml-auto text-[#999]">cao nhất {maxDay}/ngày</span>
          </div>
          <div className="flex items-end gap-[2px] h-24 border-b border-[#E8E7E2]">
            {days.map(d => {
              const total = sumT(d.t);
              const h = (n: number) => `${(n / maxDay) * 100}%`;
              return (
                <div key={d.key} className="flex-1 h-full flex flex-col justify-end gap-[2px] group relative min-w-[3px]"
                  title={`${d.label}: ${d.t.ins} thêm · ${d.t.upd} sửa · ${d.t.del} xoá`}>
                  {d.t.del > 0 && <div className="bg-red-500 rounded-t-[3px] group-hover:opacity-80" style={{ height: h(d.t.del) }} />}
                  {d.t.upd > 0 && <div className={`bg-blue-500 group-hover:opacity-80 ${d.t.del ? '' : 'rounded-t-[3px]'}`} style={{ height: h(d.t.upd) }} />}
                  {d.t.ins > 0 && <div className={`bg-emerald-500 group-hover:opacity-80 ${d.t.del || d.t.upd ? '' : 'rounded-t-[3px]'}`} style={{ height: h(d.t.ins) }} />}
                  {total === 0 && <div className="h-px" />}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10.5px] text-[#999] mt-1">
            <span>{days[0].label}</span><span>{days[days.length - 1].label}</span>
          </div>
        </div>
      )}

      <div>
        <div className="text-[11.5px] font-semibold text-[#666] mb-1.5">Theo mục dữ liệu</div>
        <div className="flex flex-wrap gap-1.5">
          {tables.map(([t, v]) => (
            <button key={t} onClick={() => setTableFilter(tableFilter === t ? 'all' : t)}
              className={`text-[11.5px] px-2.5 py-1 rounded-lg border transition ${tableFilter === t ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-[#E8E7E2] text-[#444] hover:bg-[#FAFAF8]'}`}>
              {tableLabel(t)}
              <span className="ml-1.5 text-emerald-700">{v.ins ? `+${v.ins}` : ''}</span>
              <span className="ml-1 text-blue-700">{v.upd ? `✎${v.upd}` : ''}</span>
              <span className="ml-1 text-red-700">{v.del ? `−${v.del}` : ''}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'INSERT', 'UPDATE', 'DELETE'] as const).map(a => (
          <button key={a} onClick={() => setActionFilter(a)}
            className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium ${actionFilter === a ? 'bg-[#1D1D1F] text-white' : 'bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]'}`}>
            {a === 'all' ? 'Tất cả' : ACTION_UI[a].label}
          </button>
        ))}
        <div className="flex-1" />
        {picked.size > 0 && (
          <button onClick={() => setRevertOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700">
            <RotateCcw size={12} /> Khôi phục {picked.size} thay đổi đã chọn
          </button>
        )}
      </div>

      <div className="border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-[#F9F9F7]">
                <th className="px-3 py-2 w-8"><input type="checkbox" checked={allShownPicked} onChange={pickAllShown} title="Chọn tất cả đang hiện" /></th>
                <th className="text-left px-2 py-2 text-[11.5px] text-[#888] font-medium whitespace-nowrap">Thời gian</th>
                <th className="text-left px-2 py-2 text-[11.5px] text-[#888] font-medium">Thay đổi</th>
                <th className="text-left px-2 py-2 text-[11.5px] text-[#888] font-medium">Chi tiết</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {events === null ? (
                <tr><td colSpan={5} className="text-center py-6 text-[#aaa]">Đang tải…</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-6 text-[#aaa]">Không có thay đổi phù hợp bộ lọc</td></tr>
              ) : events.map(e => {
                const open = expanded === e.id;
                return (
                  <FragmentRows key={e.id} e={e} open={open} picked={picked.has(e.id)}
                    onPick={() => toggle(e.id)} onToggle={() => setExpanded(open ? null : e.id)} />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {events && events.length >= limit && (
        <div className="text-center">
          <button onClick={() => setLimit(l => l + PAGE)} className="px-4 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50">Tải thêm</button>
        </div>
      )}

      {revertOpen && (
        <RevertDialog
          title={`Khôi phục ${pickedEvents.length} thay đổi của ${actor.name}`}
          loadEvents={async () => pickedEvents}
          onClose={() => setRevertOpen(false)}
          onDone={rows => {
            const ok = rows.filter(r => r.status === 'done').length;
            toast(`Đã khôi phục ${ok} bản ghi`);
            setPicked(new Set());
            onReload();
            load();
          }}
        />
      )}
    </div>
  );
}

function FragmentRows({ e, open, picked, onPick, onToggle }: {
  e: DataHistoryEntry; open: boolean; picked: boolean; onPick: () => void; onToggle: () => void;
}) {
  return (
    <>
      <tr className={`border-t border-[#F0EEE9] align-top cursor-pointer ${picked ? 'bg-blue-50/50' : 'hover:bg-[#FAFAF8]'}`} onClick={onToggle}>
        <td className="px-3 py-2" onClick={ev => ev.stopPropagation()}><input type="checkbox" checked={picked} onChange={onPick} /></td>
        <td className="px-2 py-2 text-[#888] whitespace-nowrap">{new Date(e.happened_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td className="px-2 py-2 max-w-[340px]"><EventLine row={e} /></td>
        <td className="px-2 py-2 text-[11.5px] text-[#666] min-w-[220px]">{changeSummary(e) || (e.action === 'DELETE' ? 'Đã xoá bản ghi' : e.action === 'INSERT' ? 'Thêm mới' : '—')}</td>
        <td className="px-2 py-2 text-[#aaa]">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
      </tr>
      {open && (
        <tr className="bg-[#FAFAF8]">
          <td colSpan={5} className="px-4 py-3"><EventDiff row={e} /></td>
        </tr>
      )}
    </>
  );
}
