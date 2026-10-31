// Thông tin dự án tuyển dụng + điều khoản phí giới thiệu (cùng dạng Phương án giá → Giới thiệu LĐ).
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { listPlans } from '../../lib/costPlan/api';
import { isReferralPlan, normalizeReferral } from '../../lib/costPlan/referral';
import type { CostPlanRow } from '../../lib/costPlan/types';
import type { ReferralConfig } from '../../lib/costPlan/referral';
import { errText, saveProject } from '../../lib/recruit/api';
import type { CtvConfig, ProjectStatus, RecruitProject } from '../../lib/recruit/types';
import { compareVnName } from '../../lib/vnName';
import { useRecruit } from './context';
import { ChoiceChip, ErrorBanner, Field, MoneyInput, PILL_GRAY, PILL_PRIMARY, Switch, inputCls, sectionCls } from './ui';

const STATUS_LABEL: Record<ProjectStatus, string> = { active: 'Đang tuyển', paused: 'Tạm dừng', closed: 'Đã đóng' };

export function feeSummary(fee: Partial<ReferralConfig> | null | undefined): string {
  const f = normalizeReferral(fee ?? {});
  if (!fee || Object.keys(fee).length === 0) return 'Chưa nhập điều khoản phí';
  const g = f.guaranteeDays > 0 ? ` · bảo hành ${f.guaranteeDays} ngày` : '';
  if (f.mode === 'lump') return `${f.lumpFee.toLocaleString('vi-VN')}đ/người khi làm đủ ${f.minDays} ngày${g}`;
  return `${f.rate.toLocaleString('vi-VN')}đ/${f.rateUnit === 'hour' ? 'giờ' : 'ngày'} trong ${f.durationMonths} tháng${g}`;
}

export default function ProjectForm({ project, onDone, onCancel }: {
  project: RecruitProject | null;
  onDone: (p: RecruitProject) => void;
  onCancel?: () => void;
}) {
  const { clients, reload, toast } = useRecruit();
  const [name, setName] = useState(project?.name ?? '');
  const [clientId, setClientId] = useState(project?.client_id ?? '');
  const [contactName, setContactName] = useState(project?.contact_name ?? '');
  const [contactTitle, setContactTitle] = useState(project?.contact_title ?? '');
  const [from, setFrom] = useState(project?.period_from ?? '');
  const [to, setTo] = useState(project?.period_to ?? '');
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'active');
  const [notes, setNotes] = useState(project?.notes ?? '');
  const [noWorkerFee, setNoWorkerFee] = useState(project?.no_worker_fee ?? true);
  const [fee, setFee] = useState<ReferralConfig>(() => normalizeReferral(project?.fee && Object.keys(project.fee).length ? project.fee : { mode: 'lump', minDays: 30, guaranteeDays: 30 }));
  const [ctv, setCtv] = useState<CtvConfig>(() => ({ mode: 'per_hire', value: 0, milestone: 'fee_ok', ...(project?.ctv ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Phương án giá chế độ Giới thiệu LĐ (Workspace) → lấy điều khoản phí, khỏi gõ lại
  const { token } = useAuth();
  const [plans, setPlans] = useState<CostPlanRow[]>([]);
  useEffect(() => {
    if (!token) return;
    listPlans(token).then(rows => setPlans(rows.filter(isReferralPlan)), () => setPlans([]));
  }, [token]);
  const pickPlan = (id: string) => {
    const p = plans.find(x => x.id === id);
    if (!p) return;
    setFee(normalizeReferral(p.data.referral));
    toast(`Đã lấy điều khoản phí từ Phương án giá "${p.title}"`);
  };

  const clientOptions = useMemo(
    () => clients.filter(c => !c.archived_at).sort((a, b) => compareVnName(a.name, b.name)),
    [clients],
  );
  const setF = <K extends keyof ReferralConfig>(k: K, v: ReferralConfig[K]) => setFee(cur => ({ ...cur, [k]: v }));

  const submit = async () => {
    if (!name.trim()) { setError('Nhập tên dự án'); return; }
    if (from && to && to < from) { setError('"Đến tháng" phải sau "Từ tháng"'); return; }
    setBusy(true);
    setError('');
    try {
      // chỉ lưu điều khoản phí (bỏ chi phí nội bộ / ghi chú báo giá của Phương án giá)
      const feeTerms: Partial<ReferralConfig> = { ...fee };
      delete feeTerms.costs;
      delete feeTerms.notes;
      const saved = await saveProject({
        ...(project ? { id: project.id } : {}),
        name: name.trim(), client_id: clientId || null, contact_name: contactName.trim(), contact_title: contactTitle.trim(),
        period_from: from || null, period_to: to || null, status, notes: notes.trim(), no_worker_fee: noWorkerFee, fee: feeTerms,
        ...(ctv.value > 0 || project?.ctv ? { ctv } : {}),
      });
      await reload();
      toast(project ? 'Đã lưu dự án' : 'Đã tạo dự án — thêm nhà máy và chỉ tiêu bên dưới');
      onDone(saved);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className={sectionCls}>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Tên dự án *" className="md:col-span-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="VD: Co-Herent 11/2026 – 04/2027" className={inputCls} autoFocus={!project} />
          </Field>
          <Field label="Khách hàng" hint="Thẻ khách hàng chính. Từng nhà máy có thể gắn thẻ riêng ở phần Nhà máy.">
            <select value={clientId} onChange={e => setClientId(e.target.value)} className={inputCls}>
              <option value="">— Chưa gắn —</option>
              {clientOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Trạng thái">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map(s => (
                <ChoiceChip key={s} active={status === s} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</ChoiceChip>
              ))}
            </div>
          </Field>
          <Field label="Đầu mối bên khách">
            <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="VD: Robinson" className={inputCls} />
          </Field>
          <Field label="Chức vụ đầu mối">
            <input value={contactTitle} onChange={e => setContactTitle(e.target.value)} placeholder="VD: Senior Talent Acquisition Specialist" className={inputCls} />
          </Field>
          <Field label="Từ tháng">
            <input type="month" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Đến tháng">
            <input type="month" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Ghi chú" className="md:col-span-2" hint="VD: số liệu chưa xác nhận tính chất chỉ tiêu, nhóm C chỉ là đề xuất khảo sát…">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} />
          </Field>
        </div>
      </section>

      <section className={sectionCls}>
        <div>
          <h3 className="text-[15px] font-semibold text-[#1D1D1F]">Phí giới thiệu (với vị trí chính thức của khách)</h3>
          <p className="text-[12px] text-[#86868B] mt-0.5">Cùng cách tính với Phương án giá → Giới thiệu lao động. Dùng để tự tính mốc tính phí, bảo hành và đối soát.</p>
        </div>
        {plans.length > 0 && (
          <Field label="Lấy từ Phương án giá (Giới thiệu LĐ)" hint="Điền sẵn cách tính, mức phí, số ngày, bảo hành từ phương án đã lập — sửa tiếp được bên dưới">
            <select value="" onChange={e => pickPlan(e.target.value)} className={inputCls}>
              <option value="">— Chọn phương án giá —</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.title}{p.company_name ? ` · ${p.company_name}` : ''}{p.zone_name ? ` · ${p.zone_name}` : ''}</option>)}
            </select>
          </Field>
        )}
        <div className="flex flex-wrap gap-1.5">
          <ChoiceChip active={fee.mode === 'lump'} onClick={() => setF('mode', 'lump')}>Trọn gói / người</ChoiceChip>
          <ChoiceChip active={fee.mode === 'time'} onClick={() => setF('mode', 'time')}>Theo giờ / ngày làm</ChoiceChip>
        </div>
        {fee.mode === 'lump' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Phí / người (đ)"><MoneyInput value={fee.lumpFee} onChange={v => setF('lumpFee', v ?? 0)} /></Field>
            <Field label="Làm đủ (ngày) thì tính phí">
              <input type="number" min={0} value={fee.minDays} onChange={e => setF('minDays', Math.max(0, Number(e.target.value) || 0))} className={inputCls} />
            </Field>
            <Field label="Bảo hành (ngày)" hint="Nghỉ trong thời gian này → giới thiệu người thay miễn phí">
              <input type="number" min={0} value={fee.guaranteeDays} onChange={e => setF('guaranteeDays', Math.max(0, Number(e.target.value) || 0))} className={inputCls} />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Đơn giá (đ)"><MoneyInput value={fee.rate} onChange={v => setF('rate', v ?? 0)} /></Field>
            <Field label="Tính theo">
              <select value={fee.rateUnit} onChange={e => setF('rateUnit', e.target.value as 'hour' | 'day')} className={inputCls}>
                <option value="hour">Giờ làm</option>
                <option value="day">Ngày làm</option>
              </select>
            </Field>
            <Field label="Thu trong (tháng)">
              <input type="number" min={1} value={fee.durationMonths} onChange={e => setF('durationMonths', Math.max(1, Number(e.target.value) || 1))} className={inputCls} />
            </Field>
            <Field label="Bảo hành (ngày)">
              <input type="number" min={0} value={fee.guaranteeDays} onChange={e => setF('guaranteeDays', Math.max(0, Number(e.target.value) || 0))} className={inputCls} />
            </Field>
          </div>
        )}
        <Switch checked={noWorkerFee} onChange={setNoWorkerFee}
          label={<span>Không thu phí người lao động <span className="text-[#86868B]">(chuẩn các tập đoàn FDI, in lên tin tuyển dụng)</span></span>} />
      </section>

      <section className={sectionCls}>
        <div>
          <h3 className="text-[15px] font-semibold text-[#1D1D1F]">Hoa hồng CTV / người giới thiệu</h3>
          <p className="text-[12px] text-[#86868B] mt-0.5">Let's Go trả cho CTV (Mạng lưới Sale) hoặc người giới thiệu — không bao giờ trừ vào lương người lao động. Để 0 nếu không áp dụng.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Cách tính">
            <select value={ctv.mode} onChange={e => setCtv(c => ({ ...c, mode: e.target.value as CtvConfig['mode'] }))} className={inputCls}>
              <option value="per_hire">Cố định / người</option>
              <option value="pct_fee">% phí giới thiệu</option>
            </select>
          </Field>
          <Field label={ctv.mode === 'pct_fee' ? 'Phần trăm (%)' : 'Số tiền / người (đ)'}>
            {ctv.mode === 'pct_fee'
              ? <input type="number" min={0} max={100} value={ctv.value || ''} onChange={e => setCtv(c => ({ ...c, value: Math.max(0, Number(e.target.value) || 0) }))} className={inputCls} />
              : <MoneyInput value={ctv.value || null} onChange={v => setCtv(c => ({ ...c, value: v ?? 0 }))} />}
          </Field>
          <Field label="Tính khi người được giới thiệu" className="col-span-2 md:col-span-1">
            <select value={ctv.milestone} onChange={e => setCtv(c => ({ ...c, milestone: e.target.value as CtvConfig['milestone'] }))} className={inputCls}>
              <option value="fee_ok">Đủ ngày tính phí</option>
              <option value="started">Đi làm ngày đầu</option>
            </select>
          </Field>
        </div>
      </section>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="flex gap-2 justify-end">
        {onCancel && <button type="button" onClick={onCancel} className={PILL_GRAY}>Huỷ</button>}
        <button type="button" onClick={submit} disabled={busy} className={PILL_PRIMARY}>{busy ? 'Đang lưu…' : project ? 'Lưu dự án' : 'Tạo dự án'}</button>
      </div>
    </div>
  );
}
