import { useEffect, useState } from 'react';
import { Link2, X } from 'lucide-react';
import { planHistory } from '../../../lib/costPlan/api';
import type { PlanRevision } from '../../../lib/costPlan/types';
import { fmtD } from './fields';
import { FONT, btnGhost } from './ui';

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
};

/** Các bản đã lưu của phương án: ai sửa, sửa qua đâu, giá lúc đó — và khôi phục về bản cũ. */
export default function HistoryPanel({ planId, token, currentVersion, onRestore, onClose }: {
  planId: string;
  token: string;
  currentVersion: number;
  onRestore: (rev: PlanRevision) => void;
  onClose: () => void;
}) {
  const [revs, setRevs] = useState<PlanRevision[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    planHistory(token, planId).then(r => { if (alive) setRevs(r); }).catch(e => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [planId, token]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4" style={{ fontFamily: FONT }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-lg max-h-[85vh] flex flex-col text-[#1d1d1f]">
        <div className="flex items-start justify-between px-6 pt-5 pb-3 shrink-0">
          <div>
            <div className="text-[19px] font-semibold tracking-tight">Lịch sử chỉnh sửa</div>
            <div className="text-[12.5px] text-[#86868b] mt-0.5">Ai sửa, sửa qua đâu, và khôi phục bản cũ</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 -mr-2 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7]"><X size={17} /></button>
        </div>
        <div className="overflow-y-auto px-6 pb-5 divide-y divide-[#f2f2f4]">
          {err && <div className="text-[13px] text-[#b3140a] bg-[#fff1f0] rounded-lg p-3 my-2">{err}</div>}
          {!revs && !err && <div className="text-[13px] text-[#86868b] text-center py-8">Đang tải…</div>}
          {revs && revs.length === 0 && <div className="text-[13px] text-[#86868b] text-center py-8">Chưa có bản lưu nào.</div>}
          {revs?.map(r => (
            <div key={r.id} className="py-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">v{r.version}</span>
                {r.version === currentVersion && <span className="text-[10px] font-semibold px-1.5 py-px rounded bg-[#eef5ff] text-[#0071e3]">Hiện tại</span>}
                <span className="text-[13px] text-[#1d1d1f] truncate">{r.editor ?? '—'}</span>
                {r.via === 'link' && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-px rounded bg-[#f1edff] text-[#5e5ce6]"><Link2 size={9} />Qua link</span>}
                <span className="ml-auto text-[11.5px] text-[#86868b] whitespace-nowrap">{when(r.created_at)}</span>
              </div>
              {r.note && <div className="text-[13px] text-[#1d1d1f] mt-1">“{r.note}”</div>}
              {r.summary && <div className="text-[12px] text-[#86868b] mt-0.5 tabular-nums">Giá {fmtD(r.summary.quoteDaily)}/công · phí DV {fmtD(r.summary.serviceFeeDaily)} · công ty {r.summary.companyPct}% · {r.summary.workers} LĐ</div>}
              {r.version !== currentVersion && <button onClick={() => onRestore(r)} className={`${btnGhost} mt-2 !h-7 !text-[12px]`}>Khôi phục bản này</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
