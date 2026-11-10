// Popup cho TÀI KHOẢN ADMIN: có người vừa dùng CHỮ KÝ / CON DẤU để làm giấy tờ (báo giá PDF / Excel, danh sách vào cổng).
// Nguồn: stamp_alerts (migration 219) qua RPC stamp_alert_list. Báo NGAY nhờ tín hiệu Supabase Realtime (nhân viên lấy
// ảnh xong là phát "có dòng mới"), dự phòng tự hỏi lại mỗi 20 giây khi tab đang mở + khi quay lại tab.
// Tab đang ẩn và admin đã cho phép → hiện thêm thông báo hệ thống của trình duyệt.
// "Đã biết" = đánh dấu đã xem trên DB (máy khác của admin cũng tắt theo). Chưa chạy migration 219 → im lặng.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, ShieldAlert, Stamp, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { ROLE_LABELS } from '../lib/constants';
import { ACTION_LABEL, PURPOSE_LABEL, STAMP_CHANNEL, listStampAlerts, markStampAlertsSeen, partsText, type StampAlert } from '../lib/stampAlerts';
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from './workspace/wsTheme';

const POLL_MS = 20_000;

function ago(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const initials = (n: string) => n.trim().split(/\s+/).slice(-2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';
const sig = (a: StampAlert) => `${a.id}:${a.parts.join(',')}:${a.actions.join(',')}`;

function AlertRow({ a }: { a: StampAlert }) {
  const did = a.actions.filter(x => x !== 'preview');
  return (
    <div className="flex gap-3 py-2.5">
      <span className="w-8 h-8 rounded-full bg-[#FF9500]/15 text-[#B25000] text-[11.5px] font-semibold flex items-center justify-center shrink-0">{initials(a.actor_name)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-[#1D1D1F]">
          <b className="font-semibold">{a.actor_name || 'Ai đó'}</b>
          {a.actor_role && <span className="text-[#86868B]"> ({ROLE_LABELS[a.actor_role] ?? a.actor_role})</span>}
          {' '}đã lấy <b className="font-semibold text-[#D70015]">{partsText(a.parts)}</b> của <b className="font-semibold">{a.entity_label || a.company_name}</b>
        </p>
        <p className="text-[12px] text-[#6E6E73] leading-snug mt-0.5">{a.context || PURPOSE_LABEL[a.purpose] || a.purpose}</p>
        <div className="flex flex-wrap items-center gap-1 mt-1">
          <span className="text-[11px] text-[#AEAEB2] mr-1">{ago(a.last_action_at ?? a.created_at)}</span>
          {did.length
            ? did.map(x => <span key={x} className="px-1.5 h-[18px] inline-flex items-center rounded-full bg-[#FF3B30]/10 text-[#D70015] text-[10.5px] font-semibold">{ACTION_LABEL[x] ?? x}</span>)
            : <span className="px-1.5 h-[18px] inline-flex items-center rounded-full bg-black/[0.05] text-[#6E6E73] text-[10.5px] font-medium">Mới xem trước, chưa xuất file</span>}
          {a.seen_at && <span className="text-[10.5px] text-[#AEAEB2] ml-1">· đã xem</span>}
        </div>
      </div>
    </div>
  );
}

export default function StampAlertWatcher() {
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [items, setItems] = useState<StampAlert[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());    // bấm X (ẩn tạm, chưa đánh dấu đã xem)
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const dead = useRef(false);                                        // chưa chạy migration → thôi hỏi
  const notified = useRef<Set<string>>(new Set());
  const [perm, setPerm] = useState<NotificationPermission | 'none'>(() => (typeof Notification === 'undefined' ? 'none' : Notification.permission));

  const scan = useCallback(async () => {
    if (!isAdmin || !token || dead.current) return;
    try {
      const r = await listStampAlerts(token, 40);
      setItems(r.items);
      // Tab đang ẩn → thông báo hệ thống cho dòng mới (đã cho phép)
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        for (const a of r.items.filter(x => !x.seen_at && !notified.current.has(sig(x)))) {
          try { new Notification('Có người dùng chữ ký / con dấu', { body: `${a.actor_name} — ${partsText(a.parts)} của ${a.entity_label}: ${a.context}`, tag: `stamp-${a.id}` }); } catch { /* bỏ qua */ }
        }
      }
      for (const a of r.items) if (!a.seen_at) notified.current.add(sig(a));
    } catch (e) {
      if (/migration 219/.test((e as Error).message)) dead.current = true;
    }
  }, [isAdmin, token]);

  useEffect(() => {
    if (!isAdmin) return;
    void scan();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void scan(); }, POLL_MS);
    const onBack = () => { if (document.visibilityState === 'visible') void scan(); };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    // Tín hiệu tức thời từ máy nhân viên (không chứa dữ liệu — chỉ báo "có dòng mới")
    const ch = supabase.channel(STAMP_CHANNEL).on('broadcast', { event: 'new' }, () => { void scan(); }).subscribe();
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
      void supabase.removeChannel(ch);
    };
  }, [isAdmin, scan]);

  if (!isAdmin) return null;
  const unseen = items.filter(a => !a.seen_at);
  const pending = unseen.filter(a => !hidden.has(sig(a)));
  if (!pending.length) return null;

  const ack = async () => {
    if (!token) return;
    setBusy(true);
    const ids = unseen.map(a => a.id);
    setItems(xs => xs.map(a => (ids.includes(a.id) ? { ...a, seen_at: new Date().toISOString() } : a)));
    try { await markStampAlertsSeen(token, ids); } catch { /* lần quét sau sẽ hiện lại */ }
    setBusy(false);
    setShowLog(false);
  };
  const askPerm = async () => {
    try { setPerm(await Notification.requestPermission()); } catch { /* trình duyệt cũ */ }
  };
  const seenLog = items.filter(a => a.seen_at).slice(0, 15);

  return (
    <div className="fixed z-[95] inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] md:inset-x-auto md:right-5 md:bottom-5 md:w-[400px]" role="alertdialog" aria-label="Cảnh báo dùng chữ ký, con dấu">
      <div className={`${CARD} !shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_24px_60px_-12px_rgba(0,0,0,0.35)] overflow-hidden`}>
        <div className="flex items-start gap-3 px-4 pt-4 pb-2 bg-[#FFF4E5]">
          <span className="w-9 h-9 rounded-[10px] bg-[#FF9500] text-white flex items-center justify-center shrink-0"><Stamp size={18} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-[#1D1D1F] leading-tight">Có người vừa dùng chữ ký / con dấu</p>
            <p className="text-[12px] text-[#8A5A00] mt-0.5 flex items-center gap-1"><ShieldAlert size={12} />{pending.length} lượt chưa xem — kiểm tra có đúng việc không</p>
          </div>
          <button type="button" aria-label="Ẩn tạm" onClick={() => setHidden(new Set(unseen.map(sig)))} className="w-7 h-7 -mr-1 rounded-full flex items-center justify-center text-[#86868B] hover:bg-black/[0.06]"><X size={15} /></button>
        </div>
        <div className="px-4 max-h-[44vh] overflow-y-auto divide-y divide-black/[0.06]">
          {pending.slice(0, 6).map(a => <AlertRow key={a.id} a={a} />)}
          {pending.length > 6 && <p className="py-2 text-[12px] text-[#86868B]">… và {pending.length - 6} lượt nữa</p>}
          {showLog && seenLog.length > 0 && (
            <div className="pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#AEAEB2] pt-1">Đã xem trước đó</p>
              <div className="divide-y divide-black/[0.06] opacity-80">{seenLog.map(a => <AlertRow key={a.id} a={a} />)}</div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-black/[0.06]">
          <button type="button" onClick={() => void ack()} disabled={busy} className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}>Đã biết</button>
          {seenLog.length > 0 && (
            <button type="button" onClick={() => setShowLog(v => !v)} className={`${BTN_SECONDARY} h-9 px-3.5 text-[13px]`}>
              Nhật ký<ChevronDown size={14} className={showLog ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>
          )}
          {perm === 'default' && (
            <button type="button" onClick={() => void askPerm()} className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-[#0066CC] hover:opacity-70"><Bell size={13} />Báo cả khi đang ở tab khác</button>
          )}
        </div>
      </div>
    </div>
  );
}
