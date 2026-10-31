// Tab Đang cho thuê (GĐ4, trước tên "Thời vụ"): lao động thời vụ của các khách cho thuê, quản lý tới từng người — nhắc mốc 12 tháng
// (BLLĐ 2019 Điều 53), chuyển chính thức cho khách, đối chiếu với số lao động tuần đang nhập ở Khách hàng.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowRightLeft, FileSpreadsheet, HardHat, UserPlus } from 'lucide-react';
import { TINT } from '../../components/workspace/wsTheme';
import { convertWorkforce, createApplication, errText, isUnsupported, listWorkforce, loadWorkforceSummary, saveCandidate } from '../../lib/recruit/api';
import { foldVn, formatPhone } from '../../lib/recruit/normalize';
import { LEASE_MAX_MONTHS, LEASE_WARN_MONTHS, headcountGap, leaseLevel, leaseLimitDate, monthsWorked } from '../../lib/recruit/workforce';
import type { RecruitApplicationFull, WorkforceSummary } from '../../lib/recruit/types';
import { compareVnName } from '../../lib/vnName';
import { nameOf, useRecruit } from './context';
import AppActions from './AppActions';
import CandidateForm, { blankCandidate, cleanCandidate, validateCandidate } from './CandidateForm';
import type { CandidateDraft } from './CandidateForm';
import CandidateSheet from './CandidateSheet';
import ImportSheet from './ImportSheet';
import {
  CAPTION, ErrorBanner, Field, MoneyInput, PILL_GRAY, PILL_PRIMARY, PageTitle, Panel, PillSelect, Quiet, SHEET_FOOTER, SearchField,
  Sheet, Spinner, Switch, fmtDate, fmtNum, inputCls, sectionCls, todayIso,
} from './ui';

const LEVEL_CLS = { ok: TINT.gray, warn: TINT.orange, over: TINT.red } as const;

export default function WorkforceTab() {
  const { clients, canEdit, toast, reload } = useRecruit();
  const [summary, setSummary] = useState<WorkforceSummary[] | null>(null);
  const [rows, setRows] = useState<RecruitApplicationFull[] | null>(null);
  const [clientId, setClientId] = useState('');
  const [over10, setOver10] = useState(false);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [converting, setConverting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openCand, setOpenCand] = useState<string | null>(null);
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([loadWorkforceSummary(), listWorkforce(clientId || null, over10)]);
      setSummary(s); setRows(r); setError(''); setMissing(false);
      setSel(new Set());
    } catch (e) {
      if (isUnsupported(e)) setMissing(true); else setError(errText(e));
    }
  }, [clientId, over10]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); reload(); };

  const shown = useMemo(() => {
    const k = foldVn(q.trim());
    const digits = q.replace(/\D/g, '');
    return (rows ?? []).filter(r => !k || foldVn(r.candidate.full_name).includes(k) || (digits.length >= 3 && r.candidate.phone.includes(digits)));
  }, [rows, q]);

  if (missing) return <Quiet>Phần Đang cho thuê cần chạy migration 183 (20261101130000_183_recruit_workforce.sql) trên Supabase.</Quiet>;

  const totals = (summary ?? []).reduce((a, s) => ({ active: a.active + s.active, warn: a.warn + s.warn10, over: a.over + s.over12 }), { active: 0, warn: 0, over: 0 });
  const chosen = shown.filter(r => sel.has(r.id));
  const clientOptions = clients.filter(c => !c.archived_at).sort((a, b) => compareVnName(a.name, b.name));

  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle eyebrow="Đang cho thuê" title="Lao động thời vụ theo từng người"
        subtitle={`Cho thuê lại lao động tối đa ${LEASE_MAX_MONTHS} tháng (BLLĐ 2019 Điều 53) — nhắc từ tháng thứ ${LEASE_WARN_MONTHS} để chuyển chính thức cho khách hoặc điều chuyển.`}
        actions={canEdit ? (<>
          <button type="button" onClick={() => setImporting(true)} className={PILL_GRAY}><FileSpreadsheet size={14} /> Nhập Excel</button>
          <button type="button" onClick={() => setAdding(true)} className={PILL_PRIMARY}><UserPlus size={14} /> Người lao động</button>
        </>) : undefined} />
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Đang làm thời vụ" value={fmtNum(totals.active)} />
        <Stat label={`Từ tháng ${LEASE_WARN_MONTHS}`} value={fmtNum(totals.warn)} tone={totals.warn ? 'warn' : undefined} />
        <Stat label={`Đủ / quá ${LEASE_MAX_MONTHS} tháng`} value={fmtNum(totals.over)} tone={totals.over ? 'bad' : undefined} />
      </div>

      <Panel title="Theo khách hàng" icon={<HardHat size={16} className="text-[#B25000]" />} flush
        meta="Đối chiếu số người theo danh sách từng người với số lao động tuần gần nhất đang nhập ở trang Khách hàng.">
        {!summary && !error && <div className="py-6 flex justify-center"><Spinner /></div>}
        {summary && summary.length === 0 && <div className="px-4 md:px-5"><Quiet>Chưa có ai. Bấm "Nhập Excel" để đưa danh sách lao động thời vụ đang làm của từng khách vào.</Quiet></div>}
        {summary && summary.length > 0 && (
          <div className="overflow-x-auto px-4 md:px-5 pb-3">
            <table className="w-full min-w-[640px] text-[13px] tabular-nums [&_th]:whitespace-nowrap">
              <thead><tr className="text-[11.5px] text-[#86868B] text-right">
                <th className="text-left font-semibold py-1.5">Khách hàng</th><th className="font-semibold">Đang làm</th><th className="font-semibold">Từ tháng 10</th>
                <th className="font-semibold">≥ 12 tháng</th><th className="font-semibold">HĐ sắp hết</th><th className="font-semibold">Số tuần gần nhất</th><th className="font-semibold">Lệch</th>
              </tr></thead>
              <tbody>
                {summary.map(s => {
                  const gap = headcountGap(s.active, s.weekly_count);
                  return (
                    <tr key={s.client_id} onClick={() => setClientId(s.client_id === clientId ? '' : s.client_id)}
                      className={`text-right border-t border-[#E5E5EA] cursor-pointer hover:bg-[#FAFAFC] ${s.client_id === clientId ? 'bg-[#0071E3]/[0.06]' : ''}`}>
                      <td className="text-left py-2 text-[#1D1D1F]">{nameOf(clients, s.client_id) || 'Khách đã xoá'}</td>
                      <td className="font-semibold">{fmtNum(s.active)}</td>
                      <td className={s.warn10 ? 'text-[#B25000] font-semibold' : ''}>{s.warn10 || '—'}</td>
                      <td className={s.over12 ? 'text-[#D70015] font-semibold' : ''}>{s.over12 || '—'}</td>
                      <td>{s.contract_ending || '—'}</td>
                      <td>{s.weekly_count != null ? `${fmtNum(s.weekly_count)} (${s.weekly_label})` : '—'}</td>
                      <td className={gap ? 'text-[#B25000] font-semibold' : ''}>{gap == null ? '—' : gap === 0 ? 'khớp' : gap > 0 ? `+${gap}` : gap}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder="Tìm tên, SĐT…" className="w-full md:w-[240px]" />
        <PillSelect label="Khách hàng" value={clientId} active={!!clientId} onChange={setClientId}>
          <option value="">Mọi khách</option>
          {(summary ?? []).map(s => <option key={s.client_id} value={s.client_id}>{nameOf(clients, s.client_id) || s.client_id}</option>)}
        </PillSelect>
        <Switch checked={over10} onChange={setOver10} label={`Chỉ người từ tháng ${LEASE_WARN_MONTHS}`} />
      </div>

      {canEdit && chosen.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-[14px] bg-[#1D1D1F] text-white px-3.5 py-2 shadow-lg">
          <span className="text-[13px] font-semibold">Đã chọn {chosen.length}</span>
          <button type="button" onClick={() => setConverting(true)} className="h-8 px-3 rounded-full bg-white/15 text-[12.5px] font-semibold inline-flex items-center gap-1"><ArrowRightLeft size={13} /> Chuyển chính thức</button>
          <button type="button" onClick={() => setSel(new Set())} className="ml-auto text-[12.5px] text-white/70 hover:text-white">Bỏ chọn</button>
        </div>
      )}

      <div className="bg-white rounded-[18px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.08)] px-3 md:px-4 py-1">
        {rows && shown.length === 0 && <Quiet>{over10 ? 'Không có ai từ tháng 10.' : 'Không có người đang làm thời vụ phù hợp.'}</Quiet>}
        {shown.map((r, i) => {
          const m = monthsWorked(r.start_date, today);
          const lv = leaseLevel(m);
          return (
            <div key={r.id} className={`flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-1.5 py-2.5 ${i ? 'border-t border-[#E5E5EA]' : ''}`}>
              {canEdit && <input type="checkbox" checked={sel.has(r.id)} aria-label={`Chọn ${r.candidate.full_name}`}
                onChange={() => setSel(cur => { const n = new Set(cur); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} className="w-4 h-4 accent-[#0071E3] shrink-0" />}
              <button type="button" onClick={() => setOpenCand(r.candidate_id)} className="min-w-0 flex-1 basis-[calc(100%-2rem)] md:basis-auto text-left hover:opacity-80">
                <div className="text-[14px] font-medium text-[#1D1D1F] truncate">{r.candidate.full_name} <span className="font-normal text-[#86868B]">· {formatPhone(r.candidate.phone)}</span></div>
                <div className="text-[12px] text-[#86868B] truncate">
                  {[nameOf(clients, r.client_id), `đi làm ${fmtDate(r.start_date)}`, lv !== 'ok' && r.start_date ? `mốc 12 tháng ${fmtDate(leaseLimitDate(r.start_date))}` : '',
                    r.contract_end ? `HĐ đến ${fmtDate(r.contract_end)}` : ''].filter(Boolean).join(' · ')}
                </div>
              </button>
              <div className="w-full md:w-auto flex items-center justify-end gap-2 pl-7 md:pl-0">
                <span className={`mr-auto md:mr-0 inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11.5px] font-semibold ${LEVEL_CLS[lv]}`}>
                  {lv !== 'ok' && <AlertTriangle size={11} />}{m} tháng
                </span>
                <AppActions app={r} onChanged={changed} compact />
              </div>
            </div>
          );
        })}
      </div>
      <p className={CAPTION}>Nghỉ việc / điều chuyển: dùng nút "…" trên từng dòng. Điều chuyển sang khách khác = cho nghỉ ở khách cũ rồi thêm lại ở khách mới (giữ nguyên hồ sơ).</p>

      {converting && createPortal(<ConvertSheet rows={chosen} onClose={() => setConverting(false)} onDone={n => { setConverting(false); toast(`Đã chuyển chính thức ${n} người`); changed(); }} />, document.body)}
      {adding && createPortal(<AddWorkerSheet clientOptions={clientOptions} defaultClient={clientId} onClose={() => setAdding(false)} onDone={changed} />, document.body)}
      {importing && <ImportSheet leasing onClose={() => setImporting(false)} onDone={changed} />}
      {openCand && <CandidateSheet candidateId={openCand} onClose={() => setOpenCand(null)} onChanged={load} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="bg-white rounded-[16px] px-4 py-3 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06)]">
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#86868B]">{label}</div>
      <div className={`text-[24px] font-bold tabular-nums mt-0.5 ${tone === 'bad' ? 'text-[#D70015]' : tone === 'warn' ? 'text-[#B25000]' : 'text-[#1D1D1F]'}`}>{value}</div>
    </div>
  );
}

/** Chuyển chính thức: đóng hồ sơ thời vụ + mở hồ sơ chính thức của khách (có phí chuyển đổi thì vào đối soát). */
function ConvertSheet({ rows, onClose, onDone }: { rows: RecruitApplicationFull[]; onClose: () => void; onDone: (n: number) => void }) {
  const { boot } = useRecruit();
  const [date, setDate] = useState(todayIso());
  const [fee, setFee] = useState<number | null>(null);
  const [projectId, setProjectId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    try {
      const r = await convertWorkforce(rows.map(x => x.id), date, fee, projectId || null, note.trim());
      onDone(r.converted);
    } catch (e) { setError(errText(e)); setBusy(false); }
  };
  return (
    <Sheet label="Chuyển chính thức" onClose={onClose}>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Chuyển chính thức cho khách</h2>
      <p className="text-[12.5px] text-[#86868B] mt-0.5">{rows.length} người · hồ sơ thời vụ đóng lại (giữ lịch sử), mở hồ sơ chính thức từ ngày chuyển.</p>
      <section className={`${sectionCls} mt-4`}>
        <Field label="Ngày chuyển"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Phí chuyển đổi / người (nếu có)" hint="Có phí → hồ sơ vào thẳng bước Đủ ngày tính phí, chờ đối soát với khách">
          <MoneyInput value={fee} onChange={setFee} placeholder="Không thu" />
        </Field>
        {fee != null && fee > 0 && (
          <Field label="Gắn dự án tuyển dụng (để đối soát)">
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className={inputCls}>
              <option value="">— Theo hồ sơ cũ —</option>
              {boot.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Ghi chú"><input value={note} onChange={e => setNote(e.target.value)} className={inputCls} /></Field>
      </section>
      {error && <div className="mt-3"><ErrorBanner>{error}</ErrorBanner></div>}
      <div className={`${SHEET_FOOTER} mt-4 flex justify-end gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <button type="button" onClick={onClose} className={PILL_GRAY}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy || !date} className={PILL_PRIMARY}>{busy ? 'Đang chuyển…' : `Chuyển ${rows.length} người`}</button>
      </div>
    </Sheet>
  );
}

/** Thêm 1 người đang làm thời vụ cho 1 khách. */
function AddWorkerSheet({ clientOptions, defaultClient, onClose, onDone }: {
  clientOptions: { id: string; name: string }[];
  defaultClient: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useRecruit();
  const [draft, setDraft] = useState<CandidateDraft>(() => ({ ...blankCandidate(), consent_at: new Date().toISOString(), consent_source: 'verbal' }));
  const [clientId, setClientId] = useState(defaultClient);
  const [start, setStart] = useState(todayIso());
  const [contractEnd, setContractEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    const msg = validateCandidate(draft) || (!clientId ? 'Chọn khách hàng' : !start ? 'Chọn ngày đi làm' : '');
    if (msg) { setError(msg); return; }
    setBusy(true);
    setError('');
    try {
      const r = await saveCandidate(cleanCandidate(draft));
      const id = r.candidate?.id ?? r.duplicate?.id;
      if (!id) throw new Error('Không lưu được hồ sơ');
      await createApplication({ candidate_id: id, client_id: clientId, employment_type: 'leasing', stage: 'started', start_date: start,
        contract_end: contractEnd || null });
      toast(r.duplicate ? `Đã có hồ sơ ${r.duplicate.full_name} — xếp vào làm` : 'Đã thêm người lao động');
      onDone();
      onClose();
    } catch (e) { setError(errText(e)); setBusy(false); }
  };
  return (
    <Sheet label="Thêm lao động thời vụ" onClose={onClose} wide="xl">
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Thêm lao động thời vụ</h2>
      <section className={`${sectionCls} mt-4`}>
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Khách hàng *">
            <select value={clientId} onChange={e => setClientId(e.target.value)} className={inputCls}>
              <option value="">— Chọn —</option>
              {clientOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Ngày đi làm *"><input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} /></Field>
          <Field label="HĐ thời vụ đến ngày"><input type="date" value={contractEnd} onChange={e => setContractEnd(e.target.value)} className={inputCls} /></Field>
        </div>
      </section>
      <div className="mt-3"><CandidateForm value={draft} onChange={setDraft} /></div>
      {error && <div className="mt-3"><ErrorBanner>{error}</ErrorBanner></div>}
      <div className={`${SHEET_FOOTER} mt-4 flex justify-end gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <button type="button" onClick={onClose} className={PILL_GRAY}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy} className={PILL_PRIMARY}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      </div>
    </Sheet>
  );
}
