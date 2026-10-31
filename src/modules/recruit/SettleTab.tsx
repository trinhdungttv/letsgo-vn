// Tab Đối soát: phí giới thiệu theo tháng (người đủ ngày tính phí) → bảng đối soát gửi khách → ghi doanh thu
// vào P&L Dự án; hoa hồng CTV phải trả.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Download, FileCheck2, HandCoins, Receipt, Trash2 } from 'lucide-react';
import { TINT } from '../../components/workspace/wsTheme';
import {
  createSettlement, deleteSettlement, errText, getSettlement, listCtv, listSettlements, payCtv, previewSettlement, setFeeAmount, updateSettlement,
} from '../../lib/recruit/api';
import { downloadXlsx } from '../../lib/recruit/exportXlsx';
import { pnlLineExists, pushSettlementToPnl } from '../../lib/recruit/pnlPush';
import { formatPhone } from '../../lib/recruit/normalize';
import { monthLabel } from '../../lib/recruit/plan';
import { STAGE_META } from '../../lib/recruit/stages';
import type { RecruitApplicationFull, RecruitSettlement } from '../../lib/recruit/types';
import { nameOf, useRecruit } from './context';
import { feeSummary } from './ProjectForm';
import {
  CAPTION, ErrorBanner, MoneyInput, PILL_GRAY, PILL_PRIMARY, PILL_TINTED, PageTitle, Panel, Quiet, SHEET_FOOTER, Sheet, Spinner,
  StageBadge, currentMonth, fmtDate, fmtNum,
} from './ui';

const STATUS: Record<RecruitSettlement['status'], { label: string; tint: keyof typeof TINT }> = {
  draft: { label: 'Nháp', tint: 'gray' },
  sent: { label: 'Đã gửi khách', tint: 'blue' },
  confirmed: { label: 'Khách đã xác nhận', tint: 'green' },
};

export default function SettleTab() {
  const { project, canEdit } = useRecruit();
  const [period, setPeriod] = useState(currentMonth());
  const [refresh, setRefresh] = useState(0);
  if (!project) return <Quiet>Chọn hoặc tạo dự án tuyển dụng trước.</Quiet>;
  const bump = () => setRefresh(n => n + 1);
  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle eyebrow="Đối soát" title="Phí giới thiệu & hoa hồng CTV"
        subtitle={`Điều khoản: ${feeSummary(project.fee)}`}
        actions={<input type="month" value={period} onChange={e => e.target.value && setPeriod(e.target.value)} aria-label="Tháng đối soát"
          className="h-10 md:h-9 px-3 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] outline-none" />} />
      {canEdit && <PendingPanel period={period} refresh={refresh} onCreated={bump} />}
      <SettlementsPanel refresh={refresh} onChanged={bump} />
      <CtvPanel refresh={refresh} />
    </div>
  );
}

// ── Chờ đối soát ───────────────────────────────────────────────────────────
function PendingPanel({ period, refresh, onCreated }: { period: string; refresh: number; onCreated: () => void }) {
  const { project, clients, sites, positions, toast } = useRecruit();
  const [rows, setRows] = useState<RecruitApplicationFull[] | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const projectId = project?.id;

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await previewSettlement(projectId, period);
      setRows(r);
      setSel(new Set(r.filter(x => x.fee_amount != null).map(x => x.id)));
      setError('');
    } catch (e) { setError(errText(e)); }
  }, [projectId, period]);
  useEffect(() => { load(); }, [load, refresh]);

  const groups = useMemo(() => {
    const m = new Map<string, RecruitApplicationFull[]>();
    for (const r of rows ?? []) {
      const k = r.bill_client_id ?? '';
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);

  const create = async (clientId: string, list: RecruitApplicationFull[]) => {
    if (!projectId) return;
    const ids = list.filter(r => sel.has(r.id) && r.fee_amount != null).map(r => r.id);
    if (!ids.length) { toast('Chưa chọn người nào có số tiền phí'); return; }
    setBusy(true);
    try {
      const st = await createSettlement(projectId, clientId || null, period, ids);
      toast(`Đã tạo bảng đối soát ${fmtNum(st.total_amount)}đ / ${st.line_count} người`);
      onCreated();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const saveAmount = async (id: string, v: number | null) => {
    try { await setFeeAmount(id, v); setRows(cur => cur?.map(r => (r.id === id ? { ...r, fee_amount: v } : r)) ?? null); }
    catch (e) { toast(errText(e)); }
  };

  return (
    <Panel title={`Chờ đối soát đến ${monthLabel(period)}`} icon={<Receipt size={16} className="text-[#B25000]" />}
      meta="Người đã đủ ngày tính phí (kể cả đã nghỉ sau mốc) chưa nằm trong bảng đối soát nào. Phí theo giờ/ngày: nhập số tiền theo bảng công của khách.">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!rows && !error && <div className="py-6 flex justify-center"><Spinner /></div>}
      {rows && rows.length === 0 && <Quiet>Không có ai chờ đối soát.</Quiet>}
      <div className="space-y-4 pb-3">
        {groups.map(([clientId, list]) => {
          const chosen = list.filter(r => sel.has(r.id));
          const total = chosen.reduce((s, r) => s + (r.fee_amount ?? 0), 0);
          return (
            <div key={clientId} className="rounded-[14px] bg-[#F5F5F7] p-3">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="text-[14px] font-semibold text-[#1D1D1F] flex-1 min-w-0 truncate">{nameOf(clients, clientId) || 'Chưa gắn thẻ khách hàng'}</h3>
                <span className="text-[13px] text-[#6E6E73] tabular-nums">{chosen.length} người · <b className="text-[#1D1D1F]">{fmtNum(total)}đ</b></span>
                <button type="button" onClick={() => create(clientId, list)} disabled={busy || !chosen.length} className={PILL_PRIMARY}><FileCheck2 size={14} /> Tạo bảng đối soát</button>
              </div>
              {!clientId && <p className="text-[12px] text-[#B25000] mb-1">Chưa gắn thẻ khách → không ghi được vào P&L. Gắn thẻ khách cho nhà máy / dự án ở tab Kế hoạch.</p>}
              {list.map(r => (
                <div key={r.id} className="flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-1 py-2 border-t border-black/[0.06] first:border-0">
                  <input type="checkbox" checked={sel.has(r.id)} disabled={r.fee_amount == null}
                    onChange={() => setSel(cur => { const n = new Set(cur); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                    aria-label={`Chọn ${r.candidate.full_name}`} className="w-4 h-4 accent-[#0071E3] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] text-[#1D1D1F] truncate">{r.candidate.full_name} <span className="text-[#86868B]">· {formatPhone(r.candidate.phone)}</span></div>
                    <div className="text-[12px] text-[#86868B] truncate">
                      {[nameOf(sites, r.site_id), positions.find(p => p.id === r.position_id)?.title, `đi làm ${fmtDate(r.start_date)}`, `đủ phí ${fmtDate(r.fee_date)}`,
                        r.stage === 'left' ? `đã nghỉ ${fmtDate(r.left_date)}` : '', r.replaces_id ? 'người thay (miễn phí)' : ''].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <FeeAmountEditor key={`${r.id}-${r.fee_amount}`} app={r} onSave={saveAmount} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Số tiền phí 1 người: trọn gói thì có sẵn (sửa được); theo giờ/ngày thì nhập theo bảng công của khách. */
function FeeAmountEditor({ app, onSave }: { app: RecruitApplicationFull; onSave: (id: string, v: number | null) => void }) {
  const [v, setV] = useState<number | null>(app.fee_amount ?? null);
  const dirty = v !== (app.fee_amount ?? null);
  return (
    <div className="flex items-center gap-1.5 shrink-0 ml-7 md:ml-0">
      <div className="w-[130px]"><MoneyInput value={v} onChange={setV} placeholder="Nhập phí" className="!py-1.5 text-right" /></div>
      {dirty && <button type="button" onClick={() => onSave(app.id, v)} className="h-8 px-3 rounded-full bg-[#0071E3] text-white text-[12px] font-semibold">Lưu</button>}
    </div>
  );
}

// ── Bảng đối soát ──────────────────────────────────────────────────────────
function SettlementsPanel({ refresh, onChanged }: { refresh: number; onChanged: () => void }) {
  const { project, clients } = useRecruit();
  const [list, setList] = useState<RecruitSettlement[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const projectId = project?.id;
  const load = useCallback(async () => {
    if (!projectId) return;
    try { setList(await listSettlements(projectId)); setError(''); } catch (e) { setError(errText(e)); }
  }, [projectId]);
  useEffect(() => { load(); }, [load, refresh]);
  const total = (list ?? []).reduce((s, x) => s + x.total_amount, 0);

  return (
    <Panel title="Bảng đối soát" count={list?.length} icon={<FileCheck2 size={16} className="text-[#0066CC]" />}
      meta={list?.length ? `Tổng ${fmtNum(total)}đ` : undefined}>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {list && list.length === 0 && <Quiet>Chưa có bảng đối soát nào.</Quiet>}
      <div className="pb-2">
        {list?.map((s, i) => (
          <button key={s.id} type="button" onClick={() => setOpen(s.id)}
            className={`w-full text-left flex items-center gap-3 py-2.5 hover:bg-[#FAFAFC] rounded-[10px] ${i ? 'border-t border-[#E5E5EA]' : ''}`}>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-[#1D1D1F] truncate">{monthLabel(s.period)} · {nameOf(clients, s.client_id) || 'Chưa gắn khách'}</div>
              <div className="text-[12px] text-[#86868B]">{s.line_count} người · tạo {fmtDate(s.created_at)}{s.pnl_line_id ? ' · đã ghi P&L' : ''}</div>
            </div>
            <span className={`text-[11.5px] px-2.5 py-0.5 rounded-full font-semibold ${TINT[STATUS[s.status].tint]}`}>{STATUS[s.status].label}</span>
            <span className="text-[14px] font-semibold tabular-nums text-[#1D1D1F] w-[110px] text-right">{fmtNum(s.total_amount)}đ</span>
          </button>
        ))}
      </div>
      {open && <SettlementSheet id={open} onClose={() => setOpen(null)} onChanged={() => { load(); onChanged(); }} />}
    </Panel>
  );
}

function SettlementSheet({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { project, clients, sites, positions, toast, canEdit } = useRecruit();
  const [data, setData] = useState<{ settlement: RecruitSettlement | null; rows: RecruitApplicationFull[] } | null>(null);
  const [lineGone, setLineGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const d = await getSettlement(id);
      setData(d);
      setLineGone(!!d.settlement?.pnl_line_id && !(await pnlLineExists(d.settlement.pnl_line_id)));
    } catch (e) { setError(errText(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const s = data?.settlement;
  if (!project) return null;

  const setStatus = async (status: RecruitSettlement['status']) => {
    if (!s) return;
    try { await updateSettlement(s.id, { status }); load(); onChanged(); } catch (e) { toast(errText(e)); }
  };
  const push = async () => {
    if (!s) return;
    setBusy(true);
    setError('');
    const r = await pushSettlementToPnl(s, project.name).catch(e => ({ ok: false as const, message: errText(e) }));
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    toast('Đã ghi doanh thu "Giới thiệu lao động" vào P&L Dự án');
    load(); onChanged();
  };
  const unlinkGone = async () => {
    if (!s) return;
    try { await updateSettlement(s.id, { pnl_id: null, pnl_line_id: null }); load(); onChanged(); } catch (e) { toast(errText(e)); }
  };
  const remove = async () => {
    if (!s || !confirm('Xoá bảng đối soát này? Các hồ sơ quay lại danh sách chờ đối soát.')) return;
    try { await deleteSettlement(s.id); onChanged(); onClose(); } catch (e) { setError(errText(e)); }
  };
  const exportXlsx = async () => {
    if (!s || !data) return;
    const client = nameOf(clients, s.client_id);
    await downloadXlsx(`Doi soat phi gioi thieu ${client || project.name} ${s.period}`, [{
      name: 'Đối soát',
      title: [`BẢNG ĐỐI SOÁT PHÍ GIỚI THIỆU LAO ĐỘNG — ${monthLabel(s.period)}`, `Khách hàng: ${client || '—'} · Dự án: ${project.name}`, `Điều khoản: ${feeSummary(project.fee)}`],
      headers: ['STT', 'Họ tên', 'Năm sinh', 'CCCD', 'Mã NV', 'Vị trí', 'Nhà máy', 'Ngày đi làm', 'Ngày đủ phí', 'Tình trạng', 'Phí (đ)'],
      rows: data.rows.map((r, i) => [i + 1, r.candidate.full_name, r.candidate.birth_year, r.candidate.id_number, r.employee_code,
        positions.find(p => p.id === r.position_id)?.title ?? '', nameOf(sites, r.site_id), fmtDate(r.start_date), fmtDate(r.fee_date),
        r.stage === 'left' ? `Đã nghỉ ${fmtDate(r.left_date)}` : r.replaces_id ? 'Người thay bảo hành' : 'Đang làm', r.fee_amount ?? 0]),
      total: ['', 'TỔNG CỘNG', '', '', '', '', '', '', '', `${data.rows.length} người`, s.total_amount],
      moneyCols: [10],
      widths: [6, 26, 10, 16, 12, 24, 12, 12, 12, 20, 14],
    }]);
  };

  return createPortal(
    <Sheet label="Bảng đối soát" onClose={onClose} wide="xl">
      {!data && !error && <div className="py-12 flex justify-center"><Spinner /></div>}
      {s && data && (
        <>
          <div className="pr-8">
            <h2 className="text-[22px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Đối soát {monthLabel(s.period)} · {fmtNum(s.total_amount)}đ</h2>
            <p className="text-[13px] text-[#6E6E73]">{nameOf(clients, s.client_id) || 'Chưa gắn khách'} · {s.line_count} người · <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${TINT[STATUS[s.status].tint]}`}>{STATUS[s.status].label}</span></p>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={exportXlsx} className={PILL_GRAY}><Download size={14} /> Xuất Excel gửi khách</button>
            {canEdit && s.status === 'draft' && <button type="button" onClick={() => setStatus('sent')} className={PILL_TINTED}>Đánh dấu đã gửi</button>}
            {canEdit && s.status !== 'confirmed' && <button type="button" onClick={() => setStatus('confirmed')} className={PILL_TINTED}><CheckCircle2 size={14} /> Khách đã xác nhận</button>}
            {canEdit && !s.pnl_line_id && <button type="button" onClick={push} disabled={busy} className={PILL_PRIMARY}>{busy ? 'Đang ghi…' : 'Ghi vào P&L Dự án'}</button>}
          </div>
          {s.pnl_line_id && !lineGone && <p className={`${CAPTION} mt-2`}>Đã ghi thành dòng doanh thu "Giới thiệu lao động" trong P&L tháng {monthLabel(s.period)} của khách.</p>}
          {lineGone && (
            <div className="mt-2 text-[12.5px] text-[#B25000]">
              Dòng doanh thu đã bị xoá ở Tài chính. {canEdit && <button type="button" onClick={unlinkGone} className="font-semibold text-[#0066CC]">Bỏ đánh dấu để ghi lại</button>}
            </div>
          )}
          {error && <div className="mt-3"><ErrorBanner>{error}</ErrorBanner></div>}
          <div className="mt-4 rounded-[14px] bg-white md:bg-[#F5F5F7] px-3">
            {data.rows.map((r, i) => (
              <div key={r.id} className={`flex items-center gap-3 py-2.5 ${i ? 'border-t border-[#E5E5EA]' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] text-[#1D1D1F] truncate">{r.candidate.full_name}{r.employee_code && <span className="text-[#86868B]"> · {r.employee_code}</span>}</div>
                  <div className="text-[12px] text-[#86868B] truncate">{[nameOf(sites, r.site_id), `đi làm ${fmtDate(r.start_date)}`, `đủ phí ${fmtDate(r.fee_date)}`].join(' · ')}</div>
                </div>
                <StageBadge stage={r.stage} />
                <span className="w-[100px] text-right tabular-nums text-[13.5px] font-semibold">{fmtNum(r.fee_amount ?? 0)}đ</span>
              </div>
            ))}
          </div>
          {canEdit && (
            <div className={`${SHEET_FOOTER} mt-4 flex justify-between gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
              <button type="button" onClick={remove} disabled={!!s.pnl_line_id && !lineGone} title={s.pnl_line_id ? 'Đã ghi P&L — xoá dòng ở Tài chính trước' : undefined}
                className={`${PILL_GRAY} text-[#D70015]`}><Trash2 size={14} /> Xoá bảng</button>
              <button type="button" onClick={onClose} className={PILL_GRAY}>Đóng</button>
            </div>
          )}
        </>
      )}
    </Sheet>,
    document.body,
  );
}

// ── Hoa hồng CTV ───────────────────────────────────────────────────────────
function CtvPanel({ refresh }: { refresh: number }) {
  const { project, toast, canEdit } = useRecruit();
  const [rows, setRows] = useState<RecruitApplicationFull[] | null>(null);
  const [error, setError] = useState('');
  const projectId = project?.id;
  const load = useCallback(async () => {
    if (!projectId) return;
    try { setRows(await listCtv(projectId)); setError(''); } catch (e) { setError(errText(e)); }
  }, [projectId]);
  useEffect(() => { load(); }, [load, refresh]);

  const groups = useMemo(() => {
    const m = new Map<string, RecruitApplicationFull[]>();
    for (const r of rows ?? []) {
      const k = r.candidate.referrer_contact_id ?? `${r.candidate.referrer_name}|${r.candidate.referrer_phone}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.values()].sort((a, b) => b.length - a.length);
  }, [rows]);

  const pay = async (list: RecruitApplicationFull[], paid: boolean) => {
    try {
      const r = await payCtv(list.map(x => x.id), paid);
      toast(paid ? `Đã đánh dấu trả ${r.updated} khoản` : 'Đã bỏ đánh dấu');
      load();
    } catch (e) { toast(errText(e)); }
  };
  const ctv = project?.ctv;
  const rule = ctv && ctv.value ? `${ctv.mode === 'pct_fee' ? `${ctv.value}% phí giới thiệu` : `${fmtNum(ctv.value)}đ/người`} khi người được giới thiệu ${ctv.milestone === 'started' ? 'đi làm' : 'đủ ngày tính phí'}` : 'Chưa đặt mức hoa hồng (tab Kế hoạch → Sửa dự án)';

  return (
    <Panel title="Hoa hồng CTV / người giới thiệu" icon={<HandCoins size={16} className="text-[#1E7B34]" />} meta={rule}>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {rows && rows.length === 0 && <Quiet>Chưa có khoản hoa hồng nào.</Quiet>}
      <div className="pb-2">
        {groups.map((list, i) => {
          const c = list[0].candidate;
          const unpaid = list.filter(x => !x.ctv_paid_at);
          const due = unpaid.reduce((s, x) => s + (x.ctv_amount ?? 0), 0);
          const all = list.reduce((s, x) => s + (x.ctv_amount ?? 0), 0);
          return (
            <details key={i} className={`py-2 ${i ? 'border-t border-[#E5E5EA]' : ''}`}>
              <summary className="flex items-center gap-3 cursor-pointer list-none">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-[#1D1D1F] truncate">{c.referrer_name || 'Không rõ tên'}{c.referrer_phone && <span className="text-[#86868B] font-normal"> · {formatPhone(c.referrer_phone)}</span>}</div>
                  <div className="text-[12px] text-[#86868B]">{list.length} người · tổng {fmtNum(all)}đ</div>
                </div>
                {due > 0
                  ? <span className={`text-[12px] px-2.5 py-0.5 rounded-full font-semibold ${TINT.orange}`}>Còn nợ {fmtNum(due)}đ</span>
                  : <span className={`text-[12px] px-2.5 py-0.5 rounded-full font-semibold ${TINT.green}`}>Đã trả đủ</span>}
                {canEdit && due > 0 && <button type="button" onClick={e => { e.preventDefault(); pay(unpaid, true); }} className={PILL_TINTED}>Đã trả</button>}
              </summary>
              <div className="mt-1 pl-1">
                {list.map(x => (
                  <div key={x.id} className="flex items-center gap-2 py-1 text-[12.5px]">
                    <span className="flex-1 min-w-0 truncate text-[#1D1D1F]">{x.candidate.full_name} <span className="text-[#86868B]">· {STAGE_META[x.stage].label}{x.start_date ? ` · đi làm ${fmtDate(x.start_date)}` : ''}</span></span>
                    <span className="tabular-nums">{fmtNum(x.ctv_amount ?? 0)}đ</span>
                    {x.ctv_paid_at
                      ? <button type="button" disabled={!canEdit} onClick={() => pay([x], false)} className="text-[#1E7B34] text-[11.5px]">đã trả {fmtDate(x.ctv_paid_at)}</button>
                      : <span className="text-[#B25000] text-[11.5px]">chưa trả</span>}
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </Panel>
  );
}
