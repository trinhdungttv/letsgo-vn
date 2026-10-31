// Chuyển bước cho 1 hoặc nhiều hồ sơ — hỏi thêm đúng thông tin bước đó cần (giờ PV, ngày nhận việc, lý do…).
import { useState } from 'react';
import { errText, moveApplications } from '../../lib/recruit/api';
import { CLOSE_REASONS, STAGE_META, stageNeeds } from '../../lib/recruit/stages';
import type { RecruitApplication, RecruitStage } from '../../lib/recruit/types';
import { ChoiceChip, ErrorBanner, Field, PILL_GRAY, PILL_PRIMARY, SHEET_FOOTER, Sheet, fromLocalInput, inputCls, sectionCls, toLocalInput, todayIso } from './ui';

/** Bước không cần hỏi gì thêm → chuyển luôn, không mở hộp. */
export const needsSheet = (stage: RecruitStage): boolean => stageNeeds(stage) !== null;

export default function MoveStageSheet({ apps, stage, onClose, onDone }: {
  apps: RecruitApplication[];
  stage: RecruitStage;
  onClose: () => void;
  onDone: (moved: number) => void;
}) {
  const need = stageNeeds(stage);
  const first = apps[0];
  const tomorrow9 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); };
  const [interviewAt, setInterviewAt] = useState(toLocalInput(first?.interview_at ?? tomorrow9()));
  const [date, setDate] = useState(() => {
    if (need === 'planned_start') return first?.planned_start ?? '';
    if (need === 'start_date') return first?.planned_start ?? todayIso();
    return todayIso();
  });
  const reasons = CLOSE_REASONS[stage] ?? [];
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [employeeCode, setEmployeeCode] = useState(apps.length === 1 ? first?.employee_code ?? '' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (need === 'interview_at' && !interviewAt) { setError('Chọn ngày giờ phỏng vấn'); return; }
    if ((need === 'start_date' || need === 'fee_date' || need === 'left') && !date) { setError('Chọn ngày'); return; }
    setBusy(true);
    setError('');
    try {
      const r = await moveApplications(apps.map(a => a.id), stage, {
        interview_at: need === 'interview_at' ? fromLocalInput(interviewAt) : undefined,
        planned_start: need === 'planned_start' ? date || null : undefined,
        start_date: need === 'start_date' ? date : undefined,
        fee_date: need === 'fee_date' ? date : undefined,
        left_date: need === 'left' ? date : undefined,
        reason: reason || undefined,
        note: note.trim() || undefined,
        employee_code: employeeCode.trim() || undefined,
      });
      onDone(r.moved);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const who = apps.length === 1 ? first?.candidate?.full_name ?? '1 hồ sơ' : `${apps.length} hồ sơ`;
  return (
    <Sheet label={`Chuyển sang ${STAGE_META[stage].label}`} onClose={onClose}>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">{STAGE_META[stage].label}</h2>
      <p className="text-[12.5px] text-[#86868B] mt-0.5">{who}</p>
      <section className={`${sectionCls} mt-4`}>
        {need === 'interview_at' && (
          <Field label="Ngày giờ phỏng vấn">
            <input type="datetime-local" value={interviewAt} onChange={e => setInterviewAt(e.target.value)} className={inputCls} />
          </Field>
        )}
        {need === 'planned_start' && (
          <Field label="Ngày nhận việc dự kiến" hint="Để trống nếu chưa có lịch — hồ sơ vẫn nằm ở Chờ nhận việc">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
          </Field>
        )}
        {need === 'start_date' && (
          <>
            <Field label="Ngày đi làm">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </Field>
            {apps.length === 1 && (
              <Field label="Mã nhân viên bên khách (nếu có)">
                <input value={employeeCode} onChange={e => setEmployeeCode(e.target.value)} className={inputCls} />
              </Field>
            )}
          </>
        )}
        {need === 'fee_date' && (
          <Field label="Ngày đủ điều kiện tính phí" hint="Đã xác nhận với khách người này còn đi làm đủ số ngày">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
          </Field>
        )}
        {need === 'left' && (
          <Field label="Ngày nghỉ việc">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
          </Field>
        )}
        {reasons.length > 0 && (
          <div>
            <span className="block text-[12px] font-medium text-[#6E6E73] mb-1">Lý do</span>
            <div className="flex flex-wrap gap-1.5">
              {reasons.map(r => <ChoiceChip key={r} active={reason === r} onClick={() => setReason(reason === r ? '' : r)}>{r}</ChoiceChip>)}
            </div>
          </div>
        )}
        <Field label="Ghi chú">
          <input value={note} onChange={e => setNote(e.target.value)} className={inputCls} />
        </Field>
      </section>
      {error && <div className="mt-3"><ErrorBanner>{error}</ErrorBanner></div>}
      <div className={`${SHEET_FOOTER} mt-4 flex justify-end gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <button type="button" onClick={onClose} className={PILL_GRAY}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy} className={PILL_PRIMARY}>{busy ? 'Đang lưu…' : 'Xác nhận'}</button>
      </div>
    </Sheet>
  );
}
