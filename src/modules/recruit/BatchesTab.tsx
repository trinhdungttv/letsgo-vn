// Tab Nhận việc: đợt nhận việc tại nhà máy (ngày, giờ, điểm hẹn, xe) → xếp người → điểm danh cả đợt
// (Đã đến = Đã nhận việc / Không đến) → xuất danh sách gửi phòng nhân sự khách.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bus, CalendarCheck, Download, MapPin, Pencil, Plus, Trash2, UserCheck, UserPlus, UserX, X } from 'lucide-react';
import { TINT } from '../../components/workspace/wsTheme';
import { assignBatch, deleteBatch, errText, getBatch, listApplications, listBatches, moveApplications, saveBatch, unassignBatch } from '../../lib/recruit/api';
import { downloadXlsx } from '../../lib/recruit/exportXlsx';
import { formatPhone } from '../../lib/recruit/normalize';
import { STAGE_META } from '../../lib/recruit/stages';
import type { RecruitApplication, RecruitApplicationFull, RecruitBatch } from '../../lib/recruit/types';
import { nameOf, useRecruit } from './context';
import CandidateSheet from './CandidateSheet';
import {
  ErrorBanner, Field, PILL_GRAY, PILL_PRIMARY, PILL_TINTED, PageTitle, Quiet, SHEET_FOOTER, Segmented, Sheet, Spinner,
  StageBadge, fmtDate, fmtNum, inputCls, sectionCls, todayIso,
} from './ui';

const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export const dayLabel = (d: string): string => `${WEEKDAY[new Date(`${d}T00:00:00`).getDay()]} ${fmtDate(d)}`;

export default function BatchesTab() {
  const { project, sites, canEdit } = useRecruit();
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const [batches, setBatches] = useState<RecruitBatch[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<RecruitBatch | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!project) return;
    try {
      setBatches(await listBatches(project.id));
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, [project]);
  useEffect(() => { load(); }, [load]);

  const today = todayIso();
  const shown = useMemo(() => {
    const list = batches ?? [];
    return view === 'upcoming'
      ? list.filter(b => b.batch_date >= today).sort((a, b) => (a.batch_date + a.start_time).localeCompare(b.batch_date + b.start_time))
      : list.filter(b => b.batch_date < today);
  }, [batches, view, today]);

  if (!project) return <Quiet>Chọn hoặc tạo dự án tuyển dụng trước.</Quiet>;
  const upcoming = (batches ?? []).filter(b => b.batch_date >= today).length;

  return (
    <div className="space-y-4">
      <PageTitle eyebrow="Nhận việc" title="Đợt nhận việc"
        subtitle="Xếp người đã đạt vào từng đợt, điểm danh ngày nhận việc, xuất danh sách gửi nhân sự khách."
        actions={canEdit ? <button type="button" onClick={() => setEditing('new')} className={PILL_PRIMARY}><Plus size={14} /> Đợt mới</button> : undefined} />
      <Segmented label="Đợt" value={view} onChange={setView} fit
        options={[{ key: 'upcoming', label: 'Sắp tới', badge: upcoming }, { key: 'past', label: 'Đã qua' }]} />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!batches && !error && <div className="py-10 flex justify-center"><Spinner /></div>}
      {batches && shown.length === 0 && <Quiet icon={<CalendarCheck size={18} />}>{view === 'upcoming' ? 'Chưa có đợt nhận việc sắp tới.' : 'Chưa có đợt nào đã qua.'}</Quiet>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {shown.map(b => {
          const full = b.capacity != null && (b.assigned ?? 0) >= b.capacity;
          return (
            <button key={b.id} type="button" onClick={() => setOpen(b.id)}
              className="text-left bg-white rounded-[18px] p-4 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.08)] hover:shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_10px_28px_-10px_rgba(0,0,0,0.16)] transition">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[17px] font-semibold text-[#1D1D1F]">{dayLabel(b.batch_date)}{b.start_time && <span className="text-[#86868B] font-normal"> · {b.start_time}</span>}</div>
                  <div className="text-[13px] text-[#6E6E73]">{nameOf(sites, b.site_id) || 'Chưa chọn nhà máy'}</div>
                </div>
                {b.status !== 'planned' && <span className={`text-[11px] px-2 py-0.5 rounded-full ${b.status === 'done' ? TINT.green : TINT.gray}`}>{b.status === 'done' ? 'Đã xong' : 'Huỷ'}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
                <span className={`px-2 py-0.5 rounded-full ${full ? TINT.orange : TINT.blue}`}>{fmtNum(b.assigned ?? 0)}{b.capacity != null ? `/${fmtNum(b.capacity)}` : ''} người</span>
                {(b.started ?? 0) > 0 && <span className={`px-2 py-0.5 rounded-full ${TINT.green}`}>{fmtNum(b.started ?? 0)} đã đến</span>}
                {(b.no_show ?? 0) > 0 && <span className={`px-2 py-0.5 rounded-full ${TINT.red}`}>{fmtNum(b.no_show ?? 0)} không đến</span>}
              </div>
              {(b.meeting_point || b.bus_route) && (
                <div className="mt-2 text-[12px] text-[#86868B] space-y-0.5">
                  {b.meeting_point && <div className="flex items-center gap-1"><MapPin size={12} /> {b.meeting_point}</div>}
                  {b.bus_route && <div className="flex items-center gap-1"><Bus size={12} /> {b.bus_route}</div>}
                </div>
              )}
            </button>
          );
        })}
      </div>
      {editing && <BatchForm batch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
      {open && <BatchDetail batchId={open} onClose={() => setOpen(null)} onChanged={load} onEdit={b => setEditing(b)} />}
    </div>
  );
}

function BatchForm({ batch, onClose, onSaved }: { batch: RecruitBatch | null; onClose: () => void; onSaved: () => void }) {
  const { project, sites, toast } = useRecruit();
  const [d, setD] = useState({
    site_id: batch?.site_id ?? (sites.length === 1 ? sites[0].id : ''), batch_date: batch?.batch_date ?? '', start_time: batch?.start_time ?? '07:30',
    capacity: batch?.capacity ?? null as number | null, meeting_point: batch?.meeting_point ?? '', bus_route: batch?.bus_route ?? '',
    note: batch?.note ?? '', status: batch?.status ?? 'planned' as RecruitBatch['status'],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!project) return null;
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(cur => ({ ...cur, [k]: v }));
  const submit = async () => {
    if (!d.batch_date) { setError('Chọn ngày nhận việc'); return; }
    setBusy(true);
    try {
      await saveBatch({ ...(batch ? { id: batch.id } : { project_id: project.id }), ...d, site_id: d.site_id || null });
      toast(batch ? 'Đã lưu đợt' : 'Đã tạo đợt nhận việc');
      onSaved();
      onClose();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return createPortal(
    <Sheet label={batch ? 'Sửa đợt' : 'Đợt nhận việc mới'} onClose={onClose} wide>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">{batch ? 'Sửa đợt nhận việc' : 'Đợt nhận việc mới'}</h2>
      <section className={`${sectionCls} mt-4`}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nhà máy" className="col-span-2">
            <select value={d.site_id} onChange={e => set('site_id', e.target.value)} className={inputCls}>
              <option value="">— Chọn —</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Ngày *"><input type="date" value={d.batch_date} onChange={e => set('batch_date', e.target.value)} className={inputCls} /></Field>
          <Field label="Giờ có mặt"><input type="time" value={d.start_time} onChange={e => set('start_time', e.target.value)} className={inputCls} /></Field>
          <Field label="Số người tối đa">
            <input type="number" min={0} value={d.capacity ?? ''} onChange={e => set('capacity', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Trạng thái">
            <select value={d.status} onChange={e => set('status', e.target.value as RecruitBatch['status'])} className={inputCls}>
              <option value="planned">Sắp diễn ra</option>
              <option value="done">Đã xong</option>
              <option value="cancelled">Huỷ</option>
            </select>
          </Field>
          <Field label="Điểm hẹn" className="col-span-2"><input value={d.meeting_point} onChange={e => set('meeting_point', e.target.value)} placeholder="VD: Cổng số 2 nhà máy / văn phòng LGV VSIP" className={inputCls} /></Field>
          <Field label="Xe đưa đón" className="col-span-2"><input value={d.bus_route} onChange={e => set('bus_route', e.target.value)} placeholder="VD: Xe 29 chỗ, đón 6h45 ngã tư Thuận An" className={inputCls} /></Field>
          <Field label="Giấy tờ cần mang / ghi chú" className="col-span-2"><textarea value={d.note} onChange={e => set('note', e.target.value)} rows={2} placeholder="CCCD gốc, giấy khám sức khoẻ, sơ yếu lý lịch, bằng cấp (KTV)…" className={inputCls} /></Field>
        </div>
      </section>
      {error && <div className="mt-3"><ErrorBanner>{error}</ErrorBanner></div>}
      <div className={`${SHEET_FOOTER} mt-4 flex justify-end gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <button type="button" onClick={onClose} className={PILL_GRAY}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy} className={PILL_PRIMARY}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      </div>
    </Sheet>,
    document.body,
  );
}

function BatchDetail({ batchId, onClose, onChanged, onEdit }: {
  batchId: string;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (b: RecruitBatch) => void;
}) {
  const { project, sites, positions, toast, canEdit } = useRecruit();
  const [data, setData] = useState<{ batch: RecruitBatch | null; rows: RecruitApplicationFull[] } | null>(null);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openCand, setOpenCand] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await getBatch(batchId)); setError(''); } catch (e) { setError(errText(e)); }
  }, [batchId]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); onChanged(); };

  const b = data?.batch;
  const rows = data?.rows ?? [];
  const waiting = rows.filter(r => r.stage === 'ready');
  const posName = (id: string | null) => positions.find(p => p.id === id)?.title ?? '';

  const attend = async (ids: string[], came: boolean) => {
    if (!b || !ids.length) return;
    setBusy(true);
    try {
      await moveApplications(ids, came ? 'started' : 'no_show', came ? { start_date: b.batch_date } : { reason: 'Không đến ngày nhận việc' });
      toast(came ? `${ids.length} người đã nhận việc` : `${ids.length} người không đến`);
      changed();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try { await unassignBatch([id]); changed(); } catch (e) { toast(errText(e)); }
  };
  const removeBatch = async () => {
    if (!b || !confirm(`Xoá đợt ${dayLabel(b.batch_date)}? Người trong đợt vẫn giữ nguyên hồ sơ (chỉ bỏ gắn đợt).`)) return;
    try { await deleteBatch(b.id); onChanged(); onClose(); } catch (e) { toast(errText(e)); }
  };
  const exportList = async () => {
    if (!b || !project) return;
    const site = nameOf(sites, b.site_id);
    await downloadXlsx(`Danh sach nhan viec ${site} ${b.batch_date}`, [{
      name: 'Nhận việc',
      title: [`DANH SÁCH NHẬN VIỆC — ${project.name}`, `Nhà máy: ${site} · Ngày ${fmtDate(b.batch_date)}${b.start_time ? ` · ${b.start_time}` : ''}`, `Điểm hẹn: ${b.meeting_point || '—'}`],
      headers: ['STT', 'Họ tên', 'Năm sinh', 'Giới tính', 'CCCD', 'SĐT', 'Quê quán', 'Trình độ', 'Vị trí', 'Trạng thái'],
      rows: rows.map((r, i) => [i + 1, r.candidate.full_name, r.candidate.birth_year, r.candidate.gender === 'male' ? 'Nam' : r.candidate.gender === 'female' ? 'Nữ' : '',
        r.candidate.id_number, r.candidate.phone, r.candidate.hometown, r.candidate.education, posName(r.position_id), STAGE_META[r.stage].label]),
      widths: [6, 26, 10, 10, 16, 13, 18, 12, 26, 18],
    }]);
  };

  return createPortal(
    <Sheet label="Đợt nhận việc" onClose={onClose} wide="xl">
      {!data && !error && <div className="py-12 flex justify-center"><Spinner /></div>}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {b && (
        <>
          <div className="pr-8">
            <h2 className="text-[22px] font-bold tracking-[-0.02em] text-[#1D1D1F]">{dayLabel(b.batch_date)}{b.start_time && ` · ${b.start_time}`}</h2>
            <p className="text-[13px] text-[#6E6E73]">{[nameOf(sites, b.site_id), b.meeting_point, b.bus_route].filter(Boolean).join(' · ')}</p>
            {b.note && <p className="text-[12.5px] text-[#86868B] mt-1 whitespace-pre-line">{b.note}</p>}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {canEdit && <button type="button" onClick={() => setPicking(true)} className={PILL_PRIMARY}><UserPlus size={14} /> Xếp người</button>}
            {canEdit && waiting.length > 0 && <button type="button" disabled={busy} onClick={() => attend(waiting.map(r => r.id), true)} className={PILL_TINTED}><UserCheck size={14} /> Tất cả {waiting.length} người đã đến</button>}
            <button type="button" onClick={exportList} disabled={!rows.length} className={PILL_GRAY}><Download size={14} /> Xuất Excel</button>
            {canEdit && <button type="button" onClick={() => onEdit(b)} className={PILL_GRAY}><Pencil size={14} /> Sửa</button>}
          </div>
          <div className="mt-4 rounded-[14px] bg-white md:bg-[#F5F5F7] px-3">
            {rows.length === 0 && <Quiet>Chưa xếp ai vào đợt này.</Quiet>}
            {rows.map((r, i) => (
              <div key={r.id} className={`flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-1.5 py-2.5 ${i ? 'border-t border-[#E5E5EA]' : ''}`}>
                <button type="button" onClick={() => setOpenCand(r.candidate_id)} className="min-w-0 flex-1 basis-full md:basis-auto text-left hover:opacity-80">
                  <div className="text-[14px] font-medium text-[#1D1D1F] truncate">{r.candidate.full_name} <span className="font-normal text-[#86868B]">· {formatPhone(r.candidate.phone)}{r.candidate.birth_year ? ` · ${r.candidate.birth_year}` : ''}</span></div>
                  <div className="text-[12px] text-[#86868B] truncate">{[posName(r.position_id), r.candidate.id_number ? `CCCD ${r.candidate.id_number}` : 'chưa có CCCD'].join(' · ')}</div>
                </button>
                <div className="w-full md:w-auto flex items-center justify-end gap-1.5">
                  <StageBadge stage={r.stage} className="mr-auto md:mr-0" />
                  {canEdit && r.stage === 'ready' && (<>
                    <button type="button" disabled={busy} onClick={() => attend([r.id], true)} title="Đã đến nhận việc" className="h-8 px-3 rounded-full bg-[#34C759]/[0.14] text-[#1E7B34] text-[12.5px] font-semibold inline-flex items-center gap-1"><UserCheck size={13} /> Đến</button>
                    <button type="button" disabled={busy} onClick={() => attend([r.id], false)} title="Không đến" className="h-8 px-3 rounded-full bg-[#FF3B30]/10 text-[#D70015] text-[12.5px] font-semibold inline-flex items-center gap-1"><UserX size={13} /> Không</button>
                  </>)}
                  {canEdit && <button type="button" onClick={() => remove(r.id)} title="Bỏ khỏi đợt" aria-label="Bỏ khỏi đợt" className="w-8 h-8 rounded-full flex items-center justify-center text-[#AEAEB2] hover:bg-black/[0.05] hover:text-[#1D1D1F]"><X size={14} /></button>}
                </div>
              </div>
            ))}
          </div>
          {canEdit && (
            <div className="mt-5 pt-3 border-t border-black/[0.06] flex justify-end">
              <button type="button" onClick={removeBatch} className={`${PILL_GRAY} text-[#D70015]`}><Trash2 size={14} /> Xoá đợt</button>
            </div>
          )}
          {picking && <PickPeople batch={b} already={rows.map(r => r.id)} onClose={() => setPicking(false)} onDone={() => { setPicking(false); changed(); }} />}
        </>
      )}
      {openCand && <CandidateSheet candidateId={openCand} onClose={() => setOpenCand(null)} onChanged={load} />}
    </Sheet>,
    document.body,
  );
}

/** Chọn người (Đạt PV / Chờ nhận việc, cùng nhà máy) để xếp vào đợt. */
function PickPeople({ batch, already, onClose, onDone }: { batch: RecruitBatch; already: string[]; onClose: () => void; onDone: () => void }) {
  const { project, positions, toast } = useRecruit();
  const [rows, setRows] = useState<RecruitApplication[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const projectId = project?.id;
  const alreadyKey = already.join(',');
  useEffect(() => {
    if (!projectId) return;
    const skip = new Set(alreadyKey.split(','));
    listApplications({ project_id: projectId, site_id: batch.site_id, stages: ['passed', 'ready'], limit: 500 })
      .then(r => setRows(r.rows.filter(a => !skip.has(a.id))), e => setError(errText(e)));
  }, [projectId, batch.site_id, alreadyKey]);
  const room = batch.capacity != null ? Math.max(0, batch.capacity - already.length) : null;
  const submit = async () => {
    setBusy(true);
    try {
      await assignBatch(batch.id, [...sel]);
      toast(`Đã xếp ${sel.size} người vào đợt`);
      onDone();
    } catch (e) { toast(errText(e)); setBusy(false); }
  };
  return (
    <Sheet label="Xếp người vào đợt" onClose={onClose} wide>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Xếp người vào đợt {dayLabel(batch.batch_date)}</h2>
      <p className="text-[12.5px] text-[#86868B] mt-0.5">Người đã Đạt PV hoặc đang Chờ nhận việc ở nhà máy này.{room != null ? ` Còn ${room} chỗ.` : ''}</p>
      {error && <div className="mt-3"><ErrorBanner>{error}</ErrorBanner></div>}
      <div className="mt-3 rounded-[14px] bg-white md:bg-[#F5F5F7] px-3 max-h-[55dvh] overflow-y-auto">
        {!rows && !error && <div className="py-8 flex justify-center"><Spinner /></div>}
        {rows && rows.length === 0 && <Quiet>Không còn ai Đạt PV / Chờ nhận việc ở nhà máy này.</Quiet>}
        {rows && rows.length > 0 && (
          <label className="flex items-center gap-2 py-2 text-[12px] text-[#86868B] border-b border-[#E5E5EA] cursor-pointer">
            <input type="checkbox" checked={sel.size === rows.length} onChange={() => setSel(sel.size === rows.length ? new Set() : new Set(rows.map(r => r.id)))} className="w-4 h-4 accent-[#0071E3]" />
            Chọn tất cả {rows.length}
          </label>
        )}
        {rows?.map(r => (
          <label key={r.id} className="flex items-center gap-3 py-2.5 border-b border-[#E5E5EA] last:border-0 cursor-pointer">
            <input type="checkbox" checked={sel.has(r.id)} onChange={() => setSel(cur => { const n = new Set(cur); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} className="w-4 h-4 accent-[#0071E3]" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] text-[#1D1D1F] truncate">{r.candidate?.full_name} <span className="text-[#86868B]">· {formatPhone(r.candidate?.phone ?? '')}</span></span>
              <span className="block text-[12px] text-[#86868B] truncate">{[positions.find(p => p.id === r.position_id)?.title, STAGE_META[r.stage].label, r.planned_start && `hẹn ${fmtDate(r.planned_start)}`].filter(Boolean).join(' · ')}</span>
            </span>
          </label>
        ))}
      </div>
      {room != null && sel.size > room && <p className="mt-2 text-[12.5px] text-[#B25000]">Chọn {sel.size} người, vượt sức chứa {room} chỗ còn lại.</p>}
      <div className={`${SHEET_FOOTER} mt-4 flex justify-end gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <button type="button" onClick={onClose} className={PILL_GRAY}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy || sel.size === 0} className={PILL_PRIMARY}>Xếp {sel.size} người</button>
      </div>
    </Sheet>
  );
}
