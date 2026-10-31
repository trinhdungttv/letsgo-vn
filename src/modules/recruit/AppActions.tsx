// Nút chuyển bước trên 1 hồ sơ ứng tuyển: nút bước kế tiếp + ô chọn "Đổi bước…" (mọi bước, kể cả đóng hồ sơ).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { errText, moveApplications } from '../../lib/recruit/api';
import { ACTION_LABEL, CLOSED_STAGES, STAGE_CHAIN, STAGE_META, closeOptions, nextStage } from '../../lib/recruit/stages';
import type { RecruitApplication, RecruitStage } from '../../lib/recruit/types';
import { useRecruit } from './context';
import MoveStageSheet, { needsSheet } from './MoveStageSheet';

export default function AppActions({ app, onChanged, compact = false }: {
  app: RecruitApplication;
  onChanged: () => void;
  compact?: boolean;
}) {
  const { toast, canEdit } = useRecruit();
  const [pending, setPending] = useState<RecruitStage | null>(null);
  const [busy, setBusy] = useState(false);
  if (!canEdit) return null;
  const next = nextStage(app.stage, app.employment_type);
  const quickClose = closeOptions(app.stage);

  const go = async (stage: RecruitStage) => {
    if (needsSheet(stage)) { setPending(stage); return; }
    setBusy(true);
    try {
      await moveApplications([app.id], stage);
      toast(`${app.candidate?.full_name ?? 'Hồ sơ'} → ${STAGE_META[stage].label}`);
      onChanged();
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
      {next && (
        <button type="button" disabled={busy} onClick={() => go(next)}
          className="inline-flex items-center gap-0.5 h-8 md:h-7 pl-3 pr-2 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[12.5px] font-semibold hover:bg-[#0071E3]/[0.16] active:scale-[0.97] transition disabled:opacity-40 whitespace-nowrap">
          {ACTION_LABEL[next]} <ChevronRight size={13} strokeWidth={2.6} />
        </button>
      )}
      <select aria-label="Đổi bước" value="" disabled={busy}
        onChange={e => { const v = e.target.value as RecruitStage; if (v) go(v); }}
        className={`h-8 md:h-7 rounded-full bg-black/[0.05] text-[12.5px] text-[#1D1D1F] font-medium outline-none cursor-pointer hover:bg-black/[0.08] ${compact ? 'w-9 px-0 text-center' : 'pl-3 pr-2'}`}>
        <option value="">{compact ? '…' : 'Đổi bước…'}</option>
        {quickClose.length > 0 && (
          <optgroup label="Đóng hồ sơ">
            {quickClose.map(s => <option key={s} value={s}>{ACTION_LABEL[s]}</option>)}
          </optgroup>
        )}
        <optgroup label="Chuyển tới bước">
          {STAGE_CHAIN.filter(s => s !== app.stage && !(app.employment_type === 'leasing' && (s === 'fee_ok' || s === 'done')))
            .map(s => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
        </optgroup>
        {STAGE_META[app.stage].phase !== 'closed' && quickClose.length === 0 && (
          <optgroup label="Khác">
            {CLOSED_STAGES.filter(s => s !== 'converted').map(s => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
          </optgroup>
        )}
      </select>
      {/* portal: hộp nằm ngoài dòng danh sách (dòng có thể là nút bấm) */}
      {pending && createPortal(
        <MoveStageSheet apps={[app]} stage={pending} onClose={() => setPending(null)}
          onDone={() => { setPending(null); toast(`${app.candidate?.full_name ?? 'Hồ sơ'} → ${STAGE_META[pending].label}`); onChanged(); }} />,
        document.body,
      )}
    </div>
  );
}
