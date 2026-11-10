// Lịch sử → "Cảnh báo": các đợt xoá nhiều / sửa hàng loạt bất thường của nhân viên (migration 218)
// + khôi phục cả đợt về trước + chỉnh ngưỡng cảnh báo.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, RotateCcw, Check, ChevronDown, ChevronRight, Settings2, Database, Undo2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import {
  scanAlerts, setAlertStatus, getGuardSettings, saveGuardSettings, fetchAlertEvents,
  NotInstalledError, ALERT_KIND_LABEL, type DataAlert, type GuardSettings,
} from '../../lib/dataGuard';
import { tableLabel, TABLE_LABELS } from '../../lib/historyTables';
import { ROLE_LABELS } from '../../lib/constants';
import type { DataHistoryEntry } from '../../lib/types';
import { EventLine, changeSummary } from './EventDiff';
import RevertDialog from './RevertDialog';

interface Props {
  toast: (msg: string) => void;
  onReload: () => void;
  /** Báo số cảnh báo đang mở lên tiêu đề tab. */
  onOpenCount?: (n: number) => void;
}

const STATUS_UI: Record<DataAlert['status'], { label: string; cls: string }> = {
  open: { label: 'Chưa xử lý', cls: 'bg-red-50 text-red-700 border border-red-200' },
  dismissed: { label: 'Đã xem — bỏ qua', cls: 'bg-gray-100 text-gray-600 border border-gray-200' },
  restored: { label: 'Đã khôi phục', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
};

export function alertTimeRange(a: DataAlert): string {
  const s = new Date(a.started_at), e = new Date(a.ended_at);
  const day = s.toLocaleDateString('vi-VN');
  const hm = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return s.toDateString() === e.toDateString() ? `${day} · ${hm(s)}–${hm(e)}` : `${s.toLocaleString('vi-VN')} → ${e.toLocaleString('vi-VN')}`;
}

export function alertTablesText(a: DataAlert): string {
  return Object.entries(a.tables).sort((x, y) => y[1] - x[1]).map(([t, n]) => `${tableLabel(t)} ${n}`).join(' · ');
}

export default function DataAlertsTab({ toast, onReload, onOpenCount }: Props) {
  const { token } = useAuth();
  const [alerts, setAlerts] = useState<DataAlert[] | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [events, setEvents] = useState<Record<number, DataHistoryEntry[]>>({});
  const [reverting, setReverting] = useState<DataAlert | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const list = await scanAlerts(token);
      setAlerts(list);
      setNotReady(false);
      onOpenCount?.(list.filter(a => a.status === 'open').length);
    } catch (e) {
      if (e instanceof NotInstalledError) setNotReady(true);
      else toast('Lỗi tải cảnh báo: ' + (e instanceof Error ? e.message : String(e)));
      setAlerts([]);
    }
  }, [token, toast, onOpenCount]);

  useEffect(() => { load(); }, [load]);

  const expand = async (a: DataAlert) => {
    if (expanded === a.id) { setExpanded(null); return; }
    setExpanded(a.id);
    if (!events[a.id]) {
      try {
        const ev = await fetchAlertEvents({ ...a, restored_until: null });
        setEvents(prev => ({ ...prev, [a.id]: ev }));
      } catch (e) {
        toast('Lỗi tải chi tiết: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  };

  const changeStatus = async (a: DataAlert, status: DataAlert['status']) => {
    if (!token) return;
    try {
      await setAlertStatus(token, a.id, status);
      toast(status === 'dismissed' ? 'Đã đánh dấu đã xem' : status === 'open' ? 'Đã mở lại cảnh báo' : 'Đã cập nhật');
      load();
    } catch (e) {
      toast('Lỗi: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  if (notReady) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-[10px] p-5 text-[12.5px] text-amber-800 space-y-2">
        <div className="flex items-center gap-2 font-semibold"><Database size={15} /> Chưa bật cảnh báo dữ liệu</div>
        <p>Cần chạy migration <code className="bg-amber-100 px-1 rounded">218_role_guard_actor_history.sql</code> trên Supabase SQL Editor.</p>
      </div>
    );
  }

  const shown = (alerts ?? []).filter(a => filter === 'all' || a.status === 'open');
  const openCount = (alerts ?? []).filter(a => a.status === 'open').length;

  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-[10px] px-4 py-2.5 text-[12px] text-amber-900 flex items-start gap-2">
        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
        <span>
          Hệ thống tự phát hiện khi nhân viên (không phải admin) <b>xoá nhiều dữ liệu</b> trong một đợt, xoá dữ liệu <b>quan trọng</b>
          (khách hàng, hợp đồng, P&amp;L, tài chính, lao động), hoặc <b>sửa hàng loạt</b> trong 1 lần lưu. Khi admin đăng nhập sẽ có thông báo.
          Bấm <b>Khôi phục</b> để đưa đúng các bản ghi đó về trạng thái trước đợt thay đổi.
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {(['open', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-[12px] font-medium ${filter === f ? 'bg-[#1D1D1F] text-white' : 'bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]'}`}>
            {f === 'open' ? `Chưa xử lý (${openCount})` : `Tất cả (${alerts?.length ?? 0})`}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setShowSettings(s => !s)} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium bg-black/[0.05] hover:bg-black/[0.08]">
          <Settings2 size={12} /> Ngưỡng cảnh báo
        </button>
      </div>

      {showSettings && token && <GuardSettingsPanel token={token} toast={toast} onSaved={load} />}

      {alerts === null ? (
        <div className="text-center py-8 text-[#aaa] text-[12.5px]">Đang quét…</div>
      ) : shown.length === 0 ? (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] py-10 text-center text-[12.5px] text-[#888]">
          <Check size={18} className="mx-auto mb-1.5 text-emerald-600" />
          {filter === 'open' ? 'Không có thao tác bất thường nào cần xử lý.' : 'Chưa có cảnh báo nào trong 60 ngày qua.'}
        </div>
      ) : (
        <div className="space-y-2.5">
          {shown.map(a => {
            const st = STATUS_UI[a.status];
            const open = expanded === a.id;
            const ev = events[a.id];
            return (
              <div key={a.id} className={`bg-white border rounded-[10px] overflow-hidden ${a.status === 'open' && a.severity === 'high' ? 'border-red-300' : 'border-[#E8E7E2]'}`}>
                <div className="p-3.5 flex gap-3 items-start">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${a.severity === 'high' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                    <AlertTriangle size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[13px] text-[#111]">{ALERT_KIND_LABEL[a.kind]}: {a.total} dòng</span>
                      {a.severity === 'high' && <span className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-red-600 text-white font-medium">Nghiêm trọng</span>}
                      <span className={`text-[10.5px] px-1.5 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="text-[12px] text-[#444] mt-0.5">
                      <b>{a.actor_name || 'Không rõ'}</b> <span className="text-[#888]">({ROLE_LABELS[a.actor_role ?? ''] || a.actor_role || '—'})</span> · {alertTimeRange(a)}
                    </div>
                    <div className="text-[11.5px] text-[#777] mt-0.5">{alertTablesText(a)}</div>
                    {a.status !== 'open' && a.resolved_by && (
                      <div className="text-[11px] text-[#999] mt-0.5">{a.resolved_by} xử lý lúc {a.resolved_at ? new Date(a.resolved_at).toLocaleString('vi-VN') : ''}</div>
                    )}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <button onClick={() => expand(a)} className="inline-flex items-center gap-1 text-[12px] text-[#555] hover:text-[#111]">
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Xem các dòng bị ảnh hưởng
                      </button>
                      <button onClick={() => setReverting(a)} className="inline-flex items-center gap-1 text-[12px] font-medium text-blue-600 hover:underline">
                        <RotateCcw size={12} /> Khôi phục về trước đợt này
                      </button>
                      {a.status === 'open' ? (
                        <button onClick={() => changeStatus(a, 'dismissed')} className="inline-flex items-center gap-1 text-[12px] text-[#666] hover:underline">
                          <Check size={12} /> Đã xem, không sao
                        </button>
                      ) : (
                        <button onClick={() => changeStatus(a, 'open')} className="inline-flex items-center gap-1 text-[12px] text-[#666] hover:underline">
                          <Undo2 size={12} /> Mở lại
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {open && (
                  <div className="border-t border-[#F0EEE9] bg-[#FAFAF8] px-3.5 py-2.5 max-h-72 overflow-y-auto">
                    {!ev ? <div className="text-[12px] text-[#aaa] py-2">Đang tải…</div> : ev.length === 0 ? (
                      <div className="text-[12px] text-[#aaa] py-2">Không tìm thấy dòng nào.</div>
                    ) : (
                      <div className="space-y-1">
                        {ev.slice(0, 150).map(e => (
                          <div key={e.id} className="text-[12px] flex gap-2 items-baseline">
                            <span className="text-[#999] shrink-0 tabular-nums">{new Date(e.happened_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            <span className="min-w-0"><EventLine row={e} /> <span className="text-[11px] text-[#888]">{changeSummary(e, 2)}</span></span>
                          </div>
                        ))}
                        {ev.length > 150 && <div className="text-[11px] text-[#999]">… và {ev.length - 150} dòng khác</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {reverting && (
        <RevertDialog
          title={`Khôi phục đợt "${ALERT_KIND_LABEL[reverting.kind].toLowerCase()}" của ${reverting.actor_name || 'không rõ'}`}
          loadEvents={() => fetchAlertEvents(reverting)}
          onClose={() => { setReverting(null); load(); }}
          onDone={async rows => {
            const ok = rows.filter(r => r.status === 'done').length;
            toast(`Đã khôi phục ${ok} bản ghi`);
            if (token && ok > 0) await setAlertStatus(token, reverting.id, 'restored').catch(() => {});
            onReload();
          }}
        />
      )}
    </>
  );
}

function GuardSettingsPanel({ token, toast, onSaved }: { token: string; toast: (m: string) => void; onSaved: () => void }) {
  const [s, setS] = useState<GuardSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getGuardSettings(token).then(setS).catch(e => toast('Lỗi tải cài đặt: ' + (e instanceof Error ? e.message : String(e))));
  }, [token, toast]);

  if (!s) return <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4 text-[12px] text-[#aaa]">Đang tải…</div>;

  const num = (k: 'delete_threshold' | 'update_threshold' | 'window_minutes', label: string, hint: string) => (
    <label className="block">
      <span className="text-[11.5px] font-medium text-[#555]">{label}</span>
      <input type="number" min={1} value={s[k]} onChange={e => setS({ ...s, [k]: Math.max(1, Number(e.target.value) || 1) })}
        className="mt-1 w-full text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
      <span className="text-[10.5px] text-[#999]">{hint}</span>
    </label>
  );

  const toggleCore = (t: string) => setS({ ...s, core_tables: s.core_tables.includes(t) ? s.core_tables.filter(x => x !== t) : [...s.core_tables, t] });

  const save = async () => {
    setSaving(true);
    try {
      await saveGuardSettings(token, s);
      toast('Đã lưu ngưỡng cảnh báo');
      onSaved();
    } catch (e) {
      toast('Lỗi lưu: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {num('delete_threshold', 'Cảnh báo khi xoá từ (dòng)', 'trong 1 đợt của 1 người')}
        {num('window_minutes', 'Các lần xoá cách nhau ≤ (phút)', 'thì tính là cùng 1 đợt')}
        {num('update_threshold', 'Sửa hàng loạt từ (dòng)', 'trong 1 lần bấm Lưu')}
      </div>
      <div>
        <div className="text-[11.5px] font-medium text-[#555] mb-1">Dữ liệu quan trọng — xoá dù chỉ 1 dòng cũng cảnh báo</div>
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
          {Object.entries(TABLE_LABELS).filter(([k]) => k !== 'app_users').map(([k, v]) => {
            const on = s.core_tables.includes(k);
            return (
              <button key={k} onClick={() => toggleCore(k)}
                className={`text-[11.5px] px-2 py-0.5 rounded-full border ${on ? 'border-red-300 bg-red-50 text-red-700' : 'border-[#E8E7E2] text-[#666] hover:bg-[#FAFAF8]'}`}>
                {on ? '● ' : ''}{v}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg text-[12.5px] bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
          {saving ? 'Đang lưu…' : 'Lưu ngưỡng'}
        </button>
      </div>
    </div>
  );
}
