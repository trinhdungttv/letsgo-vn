// Vị trí tuyển (JD) — nhập theo đúng khung tin tuyển dụng của khách (VD Trưởng ca sản xuất Co-Herent):
// lương, địa điểm, giờ làm/ca, mô tả, yêu cầu, phúc lợi → sinh tin đăng Facebook/Zalo.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { foldVn } from '../../lib/recruit/normalize';
import type { MarketSurvey } from '../../lib/types';
import { Copy, Trash2 } from 'lucide-react';
import { copyText } from '../../lib/clipboard';
import { deletePosition, errText, savePosition } from '../../lib/recruit/api';
import { jobPostText } from '../../lib/recruit/jobPost';
import { applyUrl } from '../../lib/recruit/publicLink';
import { EDUCATION_LABEL, EDUCATION_ORDER, GROUP_LABEL } from '../../lib/recruit/types';
import type { EmploymentType, PositionGroup, RecruitPosition } from '../../lib/recruit/types';
import { useRecruit } from './context';
import { ChoiceChip, ErrorBanner, Field, MoneyInput, PILL_GRAY, PILL_PRIMARY, PILL_TINTED, SHEET_FOOTER, Sheet, Switch, inputCls, sectionCls } from './ui';

type Draft = Omit<RecruitPosition, 'id' | 'project_id' | 'sort_order' | 'fee_override'>;

const blank = (): Draft => ({
  title: '', group_code: 'B', employment_type: 'direct', confirmed: true, is_open: true, site_ids: [],
  salary_min: null, salary_max: null, salary_note: '', hours_per_week: 48, shift_note: '', description: '', requirements: '',
  benefits: '', education_min: '', age_min: null, age_max: null, gender_pref: 'any', cleanroom: false,
});

export default function PositionSheet({ position, onClose }: { position: RecruitPosition | null; onClose: () => void }) {
  const { project, sites, reload, toast, canEdit } = useRecruit();
  const [d, setD] = useState<Draft>(() => (position ? { ...position } : blank()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(cur => ({ ...cur, [k]: v }));

  // Gợi ý lương từ Thị trường → Lương TT: khảo sát mới nhất ở KCN của các nhà máy vị trí này
  const [surveys, setSurveys] = useState<MarketSurvey[]>([]);
  useEffect(() => {
    supabase.from('market_surveys').select('*').order('survey_date', { ascending: false }).limit(300)
      .then(({ data }) => setSurveys((data ?? []) as MarketSurvey[]), () => {});
  }, []);
  const wageHints = useMemo(() => {
    const chosen = d.site_ids.length ? sites.filter(x => d.site_ids.includes(x.id)) : sites;
    const keys = chosen.map(x => foldVn(x.zone_name || x.name).replace(/^kcn\s+/, '').trim()).filter(Boolean);
    const out: MarketSurvey[] = [];
    for (const k of keys) {
      const hit = surveys.find(sv => { const z = foldVn(sv.zone_name).replace(/^kcn\s+/, '').trim(); return z === k || z.includes(k) || k.includes(z); });
      if (hit && !out.includes(hit)) out.push(hit);
    }
    return out;
  }, [surveys, sites, d.site_ids]);
  const applyWage = (lo: number | null, hi: number | null) => setD(cur => ({ ...cur, salary_min: lo ?? cur.salary_min, salary_max: hi ?? lo ?? cur.salary_max }));
  const tr = (v: number | null | undefined) => (v ? (v / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : '?');

  const preview = useMemo(() => project ? jobPostText({
    project, position: { ...d, id: position?.id ?? 'new', project_id: project.id, sort_order: 0, fee_override: null }, sites,
    applyUrl: project.public_open && project.public_code ? applyUrl(project.public_code) : undefined,
  }) : '', [d, project, sites, position]);

  if (!project) return null;

  const toggleSite = (id: string) => set('site_ids', d.site_ids.includes(id) ? d.site_ids.filter(x => x !== id) : [...d.site_ids, id]);

  const submit = async () => {
    if (!d.title.trim()) { setError('Nhập tên vị trí'); return; }
    if (d.salary_min && d.salary_max && d.salary_max < d.salary_min) { setError('Lương tối đa nhỏ hơn lương tối thiểu'); return; }
    setBusy(true);
    setError('');
    try {
      await savePosition({ ...d, title: d.title.trim(), ...(position ? { id: position.id } : { project_id: project.id }) });
      await reload();
      toast(position ? 'Đã lưu vị trí' : 'Đã thêm vị trí');
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!position || !confirm(`Xoá vị trí “${position.title}”? Hồ sơ ứng tuyển đã gắn vị trí này vẫn giữ nguyên.`)) return;
    setBusy(true);
    try {
      await deletePosition(position.id);
      await reload();
      toast('Đã xoá vị trí');
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const copy = async () => toast((await copyText(preview)) ? 'Đã chép tin tuyển dụng' : 'Không chép được — bôi đen để chép tay');

  return (
    <Sheet label={position ? 'Sửa vị trí' : 'Thêm vị trí'} onClose={onClose} wide="xl">
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">{position ? position.title : 'Thêm vị trí tuyển'}</h2>
      <p className="text-[12.5px] text-[#86868B] mt-0.5">Nhập theo khung tin tuyển dụng của khách — hệ thống tự dựng tin đăng để chép lên Facebook / Zalo.</p>

      <div className="mt-4 space-y-3">
        <section className={sectionCls}>
          <Field label="Tên vị trí *">
            <input value={d.title} onChange={e => set('title', e.target.value)} placeholder="VD: Trưởng ca sản xuất (Line Lead)" className={inputCls} autoFocus={!position} />
          </Field>
          <div>
            <span className="block text-[12px] font-medium text-[#6E6E73] mb-1">Nhóm</span>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(GROUP_LABEL) as PositionGroup[]).map(g => (
                <ChoiceChip key={g} active={d.group_code === g} onClick={() => { set('group_code', g); if (g === 'C') set('confirmed', false); }}>{GROUP_LABEL[g]}</ChoiceChip>
              ))}
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <span className="block text-[12px] font-medium text-[#6E6E73] mb-1">Loại hợp đồng</span>
              <div className="flex flex-wrap gap-1.5">
                {(['direct', 'leasing'] as EmploymentType[]).map(t => (
                  <ChoiceChip key={t} active={d.employment_type === t} onClick={() => set('employment_type', t)}>
                    {t === 'direct' ? 'Chính thức của KH (giới thiệu)' : "Thời vụ Let's Go"}
                  </ChoiceChip>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Switch checked={d.confirmed} onChange={v => set('confirmed', v)} label="Khách đã xác nhận nhu cầu" />
              <Switch checked={d.is_open} onChange={v => set('is_open', v)} label="Đang mở tuyển (hiện trên form ứng tuyển)" />
            </div>
          </div>
          {!d.confirmed && <p className="text-[12px] text-[#B25000]">Vị trí khảo sát: chỉ tiêu của vị trí này KHÔNG cộng vào tổng kế hoạch.</p>}
          {sites.length > 0 && (
            <div>
              <span className="block text-[12px] font-medium text-[#6E6E73] mb-1">Nhà máy (bỏ trống = mọi nhà máy)</span>
              <div className="flex flex-wrap gap-1.5">
                {sites.map(s => <ChoiceChip key={s.id} active={d.site_ids.includes(s.id)} onClick={() => toggleSite(s.id)}>{s.name}</ChoiceChip>)}
              </div>
            </div>
          )}
        </section>

        <section className={sectionCls}>
          {wageHints.length > 0 && (
            <div className="rounded-[10px] bg-white border border-black/[0.06] px-3 py-2 text-[12px] space-y-1">
              <div className="font-semibold text-[#1D1D1F]">Lương thị trường (tab Lương TT)</div>
              {wageHints.map(w => (
                <div key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#6E6E73]">
                  <span>{w.zone_name} · {new Date(w.survey_date).toLocaleDateString('vi-VN')}:</span>
                  {(w.wage_unskilled_min || w.wage_unskilled_max) && <button type="button" onClick={() => applyWage(w.wage_unskilled_min, w.wage_unskilled_max)} className="text-[#0066CC] hover:underline">PT {tr(w.wage_unskilled_min)}–{tr(w.wage_unskilled_max)} tr</button>}
                  {(w.wage_skilled_min || w.wage_skilled_max) && <button type="button" onClick={() => applyWage(w.wage_skilled_min, w.wage_skilled_max)} className="text-[#0066CC] hover:underline">Tay nghề {tr(w.wage_skilled_min)}–{tr(w.wage_skilled_max)} tr</button>}
                  {w.wage_tech && <button type="button" onClick={() => applyWage(w.wage_tech, w.wage_tech)} className="text-[#0066CC] hover:underline">KTV {tr(w.wage_tech)} tr</button>}
                </div>
              ))}
              <div className="text-[11px] text-[#86868B]">Bấm vào mức lương để điền vào ô bên dưới.</div>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Lương từ (đ/tháng)"><MoneyInput value={d.salary_min} onChange={v => set('salary_min', v)} placeholder="12.000.000" /></Field>
            <Field label="Lương đến"><MoneyInput value={d.salary_max} onChange={v => set('salary_max', v)} placeholder="20.000.000" /></Field>
            <Field label="Giờ làm / tuần">
              <input type="number" min={0} value={d.hours_per_week ?? ''} onChange={e => set('hours_per_week', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} />
            </Field>
            <Field label="Ca làm">
              <input value={d.shift_note} onChange={e => set('shift_note', e.target.value)} placeholder="3 ca luân phiên / hành chính" className={inputCls} />
            </Field>
            <Field label="Ghi chú lương" className="col-span-2 md:col-span-4">
              <input value={d.salary_note} onChange={e => set('salary_note', e.target.value)} placeholder="VD: thoả thuận theo kinh nghiệm, chưa gồm tăng ca" className={inputCls} />
            </Field>
          </div>
        </section>

        <section className={sectionCls}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Học vấn tối thiểu">
              <select value={d.education_min} onChange={e => set('education_min', e.target.value)} className={inputCls}>
                <option value="">Không yêu cầu</option>
                {EDUCATION_ORDER.map(k => <option key={k} value={k}>{EDUCATION_LABEL[k]}</option>)}
              </select>
            </Field>
            <Field label="Tuổi từ">
              <input type="number" value={d.age_min ?? ''} onChange={e => set('age_min', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} />
            </Field>
            <Field label="Tuổi đến">
              <input type="number" value={d.age_max ?? ''} onChange={e => set('age_max', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} />
            </Field>
            <Field label="Giới tính">
              <select value={d.gender_pref} onChange={e => set('gender_pref', e.target.value as Draft['gender_pref'])} className={inputCls}>
                <option value="any">Không yêu cầu</option>
                <option value="male">Ưu tiên nam</option>
                <option value="female">Ưu tiên nữ</option>
              </select>
            </Field>
          </div>
          <Switch checked={d.cleanroom} onChange={v => set('cleanroom', v)} label="Làm trong phòng sạch / máy lạnh" />
          <Field label="Mô tả công việc" hint="Mỗi dòng 1 ý">
            <textarea value={d.description} onChange={e => set('description', e.target.value)} rows={4} className={inputCls} />
          </Field>
          <Field label="Yêu cầu khác" hint="Kinh nghiệm, kỹ năng… (học vấn / tuổi / phòng sạch ở trên tự thêm vào tin)">
            <textarea value={d.requirements} onChange={e => set('requirements', e.target.value)} rows={3} className={inputCls} />
          </Field>
          <Field label="Chế độ phúc lợi" hint="VD: phụ cấp chuyên cần 650.000đ, thưởng tháng 13, cơm công ty, xe đưa đón…">
            <textarea value={d.benefits} onChange={e => set('benefits', e.target.value)} rows={4} className={inputCls} />
          </Field>
        </section>

        <section className={sectionCls}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[14px] font-semibold text-[#1D1D1F]">Xem trước tin tuyển dụng</h3>
            <button type="button" onClick={copy} className={PILL_TINTED}><Copy size={14} /> Chép tin</button>
          </div>
          <pre className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#1D1D1F] bg-white rounded-[10px] p-3 border border-black/[0.06] max-h-[320px] overflow-y-auto font-sans">{preview}</pre>
        </section>

        {error && <ErrorBanner>{error}</ErrorBanner>}
      </div>

      {canEdit && (
        <div className={`${SHEET_FOOTER} mt-4 flex items-center gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
          {position && (
            <button type="button" onClick={remove} disabled={busy} className={`${PILL_GRAY} text-[#D70015]`}><Trash2 size={14} /> Xoá</button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className={PILL_GRAY}>Đóng</button>
          <button type="button" onClick={submit} disabled={busy} className={PILL_PRIMARY}>{busy ? 'Đang lưu…' : 'Lưu vị trí'}</button>
        </div>
      )}
    </Sheet>
  );
}
