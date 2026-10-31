// Hồ sơ 1 ứng viên: thông tin, các lần ứng tuyển (chuyển bước ngay tại đây), nhật ký; sửa / thêm vào dự án.
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { createApplication, deleteApplication, deleteCandidate, errText, getCandidate, saveCandidate } from '../../lib/recruit/api';
import { moneyShort } from '../../lib/recruit/jobPost';
import { ageOf, formatPhone, telHref, zaloHref } from '../../lib/recruit/normalize';
import { STAGE_META } from '../../lib/recruit/stages';
import { EDUCATION_LABEL, EMPLOYMENT_LABEL } from '../../lib/recruit/types';
import type { RecruitApplication, RecruitCandidate, RecruitEvent, RecruitStage } from '../../lib/recruit/types';
import { nameOf, useRecruit } from './context';
import AppActions from './AppActions';
import CandidateForm, { cleanCandidate, validateCandidate } from './CandidateForm';
import type { CandidateDraft } from './CandidateForm';
import { ErrorBanner, Field, PILL_GRAY, PILL_PRIMARY, PILL_TINTED, SHEET_FOOTER, Sheet, Spinner, StageBadge, fmtDate, fmtDateTime, inputCls, sectionCls } from './ui';

export default function CandidateSheet({ candidateId, onClose, onChanged }: {
  candidateId: string;
  onClose: () => void;
  /** Có thay đổi (bước, thông tin) → nơi mở nạp lại danh sách */
  onChanged?: () => void;
}) {
  const { boot, clients, toast, canEdit, reload } = useRecruit();
  const [id, setId] = useState(candidateId);
  const [data, setData] = useState<{ candidate: RecruitCandidate | null; applications: RecruitApplication[]; events: RecruitEvent[] } | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<CandidateDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getCandidate(id));
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const changed = () => { load(); onChanged?.(); reload(); };

  const c = data?.candidate ?? null;
  const apps = data?.applications ?? [];
  const events = data?.events ?? [];
  const projectName = (pid: string | null) => nameOf(boot.projects, pid);
  const siteName = (sid: string | null) => nameOf(boot.sites, sid);
  const positionName = (pid: string | null) => boot.positions.find(p => p.id === pid)?.title ?? '';

  const saveEdit = async () => {
    if (!editing || !c) return;
    const msg = validateCandidate(editing);
    if (msg) { setError(msg); return; }
    setBusy(true);
    try {
      const r = await saveCandidate({ ...cleanCandidate(editing), id: c.id });
      if (r.duplicate) { setError(`SĐT/CCCD đã thuộc hồ sơ ${r.duplicate.full_name} — không lưu`); return; }
      setEditing(null);
      setError('');
      toast('Đã lưu hồ sơ');
      changed();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!c || !confirm(`Xoá hồ sơ ${c.full_name}?\n\nHồ sơ và các lần ứng tuyển bị ẩn (xoá mềm). SĐT có thể dùng lại cho hồ sơ mới.`)) return;
    try {
      await deleteCandidate(c.id);
      toast('Đã xoá hồ sơ');
      onChanged?.();
      reload();
      onClose();
    } catch (e) {
      setError(errText(e));
    }
  };

  const removeApp = async (a: RecruitApplication) => {
    if (!confirm('Xoá lần ứng tuyển này? (dùng khi tạo nhầm — muốn đóng hồ sơ thì chọn "Đổi bước…")')) return;
    try {
      await deleteApplication(a.id);
      changed();
    } catch (e) {
      toast(errText(e));
    }
  };

  return (
    <Sheet label="Hồ sơ ứng viên" onClose={onClose} wide="xl">
      {!data && !error && <div className="py-12 flex justify-center"><Spinner /></div>}
      {error && <div className="mb-3"><ErrorBanner>{error}</ErrorBanner></div>}
      {data && !c && <p className="text-[13px] text-[#86868B] py-6">Hồ sơ không còn (đã xoá).</p>}
      {c && !editing && (
        <>
          <div className="flex items-start gap-3 pr-8">
            <div className="min-w-0 flex-1">
              <h2 className="text-[22px] font-bold tracking-[-0.02em] text-[#1D1D1F] leading-tight">
                {c.full_name}
                {c.blacklisted && <span className="ml-2 align-middle text-[11px] px-2 py-0.5 rounded-full bg-[#1D1D1F] text-white font-semibold">Danh sách đen</span>}
              </h2>
              <p className="text-[13px] text-[#6E6E73] mt-0.5">
                {[c.birth_year && `${c.birth_year} (${ageOf(c.birth_year)} tuổi)`, c.gender === 'male' ? 'Nam' : c.gender === 'female' ? 'Nữ' : '',
                  c.education && EDUCATION_LABEL[c.education as keyof typeof EDUCATION_LABEL], c.major].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {c.phone && <a href={telHref(c.phone)} className={PILL_TINTED}><Phone size={14} /> {formatPhone(c.phone)}</a>}
            {c.phone && <a href={zaloHref(c.phone)} target="_blank" rel="noreferrer" className={PILL_GRAY}><MessageCircle size={14} /> Zalo</a>}
            {canEdit && <button type="button" onClick={() => setEditing({ ...c })} className={PILL_GRAY}><Pencil size={14} /> Sửa</button>}
          </div>

          <dl className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2.5 text-[13px] rounded-[14px] bg-white md:bg-[#F5F5F7] p-3.5">
            <Info k="CCCD" v={c.id_number} />
            <Info k="SĐT khác" v={c.phone_alt && formatPhone(c.phone_alt)} />
            <Info k="Đang ở" v={[c.commune, c.province].filter(Boolean).join(', ')} />
            <Info k="Địa chỉ" v={c.address} />
            <Info k="Quê quán" v={c.hometown} />
            <Info k="Làm ca / phòng sạch" v={[c.shift_ok == null ? '' : c.shift_ok ? 'Làm ca được' : 'Không làm ca', c.cleanroom_ok == null ? '' : c.cleanroom_ok ? 'phòng sạch được' : 'không phòng sạch'].filter(Boolean).join(' · ')} />
            <Info k="Chờ bằng" v={c.diploma_pending ? `Có${c.diploma_due ? ` — hạn nộp ${fmtDate(c.diploma_due)}` : ''}` : ''} />
            <Info k="Kinh nghiệm" v={c.experience} />
            <Info k="Nguồn" v={[c.source_channel, c.referrer_name && `giới thiệu: ${c.referrer_name}${c.referrer_phone ? ` (${formatPhone(c.referrer_phone)})` : ''}`].filter(Boolean).join(' · ')} />
            <Info k="Đồng ý dữ liệu" v={c.consent_at ? `Có — ${fmtDate(c.consent_at)}` : 'Chưa ghi nhận'} />
            {c.blacklisted && <Info k="Lý do danh sách đen" v={c.blacklist_reason} />}
            {c.notes && <Info k="Ghi chú" v={c.notes} wide />}
          </dl>

          <div className="mt-5 flex items-center justify-between gap-2">
            <h3 className="text-[16px] font-semibold text-[#1D1D1F]">Ứng tuyển <span className="text-[#86868B] font-normal">{apps.length}</span></h3>
            {canEdit && !c.blacklisted && <button type="button" onClick={() => setAdding(v => !v)} className={PILL_TINTED}><Plus size={14} /> Thêm vào dự án</button>}
          </div>
          {adding && <AddToProject candidateId={c.id} onDone={() => { setAdding(false); changed(); }} />}
          <div className="mt-2 space-y-2">
            {apps.length === 0 && <p className="text-[13px] text-[#86868B]">Chưa ứng tuyển dự án nào.</p>}
            {apps.map(a => (
              <div key={a.id} className="rounded-[14px] bg-white md:bg-[#F5F5F7] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StageBadge stage={a.stage} />
                  <span className="text-[13.5px] font-medium text-[#1D1D1F] min-w-0 truncate">
                    {projectName(a.project_id) || nameOf(clients, a.client_id) || 'Không rõ dự án'}
                  </span>
                  <span className="text-[12px] text-[#86868B]">{[siteName(a.site_id), positionName(a.position_id), EMPLOYMENT_LABEL[a.employment_type]].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="text-[12px] text-[#6E6E73] mt-1">{appDates(a)}</div>
                <div className="mt-2 flex items-center gap-2">
                  <AppActions app={{ ...a, candidate: { ...c, id: c.id } as RecruitApplication['candidate'] }} onChanged={changed} />
                  <div className="flex-1" />
                  {canEdit && <button type="button" onClick={() => removeApp(a)} title="Xoá (tạo nhầm)" aria-label="Xoá lần ứng tuyển" className="w-8 h-8 rounded-full flex items-center justify-center text-[#AEAEB2] hover:text-[#D70015] hover:bg-black/[0.05]"><Trash2 size={14} /></button>}
                </div>
              </div>
            ))}
          </div>

          {events.length > 0 && (
            <>
              <h3 className="text-[16px] font-semibold text-[#1D1D1F] mt-5">Nhật ký</h3>
              <ol className="mt-2 space-y-1.5">
                {events.slice(0, 30).map(e => (
                  <li key={e.id} className="text-[12.5px] text-[#6E6E73] flex gap-2">
                    <span className="tabular-nums text-[#86868B] shrink-0">{fmtDateTime(e.at)}</span>
                    <span className="min-w-0">
                      {eventText(e)}{e.note ? ` — ${e.note}` : ''}{e.by_name ? <span className="text-[#AEAEB2]"> · {e.by_name}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}

          {canEdit && (
            <div className="mt-6 pt-3 border-t border-black/[0.06] flex justify-end">
              <button type="button" onClick={remove} className={`${PILL_GRAY} text-[#D70015]`}><Trash2 size={14} /> Xoá hồ sơ</button>
            </div>
          )}
        </>
      )}

      {c && editing && (
        <>
          <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] mb-3">Sửa hồ sơ</h2>
          <CandidateForm value={editing} onChange={setEditing} excludeId={c.id} onOpenExisting={x => { setEditing(null); setId(x); }} />
          <div className={`${SHEET_FOOTER} mt-4 flex justify-end gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
            <button type="button" onClick={() => { setEditing(null); setError(''); }} className={PILL_GRAY}>Huỷ</button>
            <button type="button" onClick={saveEdit} disabled={busy} className={PILL_PRIMARY}>{busy ? 'Đang lưu…' : 'Lưu hồ sơ'}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function Info({ k, v, wide = false }: { k: string; v: string | null | undefined | false; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-2 md:col-span-3' : ''}`}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#86868B]">{k}</dt>
      <dd className="text-[#1D1D1F] break-words whitespace-pre-line">{v || <span className="text-[#C7C7CC]">—</span>}</dd>
    </div>
  );
}

export function appDates(a: RecruitApplication): string {
  return [
    `Nộp ${fmtDate(a.created_at)}`,
    a.interview_at && `PV ${fmtDateTime(a.interview_at)}`,
    a.planned_start && !a.start_date && `hẹn nhận việc ${fmtDate(a.planned_start)}`,
    a.start_date && `đi làm ${fmtDate(a.start_date)}`,
    a.fee_date && `đủ phí ${fmtDate(a.fee_date)}`,
    a.left_date && `nghỉ ${fmtDate(a.left_date)}`,
    a.close_reason && `lý do: ${a.close_reason}`,
    a.employee_code && `mã NV ${a.employee_code}`,
    a.fee_amount != null && `phí ${a.fee_amount ? moneyShort(a.fee_amount) : '0đ (người thay)'}`,
    a.replaces_id && 'người thay bảo hành',
    a.source_channel && `nguồn ${a.source_channel}`,
  ].filter(Boolean).join(' · ');
}

function eventText(e: RecruitEvent): string {
  const lbl = (s: RecruitStage | null) => (s ? STAGE_META[s]?.label ?? s : '');
  if (e.kind === 'create') return 'Tạo hồ sơ ứng tuyển';
  if (e.kind === 'import') return `Nhập từ Excel (${lbl(e.to_stage)})`;
  if (e.kind === 'note') return 'Ghi chú';
  return e.from_stage ? `${lbl(e.from_stage)} → ${lbl(e.to_stage)}` : lbl(e.to_stage);
}

/** Thêm ứng viên vào dự án (tạo lần ứng tuyển mới). */
export function AddToProject({ candidateId, onDone }: { candidateId: string; onDone: () => void }) {
  const { boot, project, toast } = useRecruit();
  const [projectId, setProjectId] = useState(project?.id ?? '');
  const sites = boot.sites.filter(s => s.project_id === projectId);
  const positions = boot.positions.filter(p => p.project_id === projectId && p.is_open);
  const [siteId, setSiteId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!projectId) { setError('Chọn dự án'); return; }
    setBusy(true);
    setError('');
    try {
      await createApplication({ candidate_id: candidateId, project_id: projectId, site_id: siteId || null, position_id: positionId || null });
      toast('Đã thêm vào dự án');
      onDone();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <section className={`${sectionCls} mt-2`}>
      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Dự án">
          <select value={projectId} onChange={e => { setProjectId(e.target.value); setSiteId(''); setPositionId(''); }} className={inputCls}>
            <option value="">—</option>
            {boot.projects.filter(p => p.status !== 'closed').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Nhà máy">
          <select value={siteId} onChange={e => setSiteId(e.target.value)} className={inputCls}>
            <option value="">— Chưa chọn —</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Vị trí">
          <select value={positionId} onChange={e => setPositionId(e.target.value)} className={inputCls}>
            <option value="">— Chưa chọn —</option>
            {positions.filter(p => !siteId || !p.site_ids.length || p.site_ids.includes(siteId)).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </Field>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="flex justify-end"><button type="button" onClick={submit} disabled={busy} className={PILL_PRIMARY}>Thêm</button></div>
    </section>
  );
}

/** Mở hồ sơ ứng viên dạng portal (gọi được từ trong dòng danh sách). */
export function CandidateSheetPortal(props: Parameters<typeof CandidateSheet>[0]) {
  return createPortal(<CandidateSheet {...props} />, document.body);
}
