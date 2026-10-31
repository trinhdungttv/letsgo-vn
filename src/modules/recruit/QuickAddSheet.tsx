// Thêm nhanh 1 ứng viên + ứng tuyển vào dự án đang chọn (gặp tại chỗ, gọi điện, CTV gửi).
// SĐT/CCCD đã có → không tạo hồ sơ mới, gắn luôn hồ sơ cũ vào dự án.
import { useState } from 'react';
import { createApplication, errText, saveCandidate } from '../../lib/recruit/api';
import type { RecruitStage } from '../../lib/recruit/types';
import { useRecruit } from './context';
import CandidateForm, { blankCandidate, cleanCandidate, validateCandidate } from './CandidateForm';
import type { CandidateDraft } from './CandidateForm';
import { ChoiceChip, ErrorBanner, Field, PILL_GRAY, PILL_PRIMARY, SHEET_FOOTER, Sheet, inputCls, sectionCls } from './ui';

const START_STAGES: { key: RecruitStage; label: string }[] = [
  { key: 'new', label: 'Mới nộp' },
  { key: 'contacted', label: 'Đã liên hệ' },
  { key: 'passed', label: 'Đạt PV' },
];

export default function QuickAddSheet({ onClose, onDone, defaultSiteId, defaultPositionId, poolOnly = false, replaces }: {
  onClose: () => void;
  onDone: () => void;
  defaultSiteId?: string;
  defaultPositionId?: string;
  /** Người được tìm để thay cho 1 người nghỉ trong thời gian bảo hành (phí giới thiệu = 0đ) */
  replaces?: { id: string; name: string };
  /** true = chỉ đưa vào kho ứng viên, không gắn dự án */
  poolOnly?: boolean;
}) {
  const ctx = useRecruit();
  const { sites, positions, toast } = ctx;
  const project = poolOnly ? null : ctx.project;
  const [draft, setDraft] = useState<CandidateDraft>(() => ({ ...blankCandidate(), consent_at: new Date().toISOString(), consent_source: 'verbal' }));
  const [siteId, setSiteId] = useState(defaultSiteId ?? (sites.length === 1 ? sites[0].id : ''));
  const [positionId, setPositionId] = useState(defaultPositionId ?? '');
  const [stage, setStage] = useState<RecruitStage>('new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [another, setAnother] = useState(!replaces);

  const submit = async () => {
    const msg = validateCandidate(draft);
    if (msg) { setError(msg); return; }
    setBusy(true);
    setError('');
    try {
      const clean = cleanCandidate(draft);
      const r = await saveCandidate(clean);
      const candidateId = r.candidate?.id ?? r.duplicate?.id;
      if (!candidateId) throw new Error('Không lưu được hồ sơ');
      if (r.duplicate?.blacklisted) throw new Error(`${r.duplicate.full_name} nằm trong danh sách đen — không thêm vào dự án`);
      if (project) {
        await createApplication({ candidate_id: candidateId, project_id: project.id, site_id: siteId || null, position_id: positionId || null, stage, replaces_id: replaces?.id ?? null });
      }
      toast(r.duplicate ? `Đã có hồ sơ ${r.duplicate.full_name} — gắn vào dự án` : `Đã thêm ${clean.full_name}`);
      onDone();
      if (another) {
        setDraft(d => ({ ...blankCandidate(), consent_at: new Date().toISOString(), consent_source: 'verbal', source_channel: d.source_channel,
          referrer_contact_id: d.referrer_contact_id, referrer_name: d.referrer_name, referrer_phone: d.referrer_phone }));
        setBusy(false);
      } else {
        onClose();
      }
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <Sheet label="Thêm ứng viên" onClose={onClose} wide="xl">
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Thêm ứng viên</h2>
      <p className="text-[12.5px] text-[#86868B] mt-0.5">{project ? `Vào dự án ${project.name}` : 'Vào kho ứng viên'} — SĐT đã có thì dùng lại hồ sơ cũ.</p>
      {replaces && <p className="mt-2 text-[13px] rounded-[10px] bg-[#30B0C7]/[0.14] text-[#00708F] px-3 py-2">Người thay cho <b>{replaces.name}</b> (nghỉ trong thời gian bảo hành) — không tính phí giới thiệu.</p>}
      {project && (
        <section className={`${sectionCls} mt-4`}>
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Nhà máy">
              <select value={siteId} onChange={e => setSiteId(e.target.value)} className={inputCls}>
                <option value="">— Chưa chọn —</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Vị trí">
              <select value={positionId} onChange={e => setPositionId(e.target.value)} className={inputCls}>
                <option value="">— Chưa chọn —</option>
                {positions.filter(p => p.is_open && (!siteId || !p.site_ids.length || p.site_ids.includes(siteId))).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </Field>
            <div>
              <span className="block text-[12px] font-medium text-[#6E6E73] mb-1">Bắt đầu ở bước</span>
              <div className="flex flex-wrap gap-1.5">
                {START_STAGES.map(s => <ChoiceChip key={s.key} active={stage === s.key} onClick={() => setStage(s.key)}>{s.label}</ChoiceChip>)}
              </div>
            </div>
          </div>
        </section>
      )}
      <div className="mt-3">
        <CandidateForm value={draft} onChange={setDraft} />
      </div>
      {error && <div className="mt-3"><ErrorBanner>{error}</ErrorBanner></div>}
      <div className={`${SHEET_FOOTER} mt-4 flex flex-wrap items-center gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <label className="inline-flex items-center gap-2 text-[13px] text-[#1D1D1F] mr-auto cursor-pointer">
          <input type="checkbox" checked={another} onChange={e => setAnother(e.target.checked)} className="w-4 h-4 accent-[#0071E3]" />
          Lưu xong nhập tiếp người khác
        </label>
        <button type="button" onClick={onClose} className={PILL_GRAY}>Đóng</button>
        <button type="button" onClick={submit} disabled={busy} className={PILL_PRIMARY}>{busy ? 'Đang lưu…' : 'Lưu ứng viên'}</button>
      </div>
    </Sheet>
  );
}
