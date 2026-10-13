// "Phương án giá" — lên phương án tính báo giá theo NGÀNH NGHỀ trước khi báo cho khách.
//
// Luồng: chọn khách ở CRM Pipeline (hoặc khách hàng) → ngành / KCN / chi nhánh / số LĐ tự điền → bảng chi phí
// khởi tạo theo ngành (BHXH, công đoàn, phép năm… tính bằng công thức) → chỉnh số, kéo tỷ lệ chia lợi nhuận →
// Lưu (lần sau cùng ngành/KCN sẽ được gợi ý) → Chia sẻ link ngắn + mã 4 số cho đồng nghiệp cùng xem/chỉnh.
//
// MỌI công thức ở src/lib/costPlan/engine.ts (có test). File này chỉ nối state ↔ DB ↔ giao diện.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Copy, Trash2, Share2, ChevronLeft, Link2, Search, Loader2, AlertTriangle, MoreHorizontal, MapPin, Store } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning';
import { fetchIndustries } from '../../pages/market/industries';
import { fetchMinWageBatches, fetchRegionWageRows, fetchRegionWages, type RegionZone } from '../../pages/market/regionWage';
import type { MinWageBatch } from '../../lib/minWage';
import { minWageTimelineNotes, planMinWage, todayIso as isoToday, withCurrentRows } from '../../lib/costPlan/minWageAt';
import { getBranchTypeForMonth } from '../../lib/format';
import { branchLabel } from '../../lib/branchRef';
import { newLineId as newQuoteLineId, normalizeQuoteInfo, type QuoteInfo, type QuoteInfoLine } from '../../lib/quoteInfo';
import { computePlan, newLineId, normalizePlanData, summarizePlan, DEFAULT_SETTINGS } from '../../lib/costPlan/engine';
import { starterLines } from '../../lib/costPlan/presets';
import { suggestLines } from '../../lib/costPlan/suggest';
import { deletePlan, deleteTemplate, listPlans, listTemplates, savePlan, saveTemplate, type PlanFields } from '../../lib/costPlan/api';
import { applyTemplate, linesForTemplate, templateKey, type IndustryTemplate } from '../../lib/costPlan/template';
import type { CostLine, CostPlanRow, PlanData, PlanRevision, SharedInfo } from '../../lib/costPlan/types';
import type { Branch, BranchTypeHistory, Client, CRMPipelineEntry } from '../../lib/types';
import { formatDate } from '../../lib/format';
import PlanEditor from './costplan/PlanEditor';
import { useScaleDefaults } from './costplan/useScaleDefaults';
import PlanContextBar from './costplan/PlanContextBar';
import SuggestionsPanel from './costplan/SuggestionsPanel';
import IndustryTemplateBar from './costplan/IndustryTemplateBar';
import SharePanel from './costplan/SharePanel';
import HistoryPanel from './costplan/HistoryPanel';
import { normalizeQuoteInfo as normQI } from '../../lib/quoteInfo';
import { dateShort, daysLeft, defaultDoc } from '../../lib/costPlan/quoteDoc';
import { effectiveResult } from '../../lib/costPlan/quoteSheet';
import { emptyMeta, resolveClient, resolvePipelineEntry, type PlanMeta } from './costplan/context';
import { fmt, fmtD, fmtShort } from './costplan/fields';
import { FONT, Popover, MenuItem, Seg, Select, btnGhost, btnPrimary, card, field } from './costplan/ui';
import type { LineSuggestion } from './costplan/CostSections';
import { isReferral, isReferralPlan } from '../../lib/costPlan/referral';
import { EMPTY_PLAN_FILTER, filterPlans, isFiltering, planBelongsTo, planFilterOptions, provinceOfPlan, zoneLabelOfPlan, type PlanListFilter } from '../../lib/costPlan/listFilter';

interface Props {
  clients: Client[];
  pipeline: CRMPipelineEntry[];
  branches: Branch[];
  toast: (msg: string) => void;
  onClose: () => void;
  /**
   * Mở từ hồ sơ 1 công ty (CRM Pipeline): chỉ liệt kê phương án của công ty đó, "Phương án mới" tự chọn sẵn công ty;
   * công ty chưa có phương án nào thì mở thẳng phương án mới.
   */
  focus?: { pipelineId: string; clientId?: string | null; companyName: string } | null;
  /** Báo danh sách phương án mỗi khi thay đổi (thêm/sửa/xoá) — để nơi mở cập nhật số đếm */
  onPlansChanged?: (plans: CostPlanRow[]) => void;
}

interface Zone { id: string; name: string; region_zone: string | null; location: string | null }

interface Draft {
  id: string | null;
  meta: PlanMeta;
  data: PlanData;
  version: number;
  share: SharedInfo | null;
  /** JSON của {meta,data} ở lần lưu/tải gần nhất — so với hiện tại để biết còn thay đổi chưa lưu */
  baseline: string;
  /** Người dùng đã tự sửa bảng chi phí → ngừng tự điền lại theo ngành/KCN */
  linesTouched: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

const STATUS_LABEL = { draft: 'Nháp', final: 'Đã chốt', archived: 'Lưu trữ' } as const;

const snapshot = (meta: PlanMeta, data: PlanData) => JSON.stringify({ meta, data });
const todayIso = () => new Date().toISOString().slice(0, 10);

function metaOfRow(p: CostPlanRow): PlanMeta {
  return {
    title: p.title, industry: p.industry ?? '', zone_name: p.zone_name ?? '', zone_id: p.zone_id,
    branch_id: p.branch_id, pipeline_id: p.pipeline_id, client_id: p.client_id,
    company_name: p.company_name ?? '', status: p.status,
  };
}

function draftOfRow(p: CostPlanRow): Draft {
  const meta = metaOfRow(p);
  const data = normalizePlanData(p.data);
  return {
    id: p.id, meta, data, version: p.version, share: p.share ?? null, baseline: snapshot(meta, data),
    linesTouched: true, updatedBy: p.updated_by_name, updatedAt: p.updated_at,
  };
}

export function CostPlanModal({ clients, pipeline, branches, toast, onClose, focus, onPlansChanged }: Props) {
  const { token } = useAuth();

  // ── Dữ liệu tham chiếu ─────────────────────────────────────────────────────────────────
  const [plans, setPlans] = useState<CostPlanRow[]>([]);
  const [templates, setTemplates] = useState<IndustryTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [industries, setIndustries] = useState<string[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [regionWages, setRegionWages] = useState<Record<RegionZone, number> | null>(null);
  // Các lần tăng lương tối thiểu vùng (Thị trường → Lương TT) — tra mức theo NGÀY BAN HÀNH báo giá
  const [wageBatches, setWageBatches] = useState<MinWageBatch[] | null>(null);

  const reload = useCallback(async () => {
    if (!token) { setLoadErr('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.'); setLoading(false); return; }
    listTemplates(token).then(setTemplates);
    try { setPlans(await listPlans(token)); setLoadErr(null); }
    catch (e) { setLoadErr(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    reload();
    fetchIndustries().then(setIndustries);
    fetchRegionWages().then(setRegionWages);
    Promise.all([fetchMinWageBatches(), fetchRegionWageRows()])
      .then(([b, rows]) => setWageBatches(withCurrentRows(b, rows)))
      .catch(() => setWageBatches([]));
    supabase.from('market_zones').select('id, name, region_zone, location').order('name').then(({ data }) => { if (data) setZones(data as Zone[]); });
  }, [reload]);

  // ── Màn hình ───────────────────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<Draft | null>(null);   // null = đang ở danh sách
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [showShare, setShowShare] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conflict, setConflict] = useState<CostPlanRow | null>(null);
  const [remote, setRemote] = useState<CostPlanRow | null>(null);   // bản mới do người khác sửa qua link
  const [picking, setPicking] = useState(false);
  const [crmLines, setCrmLines] = useState<QuoteInfoLine[]>([]);
  const [branchKhoan, setBranchKhoan] = useState<{ lgPct: number; cnPct: number; label: string } | null>(null);

  // Đang xem phương án của 1 công ty (mở từ CRM Pipeline) — bấm "Xem tất cả" để bỏ
  const [focusOn, setFocusOn] = useState(!!focus);
  const fPid = focus?.pipelineId, fCid = focus?.clientId, fName = focus?.companyName;
  useEffect(() => { if (!loading && !loadErr) onPlansChanged?.(plans); }, [plans, loading, loadErr, onPlansChanged]);

  // Bộ lọc danh sách: chữ, ngành, tỉnh/TP (suy từ KCN), KCN, chi nhánh, trạng thái
  const [filter, setFilter] = useState<PlanListFilter>(EMPTY_PLAN_FILTER);
  const setF = (p: Partial<PlanListFilter>) => setFilter(f => ({ ...f, ...p }));

  // Quy mô chuẩn dùng chung (số người × số công) — phương án mới bắt đầu bằng số này
  const scaleDefaults = useScaleDefaults();

  const dirty = !!draft && snapshot(draft.meta, draft.data) !== draft.baseline;
  useBeforeUnloadWarning(dirty);

  // ── Tính toán ──────────────────────────────────────────────────────────────────────────
  const zoneOf = useCallback((name: string) => zones.find(z => z.name === name) ?? null, [zones]);
  /** Lương tối thiểu vùng của KCN tại 1 ngày (mặc định hôm nay). Chưa tải xong các mốc thì tạm dùng mức hiện hành. */
  const minWageOf = useCallback((zoneName: string, atDate: string = isoToday()): { monthly: number; label: string; effectiveFrom?: string; decree?: string } | null => {
    const r = zoneOf(zoneName)?.region_zone as RegionZone | undefined;
    if (!r) return null;
    if (wageBatches) return planMinWage(r, atDate, wageBatches);
    if (!regionWages || !regionWages[r]) return null;
    return { monthly: regionWages[r], label: `Vùng ${r}` };
  }, [zoneOf, regionWages, wageBatches]);

  // Báo giá ban hành ngày nào → lương tối thiểu (lương CB tối thiểu, BHXH theo vùng…) lấy đúng mức hiệu lực ngày đó
  const issueDate = draft?.data.doc?.date || isoToday();
  const validUntil = draft?.data.doc?.validUntil ?? '';
  const zoneName = draft?.meta.zone_name ?? '';
  const minWage = useMemo(() => (draft ? minWageOf(zoneName, issueDate) : null), [draft, minWageOf, zoneName, issueDate]);
  const result = useMemo(() => {
    if (!draft) return null;
    const r = computePlan(draft.data, { minWageMonthly: minWage?.monthly, minWageLabel: minWage?.label });
    const region = zoneOf(zoneName)?.region_zone;
    const notes = wageBatches && !draft.data.service ? minWageTimelineNotes(region, issueDate, validUntil, wageBatches) : [];
    return notes.length ? { ...r, warnings: [...notes, ...r.warnings] } : r;
  }, [draft, minWage, zoneOf, zoneName, wageBatches, issueDate, validUntil]);

  const baseWageMonthly = useMemo(() => {
    if (!draft || !result) return 0;
    return draft.data.lines.filter(l => l.isBaseWage).reduce((s, l) => s + (result.lines[l.id]?.monthly ?? 0), 0);
  }, [draft, result]);

  // Khoán hiện hành của chi nhánh → gợi ý tỷ lệ chia mặc định (Công ty = LG, Chi nhánh = CN)
  const branchId = draft?.meta.branch_id ?? null;
  useEffect(() => {
    if (!branchId) { setBranchKhoan(null); return; }
    let alive = true;
    supabase.from('branch_type_history').select('*').eq('branch_id', branchId).then(({ data }) => {
      if (!alive) return;
      const cur = getBranchTypeForMonth((data ?? []) as BranchTypeHistory[], todayIso());
      if (!cur) { setBranchKhoan(null); return; }
      if (cur.type === 'company') setBranchKhoan({ lgPct: 100, cnPct: 0, label: 'Chi nhánh đang do công ty vận hành (không khoán)' });
      else if (cur.lgPct + cur.cnPct !== 100) setBranchKhoan(null);   // chưa nhập khoán (0/0) → không gợi ý
      else setBranchKhoan({ lgPct: cur.lgPct, cnPct: cur.cnPct, label: `Khoán hiện hành của chi nhánh: công ty ${cur.lgPct}% / chi nhánh ${cur.cnPct}%` });
    });
    return () => { alive = false; };
  }, [branchId]);

  // Có người sửa qua link khi mình đang mở → báo (không tự ghi đè nội dung đang gõ)
  const versionRef = useRef(0);
  versionRef.current = draft?.version ?? 0;
  const watchId = draft?.id ?? null;
  const watching = !!watchId && !!draft?.share && !draft.share.revoked;
  useEffect(() => {
    if (!watching || !token || !watchId) return;
    const t = setInterval(async () => {
      try {
        const list = await listPlans(token);
        const p = list.find(x => x.id === watchId);
        if (p && p.version > versionRef.current) setRemote(p);
        setPlans(list);
      } catch { /* mạng chập chờn — lần sau thử lại */ }
    }, 20000);
    return () => clearInterval(t);
  }, [watching, token, watchId]);

  // ── Tạo / mở / nhân bản / xoá ──────────────────────────────────────────────────────────
  const templateOf = useCallback((industry: string) => (industry ? templates.find(t => templateKey(t.industry) === templateKey(industry)) ?? null : null), [templates]);

  // Bảng khởi tạo: ngành có MẪU riêng thì theo mẫu; chưa có thì dùng bộ gợi ý chung (presets)
  const starterFor = useCallback((industry: string, zone: string): CostLine[] => {
    const baseWageMonthly = minWageOf(zone)?.monthly ?? regionWages?.II ?? 4_730_000;
    const tpl = templateOf(industry);
    return tpl ? applyTemplate(tpl, { baseWageMonthly }) : starterLines(industry, { baseWageMonthly });
  }, [minWageOf, regionWages, templateOf]);

  const openNew = () => {
    const meta = emptyMeta();
    const sc = scaleDefaults.defaults.supply;
    // Phương án mới: BHXH đóng theo lương tối thiểu vùng của KCN (đa số dự án) — dự án cho phép thì đổi sang mức cao hơn
    const data: PlanData = { settings: { ...DEFAULT_SETTINGS, workers: sc.workers, simDays: sc.simDays, insuranceBase: 'region' }, lines: starterFor('', ''), notes: '' };
    setDraft({ id: null, meta, data, version: 0, share: null, baseline: snapshot(meta, data), linesTouched: false, updatedBy: null, updatedAt: null });
    setCrmLines([]); setRemote(null); setSaveNote('');
    // Mở từ hồ sơ công ty → chọn sẵn công ty đó (tự điền ngành, KCN, chi nhánh, số LĐ từ CRM)
    if (focusOn && focus && pipeline.some(p => p.id === focus.pipelineId)) void pickCompany(`crm:${focus.pipelineId}`);
  };

  const openPlan = (p: CostPlanRow) => { setDraft(draftOfRow(p)); setCrmLines([]); setRemote(null); setSaveNote(''); };

  const duplicate = (p: { meta: PlanMeta; data: PlanData }) => {
    const data: PlanData = { ...p.data, lines: p.data.lines.map(l => ({ ...l, id: newLineId() })) };
    const meta: PlanMeta = { ...p.meta, title: `${p.meta.title || 'Phương án'} (bản sao)`, status: 'draft' };
    setDraft({ id: null, meta, data, version: 0, share: null, baseline: '', linesTouched: true, updatedBy: null, updatedAt: null });
    setCrmLines([]); setRemote(null); setSaveNote('');
    toast('Đã nhân bản — chỉnh rồi bấm Lưu để tạo phương án mới');
  };

  const removePlan = async (p: CostPlanRow) => {
    if (!token) return;
    const shared = p.share && !p.share.revoked ? '\nLink chia sẻ của phương án này cũng sẽ ngừng hoạt động.' : '';
    if (!window.confirm(`Xoá phương án "${p.title}"?${shared}\nKhông khôi phục được.`)) return;
    try {
      await deletePlan(token, p.id);
      setPlans(prev => prev.filter(x => x.id !== p.id));
      if (draft?.id === p.id) setDraft(null);
      toast('Đã xoá phương án');
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };

  const closeEditor = () => {
    if (dirty && !window.confirm('Còn thay đổi chưa lưu. Rời đi sẽ mất các thay đổi đó — vẫn thoát?')) return;
    setDraft(null); setRemote(null); setConflict(null);
  };
  const closeModal = () => {
    if (dirty && !window.confirm('Còn thay đổi chưa lưu. Đóng sẽ mất các thay đổi đó — vẫn đóng?')) return;
    onClose();
  };

  // ── Sửa phương án ──────────────────────────────────────────────────────────────────────
  const setData = (next: PlanData) => setDraft(d => (d ? { ...d, data: next, linesTouched: d.linesTouched || next.lines !== d.data.lines } : d));

  const patchMeta = (p: Partial<PlanMeta>, workers?: number | null) => setDraft(d => {
    if (!d) return d;
    const meta = { ...d.meta, ...p };
    if (p.zone_name !== undefined) meta.zone_id = zoneOf(p.zone_name)?.id ?? null;
    let data = d.data;
    // Chưa tự sửa bảng thì tự điền lại theo ngành/KCN mới — sửa rồi thì giữ nguyên, chỉ cập nhật gợi ý
    if (!d.linesTouched && (p.industry !== undefined || p.zone_name !== undefined)) {
      data = { ...data, lines: starterFor(meta.industry, meta.zone_name) };
    }
    if (workers && workers > 0) data = { ...data, settings: { ...data.settings, workers } };
    return { ...d, meta, data };
  });

  const pickCompany = async (value: string) => {
    const [kind, id] = value.split(':');
    setPicking(true);
    try {
      if (kind === 'crm') {
        const entry = pipeline.find(p => p.id === id);
        if (!entry) return;
        const r = await resolvePipelineEntry(entry, branches);
        // Không lấy số LĐ dự kiến của khách làm quy mô — mọi phương án dùng chung quy mô chuẩn để so được với nhau
        patchMeta({ ...r.meta, title: draft?.meta.title || `${entry.company_name}${r.meta.industry ? ` — ${r.meta.industry}` : ''}` });
        setCrmLines(r.quoteLines);
        toast(r.found.length ? `Đã lấy từ hồ sơ CRM: ${r.found.join(', ')}` : 'Hồ sơ CRM chưa có ngành / KCN — chọn tay bên cạnh');
      } else {
        const c = clients.find(x => x.id === id);
        if (!c) return;
        const r = resolveClient(c, branches);
        patchMeta({ ...r.meta, title: draft?.meta.title || `${c.name}${r.meta.industry ? ` — ${r.meta.industry}` : ''}` });
        setCrmLines([]);
        toast(r.found.length ? `Đã lấy từ hồ sơ khách hàng: ${r.found.join(', ')}` : 'Khách hàng này chưa có ngành / KCN — chọn tay bên cạnh');
      }
    } finally { setPicking(false); }
  };

  /** Nạp đơn giá đã điền ở "Thông tin báo giá" (CRM): lương → Lương cơ bản, phí → Phí DV. */
  const applyCrmLine = (l: QuoteInfoLine) => {
    if (!draft) return;
    const toDaily = (v: number) => (l.unit === 'giờ' ? v * 8 : l.unit === 'tháng' ? v : v);
    const unit: 'day' | 'month' = l.unit === 'tháng' ? 'month' : 'day';
    const lines = draft.data.lines.map(x => {
      if (x.isBaseWage && (l.wage ?? 0) > 0) return { ...x, mode: 'fixed' as const, unit, value: Math.round(toDaily(l.wage ?? 0)) };
      if (x.isServiceFee && (l.fee ?? 0) > 0) return { ...x, mode: 'fixed' as const, unit, value: Math.round(toDaily(l.fee ?? 0)) };
      return x;
    });
    setData({ ...draft.data, lines });
    toast(`Đã nạp đơn giá "${l.label || 'dòng'}" từ hồ sơ CRM`);
  };

  const setBaseToMinWage = () => {
    if (!draft || !minWage) return;
    setData({ ...draft.data, lines: draft.data.lines.map(l => (l.isBaseWage ? { ...l, mode: 'fixed' as const, unit: 'month' as const, value: minWage.monthly } : l)) });
  };

  const useTemplate = (p: CostPlanRow) => {
    if (!draft) return;
    if (draft.linesTouched && !window.confirm(`Dùng "${p.title}" làm mẫu sẽ thay toàn bộ bảng chi phí hiện tại. Tiếp tục?`)) return;
    const t = normalizePlanData(p.data);
    setData({
      ...draft.data,
      settings: { ...t.settings, workers: draft.data.settings.workers },
      lines: t.lines.map(l => ({ ...l, id: newLineId() })),
    });
    toast(`Đã lấy bảng chi phí của "${p.title}" làm mẫu`);
  };

  // Khoản mục các phương án cũ cùng ngành hay dùng — đưa vào menu "Thêm khoản" của từng nhóm
  const historySuggestions = useMemo<LineSuggestion[]>(() => {
    if (!draft) return [];
    return suggestLines(plans, { industry: draft.meta.industry, zone: draft.meta.zone_name, excludeId: draft.id, currentLines: draft.data.lines }, 12)
      .map(s => ({ line: s.line, hint: `${s.avgDaily > 0 ? `${fmt(s.avgDaily)}/công · ` : ''}${s.count} PA` }));
  }, [plans, draft]);

  // ── Mẫu ngành ──
  const draftTemplate = draft ? templateOf(draft.meta.industry) : null;
  const saveIndustryTemplate = async () => {
    if (!draft || !token || !draft.meta.industry) return;
    const lines = linesForTemplate(draft.data.lines);
    const msg = draftTemplate
      ? `Cập nhật mẫu ngành "${draft.meta.industry}" thành bảng hiện tại (${lines.length} khoản, không gồm phí dịch vụ)?\nMẫu cũ có ${draftTemplate.lines.length} khoản sẽ bị thay. Phương án đã lưu không đổi.`
      : `Lưu bảng hiện tại (${lines.length} khoản, không gồm phí dịch vụ) làm mẫu cho ngành "${draft.meta.industry}"?\nPhương án mới của ngành này sẽ tự điền theo mẫu. Phương án đã lưu không đổi.`;
    if (!window.confirm(msg)) return;
    try {
      const t = await saveTemplate(token, draft.meta.industry, lines);
      setTemplates(prev => [...prev.filter(x => templateKey(x.industry) !== templateKey(t.industry)), t]);
      toast(`Đã lưu mẫu ngành ${draft.meta.industry}`);
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };
  const applyIndustryTemplate = () => {
    if (!draft || !draftTemplate) return;
    if (draft.linesTouched && !window.confirm(`Áp mẫu ngành "${draft.meta.industry}" sẽ thay toàn bộ bảng chi phí hiện tại (kể cả phí dịch vụ). Tiếp tục?`)) return;
    setData({ ...draft.data, lines: applyTemplate(draftTemplate, { baseWageMonthly: minWage?.monthly ?? regionWages?.II ?? 4_730_000 }) });
    toast('Đã áp mẫu ngành vào bảng');
  };
  const deleteIndustryTemplate = async () => {
    if (!draft || !token || !draftTemplate) return;
    if (!window.confirm(`Xoá mẫu ngành "${draft.meta.industry}"? Phương án mới của ngành này sẽ quay về bộ gợi ý chung. Phương án đã lưu không đổi.`)) return;
    try {
      await deleteTemplate(token, draftTemplate.industry);
      setTemplates(prev => prev.filter(x => x.industry !== draftTemplate.industry));
      toast('Đã xoá mẫu ngành');
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };

  const restoreRevision = (rev: PlanRevision) => {
    if (!draft) return;
    setData(normalizePlanData(rev.data));
    setShowHistory(false);
    toast(`Đã nạp lại bản v${rev.version} — bấm Lưu để giữ`);
  };

  // ── Lưu ────────────────────────────────────────────────────────────────────────────────
  /**
   * Lưu phương án. `metaPatch`: đổi trạng thái (Chốt / Lưu trữ…) rồi LƯU LUÔN — trước đây chỉ đổi trên màn hình,
   * người dùng tưởng đã chốt, đóng lại thì mất.
   */
  const doSave = async (force = false, metaPatch?: Partial<PlanMeta>, okMsg = 'Đã lưu phương án') => {
    if (!draft || !token || !result) return;
    // Ghi vào bản nháp trước: nếu vướng xung đột phiên bản thì lần "Ghi đè" sau vẫn giữ trạng thái mới
    if (metaPatch) setDraft(d => (d ? { ...d, meta: { ...d.meta, ...metaPatch } } : d));
    setSaving(true);
    try {
      const meta = { ...draft.meta, ...metaPatch };
      if (!meta.title.trim()) meta.title = `${meta.company_name || meta.industry || 'Phương án'} — ${new Date().toLocaleDateString('vi-VN')}`;
      // Kèm ảnh chụp lương tối thiểu vùng để người xem qua link cũng thấy cảnh báo lương thấp.
      // Chưa từng mở phần báo giá → chốt số báo giá, ngày ban hành (hôm nay), hiệu lực mặc định ngay lần lưu đầu.
      const data: PlanData = {
        ...draft.data, minWage: minWage ?? null,
        doc: draft.data.doc ?? defaultDoc(new Date(), { ...docDefaults, name: docDefaults.name || meta.company_name || '' }),
      };
      const fields: PlanFields = {
        ...meta, industry: meta.industry || null, zone_name: meta.zone_name || null, company_name: meta.company_name || null,
        // Lưu theo giá đang báo khách (giá ca 8h ghi tay ở Bảng giá, nếu có) — danh sách hiện đúng giá đã gửi
        data, summary: summarizePlan(data, effectiveResult(data, result)),
      };
      const r = await savePlan(token, draft.id, fields, { expectedVersion: draft.id ? draft.version : null, force, note: saveNote.trim() || undefined });
      if (!r.ok) { setConflict(r.plan); return; }
      const row = r.plan;
      const next = { ...draft, id: row.id, meta, data, version: row.version, baseline: snapshot(meta, data), updatedBy: row.updated_by_name, updatedAt: row.updated_at };
      setDraft(next);
      setPlans(prev => [{ ...row, share: draft.share }, ...prev.filter(x => x.id !== row.id)]);
      setSaveNote(''); setConflict(null); setRemote(null);
      toast(okMsg);
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const loadRemote = (p: CostPlanRow) => {
    if (dirty && !window.confirm('Tải bản mới sẽ bỏ các thay đổi chưa lưu của bạn. Tiếp tục?')) return;
    setDraft(d => ({ ...draftOfRow(p), share: p.share ?? d?.share ?? null }));
    setRemote(null); setConflict(null);
  };

  const toggleFinal = () => {
    if (!draft) return;
    const status = draft.meta.status === 'final' ? 'draft' : 'final';
    void doSave(false, { status }, status === 'final' ? 'Đã chốt và lưu phương án' : 'Đã bỏ chốt — phương án về Nháp');
  };
  const toggleArchive = () => {
    if (!draft) return;
    const status = draft.meta.status === 'archived' ? 'draft' : 'archived';
    void doSave(false, { status }, status === 'archived' ? 'Đã lưu trữ phương án' : 'Đã bỏ lưu trữ');
  };

  // ── Đẩy kết quả sang "Thông tin báo giá" của hồ sơ CRM ─────────────────────────────────
  const pushToCrm = async () => {
    if (!draft?.id || !draft.meta.pipeline_id || !result) return;
    if (dirty) { toast('Hãy Lưu phương án trước khi đưa sang hồ sơ CRM để số khớp nhau'); return; }
    const { data: row, error } = await supabase.from('crm_pipeline').select('quote_info').eq('id', draft.meta.pipeline_id).maybeSingle();
    if (error) { toast(/quote_info/.test(error.message) ? 'Hồ sơ CRM chưa có cột "Thông tin báo giá" (migration 156 chưa chạy)' : error.message); return; }
    const qi = normalizeQuoteInfo((row as { quote_info: unknown } | null)?.quote_info);
    const marker = `[PA:${draft.id}]`;
    const existing = qi.lines.find(l => l.note.includes(marker));
    const line: QuoteInfoLine = {
      id: existing?.id ?? newQuoteLineId(),
      label: draft.meta.title || 'Phương án giá',
      workers: String(draft.data.settings.workers),
      // Chi phí trong giá ngày (bảo hiểm thu riêng theo tháng nằm ngoài) + phần còn lại của giá đang báo → cộng lại đúng bằng giá báo
      wage: Math.round(result.costDaily - result.separatedDaily),
      fee: Math.round(effectiveResult(draft.data, result).quoteDaily - (result.costDaily - result.separatedDaily)),
      unit: 'ngày công',
      note: `${marker} Phương án giá v${draft.version}`,
    };
    const msg = `${existing ? 'Cập nhật' : 'Thêm'} dòng vào "Thông tin báo giá" của ${draft.meta.company_name || 'khách'}:\n` +
      `• Chi phí lao động: ${fmtD(line.wage ?? 0)}/công\n• Phí DV (+thuế dự phòng): ${fmtD(line.fee ?? 0)}/công\n• Giá báo: ${fmtD(effectiveResult(draft.data, result).quoteDaily)}/công · ${line.workers} LĐ`;
    if (!window.confirm(msg)) return;
    const lines = existing ? qi.lines.map(l => (l.id === existing.id ? line : l)) : [...qi.lines, line];
    const payload: QuoteInfo = {
      ...qi, lines, industry: qi.industry || draft.meta.industry, zone: qi.zone || draft.meta.zone_name, updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await supabase.from('crm_pipeline').update({ quote_info: payload }).eq('id', draft.meta.pipeline_id);
    toast(upErr ? upErr.message : 'Đã đưa vào "Thông tin báo giá" của hồ sơ CRM — mở lại hồ sơ để thấy');
  };

  // ── Danh sách ──────────────────────────────────────────────────────────────────────────
  const companyPlans = useMemo(
    () => (fPid ? plans.filter(p => planBelongsTo(p, { pipelineId: fPid, clientId: fCid, companyName: fName })) : plans),
    [plans, fPid, fCid, fName]);
  const listBase = focusOn ? companyPlans : plans;
  const shown = useMemo(() => filterPlans(listBase, filter, zones, branches), [listBase, filter, zones, branches]);
  // Công ty chưa có phương án nào → vào thẳng phương án mới (chỉ 1 lần khi vừa mở)
  const autoNewDone = useRef(false);
  useEffect(() => {
    if (loading || autoNewDone.current || !focus) return;
    autoNewDone.current = true;
    if (!loadErr && companyPlans.length === 0) openNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy 1 lần ngay khi danh sách vừa tải xong
  }, [loading]);
  const filterOpts = useMemo(() => planFilterOptions(plans, filter, zones, branches), [plans, filter, zones, branches]);
  // Đổi tỉnh mà KCN đang chọn không thuộc tỉnh đó → bỏ chọn KCN để không ra danh sách rỗng khó hiểu
  const pickProvince = (province: string) => setFilter(f => {
    const zoneStillFits = !f.zone || !province || plans.some(p => zoneLabelOfPlan(p, zones) === f.zone && provinceOfPlan(p, zones) === province);
    return { ...f, province, zone: zoneStillFits ? f.zone : '' };
  });

  // Thông tin khách lấy sẵn từ "Thông tin báo giá" của hồ sơ CRM để điền vào báo giá PDF
  const docDefaults = useMemo(() => {
    const e = draft?.meta.pipeline_id ? pipeline.find(p => p.id === draft.meta.pipeline_id) : null;
    const qi = e ? normQI(e.quote_info) : null;
    return {
      name: draft?.meta.company_name ?? '', address: qi?.address, taxCode: qi?.tax_code, attn: qi?.contact_person, phone: qi?.contact_phone,
      validUntil: qi?.valid_until || undefined, payment: qi?.payment_terms,
    };
  }, [draft?.meta.pipeline_id, draft?.meta.company_name, pipeline]);

  const branch = draft?.meta.branch_id ? branches.find(b => b.id === draft.meta.branch_id) ?? null : null;

  // ═════════════════════════════════════ RENDER ═════════════════════════════════════
  const shared = !!draft?.share && !draft.share.revoked;
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50 p-2 sm:p-5" style={{ fontFamily: FONT }}>
      <div className="bg-[#f5f5f7] rounded-[20px] shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-[1240px] h-[94vh] flex flex-col overflow-hidden text-[#1d1d1f]">

        {/* ── Thanh trên ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 min-h-[60px] py-2 bg-white/85 backdrop-blur border-b border-black/[0.06] shrink-0">
          {draft && (
            <button onClick={closeEditor} className="-ml-2 w-8 h-8 rounded-full flex items-center justify-center text-[#0071e3] hover:bg-[#f5f5f7]" title="Về danh sách"><ChevronLeft size={20} /></button>
          )}
          <div className={`min-w-0 flex-1 ${draft ? 'order-last basis-full sm:order-none sm:basis-0' : ''}`}>
            {draft ? (
              <>
                <input value={draft.meta.title} onChange={e => patchMeta({ title: e.target.value })} placeholder="Đặt tên phương án"
                  className="w-full text-[17px] font-semibold tracking-tight bg-transparent outline-none placeholder:text-[#a1a1a6]" />
                <div className="flex items-center gap-2 text-[12px] text-[#86868b] min-h-[20px]">
                  <span className={`px-1.5 rounded text-[10.5px] font-semibold ${draft.meta.status === 'final' ? 'bg-[#e8f8ed] text-[#1d8a3b]' : draft.meta.status === 'archived' ? 'bg-[#f0f0f2] text-[#6e6e73]' : 'bg-[#f0f0f2] text-[#6e6e73]'}`}>{STATUS_LABEL[draft.meta.status]}</span>
                  {dirty ? (
                    <input value={saveNote} onChange={e => setSaveNote(e.target.value)} placeholder="Ghi chú cho lần lưu này (tuỳ chọn)…" maxLength={200}
                      className="flex-1 min-w-0 max-w-sm bg-transparent outline-none text-[12px] text-[#1d1d1f] placeholder:text-[#a1a1a6] border-b border-[#e5e5ea] focus:border-[#0071e3]" />
                  ) : (
                    <span className="truncate">{draft.id ? <>v{draft.version} · {draft.updatedBy ?? '—'} · {draft.updatedAt ? `${formatDate(draft.updatedAt)} ${new Date(draft.updatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : ''}</> : 'Chưa lưu'}</span>
                  )}
                </div>
              </>
            ) : (
              <>
                <h2 className="text-[20px] font-semibold tracking-tight">Phương án giá</h2>
                <div className="text-[12px] text-[#86868b]">Lên phương án báo giá theo ngành, lưu lại để gợi ý cho lần sau</div>
              </>
            )}
          </div>

          {draft && (
            <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
              <button onClick={() => (draft.id ? setShowShare(true) : toast('Hãy Lưu phương án trước khi chia sẻ'))} className={`${btnGhost} ${shared ? '!bg-[#e8f8ed] !text-[#1d8a3b]' : ''}`}>
                <Share2 size={14} /><span className="hidden sm:inline">{shared ? 'Đang chia sẻ' : 'Chia sẻ'}</span>
              </button>
              <button onClick={() => doSave(false)} disabled={saving || (!dirty && !!draft.id)} className={btnPrimary}>
                {saving && <Loader2 size={13} className="animate-spin" />}Lưu
              </button>
              <Popover width="w-60" button={({ toggle }) => (
                <button onClick={toggle} className="w-8 h-8 rounded-full flex items-center justify-center text-[#1d1d1f] hover:bg-[#f5f5f7]" title="Thêm"><MoreHorizontal size={18} /></button>
              )}>
                {close => (
                  <div className="py-1">
                    <MenuItem onClick={() => { toggleFinal(); close(); }}>{draft.meta.status === 'final' ? 'Bỏ đánh dấu đã chốt' : 'Chốt phương án'}</MenuItem>
                    {draft.id && <MenuItem onClick={() => { setShowHistory(true); close(); }}>Lịch sử chỉnh sửa</MenuItem>}
                    <MenuItem onClick={() => { duplicate(draft); close(); }}>Nhân bản</MenuItem>
                    {draft.meta.pipeline_id && draft.id && !isReferral(draft.data) && <MenuItem onClick={() => { pushToCrm(); close(); }}>Đưa vào hồ sơ CRM</MenuItem>}
                    <MenuItem onClick={() => { toggleArchive(); close(); }}>{draft.meta.status === 'archived' ? 'Bỏ lưu trữ' : 'Lưu trữ'}</MenuItem>
                  </div>
                )}
              </Popover>
            </div>
          )}
          <button onClick={closeModal} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7]" title="Đóng"><X size={17} /></button>
        </div>

        {/* ── Thân ── */}
        <div className="flex-1 overflow-y-auto">
          {!draft ? (
            // ───────────── DANH SÁCH ─────────────
            <div className="p-5 sm:p-6 space-y-5 max-w-[1100px] mx-auto">
              {focus && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[#eef5ff] px-4 py-2.5 text-[13px] text-[#0b5cc4]">
                  {focusOn ? (
                    <>
                      <span>Phương án của <b>{focus.companyName}</b> · {companyPlans.length} phương án{companyPlans.length ? '' : ' — bấm “Phương án mới” để lập'}</span>
                      <button onClick={() => setFocusOn(false)} className="ml-auto font-semibold hover:underline">Xem tất cả phương án</button>
                    </>
                  ) : (
                    <>
                      <span>Đang xem tất cả phương án</span>
                      <button onClick={() => setFocusOn(true)} className="ml-auto font-semibold hover:underline">Chỉ xem của {focus.companyName}</button>
                    </>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2.5">
                <button onClick={openNew} className={`${btnPrimary} !h-9 !px-4`}><Plus size={15} />Phương án mới</button>
                <div className="relative flex-1 min-w-[180px] max-w-xs">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
                  <input value={filter.q} onChange={e => setF({ q: e.target.value })} placeholder="Tìm theo tên, khách, KCN, tỉnh, chi nhánh" className={`${field} !bg-white w-full pl-9 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]`} />
                </div>
                <div className="w-full sm:w-[300px]">
                  <Seg value={filter.status} onChange={v => setF({ status: v })} options={[{ value: '', label: 'Đang dùng' }, { value: 'draft', label: 'Nháp' }, { value: 'final', label: 'Đã chốt' }, { value: 'archived', label: 'Lưu trữ' }]} />
                </div>
              </div>

              {/* Lọc theo ngành / tỉnh / KCN / chi nhánh — chỉ liệt kê giá trị đang có trong các phương án, kèm số lượng */}
              <div className="flex flex-wrap items-center gap-2 -mt-2">
                {([
                  { key: 'industry', all: 'Mọi ngành', opts: filterOpts.industries, w: 'sm:w-44', on: (v: string) => setF({ industry: v }) },
                  { key: 'province', all: 'Mọi tỉnh / TP', opts: filterOpts.provinces, w: 'sm:w-40', on: pickProvince },
                  { key: 'zone', all: filter.province ? `Mọi KCN ở ${filter.province}` : 'Mọi KCN', opts: filterOpts.zones, w: 'sm:w-48', on: (v: string) => setF({ zone: v }) },
                  { key: 'branch', all: 'Mọi chi nhánh', opts: filterOpts.branches, w: 'sm:w-44', on: (v: string) => setF({ branch: v }) },
                ] as const).map(s => {
                  const value = filter[s.key];
                  return (
                    <Select key={s.key} value={value} onChange={s.on} className={`w-[calc(50%-4px)] ${s.w}`}
                      fieldClassName={value ? '!bg-[#e8f1fd] !text-[#0058b9] font-medium' : '!bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)]'}>
                      <option value="">{s.all}</option>
                      {s.opts.map(o => <option key={o.value} value={o.value}>{o.label} ({o.count})</option>)}
                    </Select>
                  );
                })}
                <Select value={filter.service} onChange={v => setF({ service: v as PlanListFilter['service'] })} className="w-[calc(50%-4px)] sm:w-44"
                  fieldClassName={filter.service ? '!bg-[#e8f1fd] !text-[#0058b9] font-medium' : '!bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)]'}>
                  <option value="">Mọi dịch vụ</option>
                  <option value="supply">Cung ứng / cho thuê LĐ</option>
                  <option value="referral">Giới thiệu lao động</option>
                </Select>
                {isFiltering(filter) && (
                  <button onClick={() => setFilter(f => ({ ...EMPTY_PLAN_FILTER, status: f.status }))} className="h-9 px-2 text-[13px] font-medium text-[#0071e3] hover:underline">Xoá lọc</button>
                )}
                {!loading && <span className="ml-auto text-[12px] text-[#86868b] tabular-nums">{shown.length} phương án</span>}
              </div>

              {loadErr && (
                <div className="flex gap-2 items-start text-[13px] text-[#b3140a] bg-[#fff1f0] rounded-xl px-4 py-3">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" /><span>{loadErr}</span>
                </div>
              )}

              {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin text-[#86868b]" /></div>
              ) : shown.length === 0 ? (
                <div className="text-center py-24">
                  <div className="text-[17px] font-semibold text-[#1d1d1f] mb-1">{plans.length ? 'Không có phương án khớp bộ lọc' : 'Chưa có phương án nào'}</div>
                  <div className="text-[13px] text-[#86868b]">Bắt đầu bằng “Phương án mới” — chọn khách ở CRM Pipeline để tự điền ngành và KCN.</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {shown.map(p => {
                    const s = p.summary;
                    const sh = p.share && !p.share.revoked ? p.share : null;
                    return (
                      <div key={p.id} className={`${card} p-5 hover:shadow-[0_0_0_1px_rgba(0,113,227,0.35),0_4px_16px_rgba(0,0,0,0.06)] transition flex flex-col`}>
                        <button onClick={() => openPlan(p)} className="text-left flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-[15px] font-semibold tracking-tight leading-snug">{p.title}</div>
                            <span className="flex items-center gap-1 shrink-0">
                              {isReferralPlan(p) && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-[#f1edff] text-[#5e5ce6]">Giới thiệu LĐ</span>}
                              {p.status !== 'draft' && <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded ${p.status === 'final' ? 'bg-[#e8f8ed] text-[#1d8a3b]' : 'bg-[#f0f0f2] text-[#6e6e73]'}`}>{STATUS_LABEL[p.status]}</span>}
                            </span>
                          </div>
                          <div className="text-[12px] text-[#86868b] mt-0.5 truncate">{[p.company_name, p.industry].filter(Boolean).join(' · ') || 'Chưa gắn khách / ngành'}</div>
                          {(() => {
                            const zone = zoneLabelOfPlan(p, zones);
                            const prov = provinceOfPlan(p, zones);
                            const br = branches.find(b => b.id === p.branch_id);
                            if (!zone && !br) return null;
                            return (
                              <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-1 text-[11.5px] text-[#6e6e73]">
                                {zone && <span className="inline-flex items-center gap-1 min-w-0"><MapPin size={11} className="shrink-0 text-[#a1a1a6]" /><span className="truncate">{zone}{prov ? ` · ${prov}` : ''}</span></span>}
                                {br && <span className="inline-flex items-center gap-1 min-w-0"><Store size={11} className="shrink-0 text-[#a1a1a6]" /><span className="truncate">{branchLabel(br)}</span></span>}
                              </div>
                            );
                          })()}
                          {s?.service === 'referral' ? (
                            <div className="mt-4 flex items-end gap-5">
                              <div className="min-w-0"><div className="text-[11px] text-[#86868b]">Phí giới thiệu</div><div className="text-[20px] font-semibold tracking-tight tabular-nums leading-tight text-[#5e5ce6] truncate">{s.feeText}</div></div>
                              <div className="min-w-0"><div className="text-[11px] text-[#86868b]">Điều kiện</div><div className="text-[13px] font-medium truncate">{s.termText}</div></div>
                              <div className="shrink-0"><div className="text-[11px] text-[#86868b]">LN ước tính</div><div className="text-[15px] font-medium tabular-nums text-[#1d8a3b]">{fmtShort(s.profitTotal ?? 0)}</div></div>
                            </div>
                          ) : s ? (
                            <div className="mt-4 flex items-end gap-5">
                              <div><div className="text-[11px] text-[#86868b]">Giá báo / công</div><div className="text-[22px] font-semibold tracking-tight tabular-nums leading-tight">{fmt(s.quoteDaily)}</div>{s.insuranceMonthly ? <div className="text-[11px] text-[#0a7d6e] whitespace-nowrap" title="Bảo hiểm thu riêng theo tháng, không gộp vào giá ngày">+ BH {fmtShort(s.insuranceMonthly)}/người/tháng</div> : null}</div>
                              <div><div className="text-[11px] text-[#86868b]">Phí DV</div><div className="text-[15px] font-medium tabular-nums">{fmtShort(s.serviceFeeDaily)}</div></div>
                              <div><div className="text-[11px] text-[#86868b]">LN / tháng</div><div className="text-[15px] font-medium tabular-nums text-[#1d8a3b]">{fmtShort(s.profitMonthly)}</div></div>
                            </div>
                          ) : <div className="mt-4 text-[12px] text-[#c7c7cc]">Chưa có số liệu</div>}
                        </button>
                        <div className="mt-4 pt-3 border-t border-[#f2f2f4] flex items-center gap-2 text-[11.5px] text-[#86868b]">
                          <span className="truncate">{p.updated_by_name ?? '—'} · {formatDate(p.updated_at)}</span>
                          {(() => {
                            const d = p.data?.doc;
                            const n = daysLeft(d?.validUntil);
                            if (!d?.date) return null;
                            return (
                              <span className={`whitespace-nowrap ${n != null && n < 0 ? 'text-[#d70015] font-medium' : ''}`} title={`Ban hành ${dateShort(d.date)}${d.validUntil ? ` · hiệu lực đến ${dateShort(d.validUntil)}` : ''}`}>
                                · {n == null ? `BH ${dateShort(d.date)}` : n < 0 ? 'Hết hiệu lực' : `HL đến ${dateShort(d.validUntil).slice(0, 5)}`}
                              </span>
                            );
                          })()}
                          {sh && <span className="inline-flex items-center gap-1 text-[#1d8a3b] font-medium whitespace-nowrap"><Link2 size={11} />{sh.open_count} lượt mở</span>}
                          <span className="ml-auto flex items-center">
                            <button onClick={() => duplicate({ meta: metaOfRow(p), data: normalizePlanData(p.data) })} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f5f5f7] hover:text-[#1d1d1f]" title="Nhân bản"><Copy size={13} /></button>
                            <button onClick={() => removePlan(p)} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#fff1f0] hover:text-[#d70015]" title="Xoá"><Trash2 size={13} /></button>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            // ───────────── SOẠN PHƯƠNG ÁN ─────────────
            <div className="p-4 sm:p-6 space-y-4 max-w-[1180px] mx-auto">
              {remote && (
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#4a2fbd] bg-[#f1edff] rounded-xl px-4 py-2.5">
                  <Link2 size={14} />
                  <span><b>{remote.updated_by_name ?? 'Có người'}</b> vừa cập nhật phương án này (v{remote.version}).</span>
                  <button onClick={() => loadRemote(remote)} className="ml-auto h-7 px-3 rounded-full bg-[#5e5ce6] text-white text-[12px] font-medium hover:bg-[#6e6cf0]">Tải bản mới</button>
                  <button onClick={() => setRemote(null)} className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/60"><X size={13} /></button>
                </div>
              )}

              {result && (
                <PlanEditor
                  data={draft.data} result={result} industry={draft.meta.industry} onChange={setData}
                  branchLabel={branch ? branchLabel(branch) : null} branchKhoan={branchKhoan}
                  historySuggestions={historySuggestions} minWage={minWage} templateLines={draftTemplate?.lines ?? null} fileName={draft.meta.title || 'phuong-an-gia'} fillMeta={{ company: draft.meta.company_name, industry: draft.meta.industry, zone: draft.meta.zone_name }}
                  planId={draft.id} docDefaults={docDefaults} scale={scaleDefaults}
                  onPushCrm={draft.meta.pipeline_id && draft.id ? pushToCrm : undefined}
                  aboveList={isReferral(draft.data) ? (
                    // Giới thiệu lao động: không có bảng chi phí lương → bỏ lương tối thiểu, đơn giá CRM, mẫu ngành, tham khảo bảng chi phí
                    <PlanContextBar
                      meta={draft.meta} onMeta={p => patchMeta(p)} pipeline={pipeline} clients={clients} branches={branches}
                      industries={industries} zoneNames={zones.map(z => z.name)} minWage={null} baseWageMonthly={0}
                      onPickCompany={pickCompany} onSetBaseToMinWage={setBaseToMinWage} crmLines={[]} onApplyCrmLine={applyCrmLine} picking={picking}
                    />
                  ) : (
                    <>
                      <PlanContextBar
                        meta={draft.meta} onMeta={p => patchMeta(p)} pipeline={pipeline} clients={clients} branches={branches}
                        industries={industries} zoneNames={zones.map(z => z.name)} minWage={minWage} baseWageMonthly={baseWageMonthly}
                        onPickCompany={pickCompany} onSetBaseToMinWage={setBaseToMinWage} crmLines={crmLines} onApplyCrmLine={applyCrmLine} picking={picking}
                      />
                      <IndustryTemplateBar industry={draft.meta.industry} template={draftTemplate} lineCount={draft.data.lines.filter(l => !l.isServiceFee).length}
                        onSave={saveIndustryTemplate} onApply={applyIndustryTemplate} onDelete={deleteIndustryTemplate} />
                      <SuggestionsPanel plans={plans} industry={draft.meta.industry} zone={draft.meta.zone_name} excludeId={draft.id} onUseTemplate={useTemplate} />
                    </>
                  )}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Xung đột phiên bản: có người vừa sửa qua link khi mình đang sửa */}
      {conflict && (
        <div className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4" style={{ fontFamily: FONT }}>
          <div className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-md p-6 space-y-4">
            <div>
              <div className="text-[17px] font-semibold tracking-tight">Phương án vừa được người khác sửa</div>
              <p className="text-[13px] text-[#6e6e73] leading-relaxed mt-1.5">
                <b className="text-[#1d1d1f]">{conflict.updated_by_name ?? 'Một người'}</b> đã lưu v{conflict.version} lúc {new Date(conflict.updated_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}, sau khi bạn mở bản này.
                Lưu tiếp sẽ ghi đè thay đổi của họ (vẫn xem lại được trong Lịch sử).
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => doSave(true)} className={`${btnPrimary} !h-10`}>Ghi đè bằng bản của tôi</button>
              <button onClick={() => loadRemote(conflict)} className={`${btnGhost} !h-10`}>Tải bản của họ (bỏ thay đổi của tôi)</button>
              <button onClick={() => setConflict(null)} className="h-9 text-[13px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]">Quay lại sửa</button>
            </div>
          </div>
        </div>
      )}

      {showShare && draft?.id && token && (
        <SharePanel
          plan={{ ...(plans.find(p => p.id === draft.id) ?? ({} as CostPlanRow)), id: draft.id, title: draft.meta.title || 'Phương án giá', share: draft.share }}
          token={token} toast={toast} onClose={() => setShowShare(false)}
          onChanged={share => { setDraft(d => (d ? { ...d, share } : d)); setPlans(prev => prev.map(p => (p.id === draft.id ? { ...p, share } : p))); }}
        />
      )}
      {showHistory && draft?.id && token && (
        <HistoryPanel planId={draft.id} token={token} currentVersion={draft.version} onRestore={restoreRevision} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}
