// Popup cảnh báo cho tài khoản admin: khi mở app (đăng nhập) — và mỗi 10 phút sau đó — quét các đợt xoá nhiều /
// sửa hàng loạt bất thường của nhân viên (RPC dh_scan_alerts, migration 218). Có cảnh báo chưa xử lý mà phiên này
// chưa báo → hiện popup; "Để sau" thì lần đăng nhập / mở tab mới sẽ nhắc lại cho tới khi xử lý.
import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { scanAlerts, ALERT_KIND_LABEL, type DataAlert } from '../lib/dataGuard';
import { alertTablesText, alertTimeRange } from './history/DataAlertsTab';
import { CARD, BTN_PRIMARY, BTN_SECONDARY } from './workspace/wsTheme';

const SEEN_KEY = 'lgvn_data_alerts_seen';
const RESCAN_MS = 10 * 60_000;

/** Khoá nhận diện 1 cảnh báo ở thời điểm hiện tại (đợt dài thêm → coi là mới, báo lại). */
const sig = (a: DataAlert) => `${a.id}:${a.total}`;

function readSeen(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]') as string[]); } catch { return new Set(); }
}
function writeSeen(s: Set<string>) {
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...s])); } catch { /* chặn lưu trữ → chỉ nhắc lại thôi */ }
}

export default function DataGuardLoginAlert({ onOpenAlerts }: { onOpenAlerts: () => void }) {
  const { user, token } = useAuth();
  const [pending, setPending] = useState<DataAlert[]>([]);

  const scan = useCallback(async () => {
    if (!token || user?.role !== 'admin') return;
    try {
      const open = (await scanAlerts(token)).filter(a => a.status === 'open');
      const seen = readSeen();
      setPending(open.some(a => !seen.has(sig(a))) ? open : []);
    } catch { /* chưa chạy migration 218 / mất mạng → im lặng, tab Cảnh báo sẽ hướng dẫn */ }
  }, [token, user?.role]);

  useEffect(() => {
    scan();
    const t = setInterval(scan, RESCAN_MS);
    return () => clearInterval(t);
  }, [scan]);

  if (!pending.length) return null;

  const close = () => {
    const seen = readSeen();
    pending.forEach(a => seen.add(sig(a)));
    writeSeen(seen);
    setPending([]);
  };
  const high = pending.some(a => a.severity === 'high');

  return (
    <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={close}>
      <div className={`${CARD} w-full max-w-[480px] max-h-[85vh] flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 flex items-start gap-3">
          <div className={`w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0 text-white ${high ? 'bg-gradient-to-b from-[#FF6961] to-[#FF3B30]' : 'bg-gradient-to-b from-[#FFB340] to-[#FF9500]'}`}>
            <ShieldAlert size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-[#1D1D1F]">Phát hiện thao tác dữ liệu bất thường</div>
            <div className="text-[12.5px] text-[#6E6E73] mt-0.5">{pending.length} đợt chưa xử lý — kiểm tra và khôi phục nếu cần.</div>
          </div>
          <button onClick={close} className="text-[#86868B] hover:text-[#1D1D1F]"><X size={18} /></button>
        </div>
        <div className="px-5 pb-2 overflow-y-auto space-y-2">
          {pending.slice(0, 5).map(a => (
            <div key={a.id} className={`rounded-[12px] px-3.5 py-2.5 ${a.severity === 'high' ? 'bg-[#FF3B30]/[0.07]' : 'bg-[#FF9500]/[0.09]'}`}>
              <div className="text-[13px] text-[#1D1D1F]">
                <b>{a.actor_name || 'Không rõ'}</b> — {ALERT_KIND_LABEL[a.kind].toLowerCase()} <b>{a.total}</b> dòng
              </div>
              <div className="text-[11.5px] text-[#6E6E73] mt-0.5">{alertTimeRange(a)}</div>
              <div className="text-[11.5px] text-[#6E6E73]">{alertTablesText(a)}</div>
            </div>
          ))}
          {pending.length > 5 && <div className="text-[11.5px] text-[#86868B] px-1">… và {pending.length - 5} đợt khác</div>}
        </div>
        <div className="px-5 py-4 flex gap-2 justify-end">
          <button onClick={close} className={`${BTN_SECONDARY} px-4 py-2 text-[13px]`}>Để sau</button>
          <button onClick={() => { close(); onOpenAlerts(); }} className={`${BTN_PRIMARY} px-4 py-2 text-[13px]`}>Xem & khôi phục</button>
        </div>
      </div>
    </div>
  );
}
