import { Fragment, useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, ExternalLink, Coins, X, Pencil, Check, List, LayoutGrid, Image as ImageIcon, MapPin, Settings, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { availPillCls, LABOR_AVAIL_OPTIONS, type MarketTabProps } from './shared';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import SearchSelect from './SearchSelect';
import { fetchIndustries, addIndustry } from './industries';
import {
  type RegionZone, type RegionWageRow, type RegionWageBatch,
  OFFICIAL_REGION_WAGES, OFFICIAL_EFFECTIVE_DATE, REGION_ZONES,
  fetchRegionWageRows, fetchRegionWageBatches, saveRegionWageBatch, updateRegionWageBatch, deleteRegionWageBatch,
  bulkAssignRegionZone, regionZoneLabel, regionWageOf, regionZoneColorCls, fmtRegionWage,
} from './regionWage';

const emptyForm = {
  zone_name: '', industry: '', pt_min: '', pt_max: '', tv_min: '', tv_max: '', ct_min: '', ct_max: '',
  labor_availability: 'Trung bình', occupancy: '', survey_date: new Date().toISOString().split('T')[0],
};

// ── Cài đặt hiển thị "Mức lương theo ngành nghề" (lưu localStorage, không cần migration) ──
// Vùng lương tối thiểu KHÔNG còn ở đây — mỗi KCN gắn vùng riêng (market_zones.region_zone),
// 4 mức tiền dùng chung qua module regionWage.
type CalcMode = 'envelope' | 'average';
interface WageSettings {
  srcProjects: boolean;   // gộp lương từ Khách hàng + Công ty/Dự án đang tìm hiểu
  srcSurveys: boolean;    // gộp lương từ khảo sát thủ công (market_surveys)
  calcMode: CalcMode;     // envelope = bao trùm min–max, average = trung bình
}
const DEFAULT_WAGE_SETTINGS: WageSettings = { srcProjects: true, srcSurveys: false, calcMode: 'envelope' };
const loadWageSettings = (): WageSettings => {
  try {
    const raw = localStorage.getItem('market_wage_settings');
    if (raw) return { ...DEFAULT_WAGE_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_WAGE_SETTINGS;
};

export default function WageTab({ marketZones, marketSurveys, marketLeads, clients, zoneFilter, setZoneFilter, goTab, onRefresh, toast }: MarketTabProps) {
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [provinceFilter, setProvinceFilter] = useState<string>('all');
  const [industryFilter, setIndustryFilter] = useState<string>('all');
  const [editIndustryId, setEditIndustryId] = useState<string | null>(null);
  const [editIndustryValue, setEditIndustryValue] = useState('');
  const [reassignZone, setReassignZone] = useState<string | null>(null);
  const [reassignValue, setReassignValue] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'card'>(() => (localStorage.getItem('market_wage_view_mode') as 'list' | 'card') || 'list');
  useEffect(() => { localStorage.setItem('market_wage_view_mode', viewMode); }, [viewMode]);
  const [settings, setSettings] = useState<WageSettings>(loadWageSettings);
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => { localStorage.setItem('market_wage_settings', JSON.stringify(settings)); }, [settings]);
  // 4 mức lương tối thiểu vùng (đồng) — giá trị "hiện hành" ở bảng region_wages, tự tính lại
  // từ region_wage_batches (từng lần đổi lương, sửa/xoá được) mỗi khi bấm "Lưu" bên dưới.
  const defaultRows: Record<RegionZone, RegionWageRow> = {
    I: { amount: OFFICIAL_REGION_WAGES.I, effectiveDate: OFFICIAL_EFFECTIVE_DATE },
    II: { amount: OFFICIAL_REGION_WAGES.II, effectiveDate: OFFICIAL_EFFECTIVE_DATE },
    III: { amount: OFFICIAL_REGION_WAGES.III, effectiveDate: OFFICIAL_EFFECTIVE_DATE },
    IV: { amount: OFFICIAL_REGION_WAGES.IV, effectiveDate: OFFICIAL_EFFECTIVE_DATE },
  };
  const todayStr = new Date().toISOString().split('T')[0];
  const [regionWageRows, setRegionWageRows] = useState<Record<RegionZone, RegionWageRow>>(defaultRows);
  const regionWages = useMemo<Record<RegionZone, number>>(() => ({
    I: regionWageRows.I.amount, II: regionWageRows.II.amount, III: regionWageRows.III.amount, IV: regionWageRows.IV.amount,
  }), [regionWageRows]);
  const [regionDraft, setRegionDraft] = useState<Record<RegionZone, string>>({ I: '', II: '', III: '', IV: '' });
  const [effectiveDateInput, setEffectiveDateInput] = useState(todayStr);
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [regionBatches, setRegionBatches] = useState<RegionWageBatch[]>([]);
  const [showBatches, setShowBatches] = useState(false);
  const [savingAllWages, setSavingAllWages] = useState(false);
  const [restoringWages, setRestoringWages] = useState(false);
  const reloadRegionWages = () => fetchRegionWageRows().then(setRegionWageRows);
  const loadBatches = () => { fetchRegionWageBatches().then(setRegionBatches); };
  useEffect(() => { reloadRegionWages(); }, []);
  // Đồng bộ ô nhập theo giá trị đang áp dụng — sửa xong bấm nút "Lưu" mới ghi DB, gõ dở
  // dang không tự lưu. Chỉ đồng bộ khi KHÔNG đang sửa 1 lần nhập cũ (kẻo ghi đè input).
  useEffect(() => {
    if (editingBatchId) return;
    setRegionDraft({
      I: String(regionWageRows.I.amount / 1_000_000), II: String(regionWageRows.II.amount / 1_000_000),
      III: String(regionWageRows.III.amount / 1_000_000), IV: String(regionWageRows.IV.amount / 1_000_000),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionWageRows]);
  // Sửa 1 lần nhập cũ — nạp giá trị của batch đó vào form, "Lưu" sẽ update thay vì tạo mới.
  const startEditBatch = (b: RegionWageBatch) => {
    setEditingBatchId(b.id);
    setEffectiveDateInput(b.effectiveDate);
    setRegionDraft({
      I: String(b.wages.I / 1_000_000), II: String(b.wages.II / 1_000_000),
      III: String(b.wages.III / 1_000_000), IV: String(b.wages.IV / 1_000_000),
    });
  };
  const cancelEditBatch = () => {
    setEditingBatchId(null);
    setEffectiveDateInput(todayStr);
    setRegionDraft({
      I: String(regionWageRows.I.amount / 1_000_000), II: String(regionWageRows.II.amount / 1_000_000),
      III: String(regionWageRows.III.amount / 1_000_000), IV: String(regionWageRows.IV.amount / 1_000_000),
    });
  };
  const handleDeleteBatch = async (id: string) => {
    if (!confirm('Xoá lần nhập lương này? Không thể hoàn tác.')) return;
    const err = await deleteRegionWageBatch(id);
    if (err) { toast('Lỗi xoá: ' + err); return; }
    await reloadRegionWages();
    loadBatches();
    if (editingBatchId === id) cancelEditBatch();
    toast('Đã xoá lần nhập lương');
  };
  // Gán vùng hàng loạt cho nhiều KCN cùng lúc — thay vì mở từng hồ sơ KCN ở tab Khu vực.
  const [bulkZoneIds, setBulkZoneIds] = useState<string[]>([]);
  const [bulkZoneTarget, setBulkZoneTarget] = useState<RegionZone | ''>('');
  const [bulkOnlyUnassigned, setBulkOnlyUnassigned] = useState(true);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const toggleBulkZone = (id: string) => setBulkZoneIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
  const handleBulkAssign = async () => {
    if (!bulkZoneTarget || bulkZoneIds.length === 0) return;
    setBulkAssigning(true);
    const err = await bulkAssignRegionZone(bulkZoneIds, bulkZoneTarget);
    setBulkAssigning(false);
    if (err) { toast('Lỗi gán vùng: ' + err); return; }
    toast(`Đã gán ${regionZoneLabel(bulkZoneTarget)} cho ${bulkZoneIds.length} KCN`);
    setBulkZoneIds([]);
    await onRefresh();
  };
  // Tra vùng lương tối thiểu theo tên KCN chính thức (đã gán ở tab Khu vực).
  const zoneToRegion = useMemo(() => {
    const map: Record<string, string | null | undefined> = {};
    marketZones.forEach(z => { map[z.name] = z.region_zone; });
    return map;
  }, [marketZones]);

  // Tên KCN chính thức đã tạo bên tab Khu vực — khảo sát nào có zone_name KHÔNG khớp tên
  // này (gõ tay sai chính tả, thiếu tiền tố "KCN "…) sẽ bị tách thành nhóm riêng, không
  // gộp đúng vào KCN thật. Cảnh báo + cho gộp lại ngay tại đây.
  const officialZoneNames = useMemo(() => new Set(marketZones.map(z => z.name)), [marketZones]);

  const zoneNames = [...new Set([...marketZones.map(z => z.name), ...marketSurveys.map(s => s.zone_name)])];

  const zoneToProvince = useMemo(() => {
    const map: Record<string, string> = {};
    marketZones.forEach(z => { if (z.location) map[z.name] = z.location; });
    return map;
  }, [marketZones]);

  const zoneToImage = useMemo(() => {
    const map: Record<string, string | null | undefined> = {};
    marketZones.forEach(z => { map[z.name] = z.image_url; });
    return map;
  }, [marketZones]);

  const provinces = useMemo(() => {
    const set = new Set(Object.values(zoneToProvince));
    return [...set].sort();
  }, [zoneToProvince]);

  // Danh sách KCN theo tỉnh đã chọn (chưa áp bộ lọc KCN) — nguồn cho dropdown KCN.
  const zonesInProvince = useMemo(
    () => provinceFilter === 'all' ? zoneNames : zoneNames.filter(z => zoneToProvince[z] === provinceFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoneNames.join('|'), provinceFilter, zoneToProvince],
  );

  const filteredZoneNames = useMemo(
    () => zoneFilter === 'all' ? zonesInProvince : zonesInProvince.filter(z => z === zoneFilter),
    [zonesInProvince, zoneFilter],
  );

  const zonesToShow = filteredZoneNames;

  // So khớp tên khu vực không phân biệt hoa/thường & chấp nhận lệch tiền tố "KCN " —
  // client.region/market_leads.region thường gõ tay ("BIÊN HOÀ 2") khác tên KCN chính
  // thức ("KCN Biên Hoà 2"), nên so khớp tuyệt đối (===) sẽ bỏ sót rất nhiều bản ghi.
  const zoneMatches = (a: string | null | undefined, b: string | null | undefined) => {
    if (!a || !b) return false;
    const na = a.trim().toLowerCase();
    const nb = b.trim().toLowerCase();
    return na === nb || na.includes(nb) || nb.includes(na);
  };

  const matchesIndustry = (industry: string | null | undefined) => industryFilter === 'all' || industry === industryFilter;

  // Khớp Khách hàng/Dự án với bộ lọc Tỉnh/TP + KCN đang chọn trên bảng khảo sát —
  // dùng chung logic zoneToProvince để "Mức lương theo ngành nghề" chỉ tổng hợp đúng
  // phạm vi đang lọc, không lẫn dữ liệu ngoài phạm vi (KCN không thuộc tỉnh đã chọn…).
  const matchesFilter = (region: string | null | undefined, zones: string[] | undefined) => {
    if (zoneFilter !== 'all') {
      if (zoneMatches(region, zoneFilter) || zones?.some(z => zoneMatches(z, zoneFilter))) return true;
      return false;
    }
    if (provinceFilter !== 'all') {
      if (region && zoneToProvince[region] === provinceFilter) return true;
      if (region === provinceFilter) return true;
      if (zones?.some(z => zoneToProvince[z] === provinceFilter)) return true;
      return false;
    }
    return true;
  };

  // Dữ liệu lương từ Khách hàng/Dự án (đã nhập ở tab Công ty/Dự án), gộp theo ĐÚNG KCN
  // để hiển thị ngay trong từng nhóm khu vực bên dưới — trước đây bảng này chỉ đọc từ
  // market_surveys (khảo sát tay), nên KCN nào chưa có khảo sát thì hiện "chưa có dữ liệu"
  // dù khách hàng/dự án tại đó đã có sẵn ngành + lương (vd: KUKA tại KCN Bầu Bàng).
  const clientLeadRowsByZone = useMemo(() => {
    const map = new Map<string, { industry: string; wageMin: number; wageMax: number; name: string }[]>();
    const addTo = (zone: string, entry: { industry: string; wageMin: number; wageMax: number; name: string }) => {
      const arr = map.get(zone) ?? [];
      arr.push(entry);
      map.set(zone, arr);
    };
    zoneNames.forEach(zone => {
      clients.forEach(c => {
        if (!c.industry || c.wage_min == null || c.wage_max == null) return;
        if ((c.industrial_zones ?? []).some(z => zoneMatches(z, zone))) {
          addTo(zone, { industry: c.industry, wageMin: c.wage_min, wageMax: c.wage_max, name: c.name });
        }
      });
      marketLeads.forEach(l => {
        if (!l.industry || l.wage_min == null || l.wage_max == null) return;
        if (zoneMatches(l.region, zone)) {
          addTo(zone, { industry: l.industry, wageMin: l.wage_min, wageMax: l.wage_max, name: l.company_name });
        }
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneNames.join('|'), clients, marketLeads]);

  // Tổng hợp mức lương theo NGÀNH NGHỀ, giới hạn theo Tỉnh/TP + KCN đang lọc. Nguồn dữ liệu
  // và cách tính do người dùng chọn trong "Tuỳ chọn":
  //  · srcProjects → gộp Khách hàng đang hợp tác + Công ty/Dự án đang tìm hiểu
  //  · srcSurveys  → gộp thêm khảo sát thủ công (market_surveys)
  //  · calcMode 'envelope' → khoảng bao trùm [min nhỏ nhất – max lớn nhất]
  //  · calcMode 'average'  → khoảng lương trung bình [TB các min – TB các max] (nhiều công
  //    ty cùng ngành thì lấy trung bình).
  const industryWageSummary = useMemo(() => {
    interface Acc { mins: number[]; maxs: number[]; count: number; names: string[] }
    const map = new Map<string, Acc>();
    const feed = (industry: string | null | undefined, wageMin: number | null | undefined, wageMax: number | null | undefined, name: string) => {
      if (!industry || wageMin == null || wageMax == null) return;
      const key = industry.trim();
      if (!key) return;
      if (industryFilter !== 'all' && key !== industryFilter) return;
      const cur = map.get(key) ?? { mins: [], maxs: [], count: 0, names: [] };
      cur.mins.push(wageMin);
      cur.maxs.push(wageMax);
      cur.count += 1;
      if (!cur.names.includes(name) && cur.names.length < 4) cur.names.push(name);
      map.set(key, cur);
    };
    if (settings.srcProjects) {
      clients.filter(c => matchesFilter(c.region, c.industrial_zones ?? undefined)).forEach(c => feed(c.industry, c.wage_min, c.wage_max, c.name));
      marketLeads.filter(l => matchesFilter(l.region, undefined)).forEach(l => feed(l.industry, l.wage_min, l.wage_max, l.company_name));
    }
    if (settings.srcSurveys) {
      marketSurveys.filter(s => matchesFilter(s.zone_name, undefined)).forEach(s => {
        const min = s.wage_skilled_min ?? s.wage_seasonal_min ?? s.wage_unskilled_min;
        const max = s.wage_skilled_max ?? s.wage_seasonal_max ?? s.wage_unskilled_max;
        feed(s.industry, min, max, s.zone_name);
      });
    }
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return [...map.entries()]
      .map(([industry, v]) => ({
        industry,
        min: settings.calcMode === 'average' ? avg(v.mins) : Math.min(...v.mins),
        max: settings.calcMode === 'average' ? avg(v.maxs) : Math.max(...v.maxs),
        count: v.count,
        names: v.names,
      }))
      .sort((a, b) => a.industry.localeCompare(b.industry, 'vi'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, marketLeads, marketSurveys, provinceFilter, zoneFilter, industryFilter, zoneToProvince, settings]);

  const [industries, setIndustries] = useState<string[]>([]);
  useEffect(() => {
    fetchIndustries(marketSurveys.map(s => s.industry)).then(setIndustries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddIndustry = async (name: string) => {
    const err = await addIndustry(name);
    if (err) toast('Lỗi thêm ngành (bảng industries chưa tạo? Chạy migration 099): ' + err);
    setIndustries(prev => [...new Set([...prev, name])].sort((a, b) => a.localeCompare(b, 'vi')));
  };

  const openAdd = (zone?: string) => {
    setForm({ ...emptyForm, zone_name: zone || zoneNames[0] || '' });
    setShowAdd(true);
  };

  const handleAdd = async () => {
    if (!form.zone_name.trim() || !form.industry.trim()) { toast('Chọn khu vực và nhập ngành nghề'); return; }
    setSaving(true);
    try {
      const toNum = (v: string) => v ? parseFloat(v) * 1_000_000 : null;
      const { data, error } = await supabase.from('market_surveys').insert({
        zone_name: form.zone_name.trim(),
        industry: form.industry.trim(),
        survey_date: form.survey_date,
        wage_unskilled_min: toNum(form.pt_min), wage_unskilled_max: toNum(form.pt_max),
        wage_seasonal_min: toNum(form.tv_min), wage_seasonal_max: toNum(form.tv_max),
        wage_skilled_min: toNum(form.ct_min), wage_skilled_max: toNum(form.ct_max),
        labor_availability: form.labor_availability,
        occupancy: form.occupancy || null,
      }).select().single();
      if (error) throw error;
      await logActivity({
        user, action: 'insert', table: 'market_surveys', recordId: data.id,
        description: `Thêm khảo sát lương ngành "${form.industry.trim()}" cho khu vực "${form.zone_name.trim()}"`,
        newData: data,
      });
      await onRefresh();
      setShowAdd(false);
      setForm(emptyForm);
      toast('Đã lưu khảo sát!');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const existing = marketSurveys.find(s => s.id === id);
      const { error } = await supabase.from('market_surveys').delete().eq('id', id);
      if (error) throw error;
      if (existing) {
        await logActivity({
          user, action: 'delete', table: 'market_surveys', recordId: id,
          description: `Xóa khảo sát lương ngành "${existing.industry || '—'}" của khu vực "${existing.zone_name}"`,
          oldData: existing,
        });
      }
      await onRefresh();
      toast('Đã xóa khảo sát');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const startEditIndustry = (id: string, current: string | null) => {
    setEditIndustryId(id);
    setEditIndustryValue(current ?? '');
  };

  const handleSaveIndustry = async (id: string) => {
    if (!editIndustryValue.trim()) { toast('Chọn ngành nghề'); return; }
    try {
      const existing = marketSurveys.find(s => s.id === id);
      const { error } = await supabase.from('market_surveys').update({ industry: editIndustryValue.trim() }).eq('id', id);
      if (error) throw error;
      if (existing) {
        await logActivity({
          user, action: 'update', table: 'market_surveys', recordId: id,
          description: `Cập nhật ngành nghề khảo sát tại "${existing.zone_name}": ${existing.industry || '—'} → ${editIndustryValue.trim()}`,
          oldData: existing, newData: { ...existing, industry: editIndustryValue.trim() },
        });
      }
      await onRefresh();
      setEditIndustryId(null);
      toast('Đã cập nhật ngành nghề');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  // Gộp toàn bộ khảo sát của 1 zone_name gõ sai/lệch chính tả vào đúng tên KCN chính thức
  // đã tạo bên tab Khu vực — sửa 1 lần cho tất cả dòng đang bị tách nhóm sai.
  const handleReassignZone = async (oldZone: string) => {
    if (!reassignValue.trim() || reassignValue === oldZone) return;
    setReassigning(true);
    try {
      const { error } = await supabase.from('market_surveys').update({ zone_name: reassignValue }).eq('zone_name', oldZone);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'market_surveys',
        description: `Gộp khảo sát khu vực "${oldZone}" vào KCN chính thức "${reassignValue}"`,
      });
      await onRefresh();
      setReassignZone(null);
      toast(`Đã gộp "${oldZone}" vào "${reassignValue}"`);
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setReassigning(false);
  };

  const fmtTr = (v: number | null | undefined) => v != null ? (v / 1_000_000).toFixed(1) : '—';

  const sourceLabel = [settings.srcProjects && 'Công ty/Dự án', settings.srcSurveys && 'Khảo sát thủ công']
    .filter(Boolean).join(' + ') || 'Chưa chọn nguồn';
  const calcLabel = settings.calcMode === 'average' ? 'Khoảng lương TB (trung bình)' : 'Khoảng bao trùm (min–max)';
  // Lưu cả 4 vùng thành 1 "lần nhập" (batch) gắn 1 ngày áp dụng — chỉ bấm nút "Lưu" mới ghi
  // DB, không tự lưu khi đang gõ. Nếu đang sửa 1 lần nhập cũ (editingBatchId) thì update batch
  // đó thay vì tạo mới.
  const handleSaveRegionWages = async () => {
    if (!effectiveDateInput) { toast('Chọn ngày áp dụng'); return; }
    const wages: Record<RegionZone, number> = {
      I: Math.round(parseFloat(regionDraft.I || '0') * 1_000_000),
      II: Math.round(parseFloat(regionDraft.II || '0') * 1_000_000),
      III: Math.round(parseFloat(regionDraft.III || '0') * 1_000_000),
      IV: Math.round(parseFloat(regionDraft.IV || '0') * 1_000_000),
    };
    if (REGION_ZONES.some(z => !wages[z.key])) { toast('Nhập đủ mức lương cho cả 4 vùng'); return; }
    setSavingAllWages(true);
    const err = editingBatchId
      ? await updateRegionWageBatch(editingBatchId, effectiveDateInput, wages)
      : await saveRegionWageBatch(effectiveDateInput, wages);
    setSavingAllWages(false);
    if (err) { toast('Lỗi lưu: ' + err); return; }
    await reloadRegionWages();
    loadBatches();
    toast(editingBatchId ? 'Đã cập nhật lần nhập lương' : 'Đã lưu mức lương vùng mới');
    setEditingBatchId(null);
    setEffectiveDateInput(todayStr);
  };
  const restoreOfficialWages = async () => {
    setRestoringWages(true);
    const err = await saveRegionWageBatch(OFFICIAL_EFFECTIVE_DATE, OFFICIAL_REGION_WAGES);
    if (err) toast('Lỗi khôi phục: ' + err);
    await reloadRegionWages();
    loadBatches();
    setRestoringWages(false);
  };
  // Vùng + mức lương tối thiểu của KCN đang lọc (nếu chọn 1 KCN cụ thể).
  const filterZoneRegion = zoneFilter !== 'all' ? zoneToRegion[zoneFilter] : null;
  const filterZoneWage = regionWageOf(filterZoneRegion, regionWages);

  return (
    <div className="space-y-3">
      {/* Không dùng overflow-hidden ở đây — panel "Tuỳ chọn" là absolute, bị cắt mất bởi
          overflow-hidden của thẻ cha (đặc biệt sau khi thẻ co lại do đổi bộ lọc), khiến
          bấm lại "Tuỳ chọn" không thấy ô tick nào để lọc. */}
      <div className="bg-white border border-[#E8E7E2] rounded-[10px]">
        <div className="flex items-start justify-between gap-2 px-4 py-2.5 border-b border-[#E8E7E2] rounded-t-[10px]">
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-[#111]">Mức lương theo ngành nghề</div>
            <div className="text-[11px] text-[#999] mt-0.5">
              Nguồn: {sourceLabel} · {calcLabel}
              {provinceFilter !== 'all' || zoneFilter !== 'all' ? ` · trong phạm vi đang lọc (${zoneFilter !== 'all' ? zoneFilter : provinceFilter})` : ', theo mọi khu vực'}
            </div>
          </div>
          <div className="relative shrink-0">
            <button onClick={() => setShowSettings(v => !v)} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border transition ${showSettings ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]'}`}>
              <Settings size={12} /> Tuỳ chọn
            </button>
            {showSettings && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSettings(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-20 w-[340px] max-h-[80vh] overflow-y-auto bg-white border border-[#E8E7E2] rounded-[12px] shadow-xl p-3.5 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[12.5px] font-semibold text-[#111]">Tuỳ chọn hiển thị lương</div>
                    <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-gray-100 rounded"><X size={13} /></button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-[#666]">Nguồn dữ liệu</div>
                    <label className="flex items-center gap-2 text-[12px] text-[#333] cursor-pointer">
                      <input type="checkbox" checked={settings.srcProjects} onChange={e => setSettings(s => ({ ...s, srcProjects: e.target.checked }))} />
                      Từ Công ty/Dự án có sẵn (khách hàng + dự án)
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-[#333] cursor-pointer">
                      <input type="checkbox" checked={settings.srcSurveys} onChange={e => setSettings(s => ({ ...s, srcSurveys: e.target.checked }))} />
                      Khảo sát thủ công (bảng "Thêm khảo sát")
                    </label>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-[#666]">Cách tính khoảng lương</div>
                    <label className="flex items-center gap-2 text-[12px] text-[#333] cursor-pointer">
                      <input type="radio" name="calcMode" checked={settings.calcMode === 'envelope'} onChange={() => setSettings(s => ({ ...s, calcMode: 'envelope' }))} />
                      Bao trùm (min thấp nhất – max cao nhất)
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-[#333] cursor-pointer">
                      <input type="radio" name="calcMode" checked={settings.calcMode === 'average'} onChange={() => setSettings(s => ({ ...s, calcMode: 'average' }))} />
                      Trung bình (TB các dự án cùng ngành)
                    </label>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-medium text-[#666]">
                        {editingBatchId ? 'Sửa lần nhập lương vùng' : 'Mức lương tối thiểu 4 vùng (tr/tháng)'}
                      </div>
                      <button onClick={restoreOfficialWages} disabled={restoringWages} title="Khôi phục mức Nhà nước 2024" className="inline-flex items-center gap-1 text-[10.5px] text-blue-600 hover:underline disabled:opacity-50">
                        <RotateCcw size={10} /> {restoringWages ? 'Đang khôi phục…' : 'Mức 2024'}
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {REGION_ZONES.map(z => (
                        <div key={z.key} className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-[#888] text-center">{z.label}</span>
                          <input
                            type="number" step="0.01"
                            value={regionDraft[z.key]}
                            onChange={e => setRegionDraft(d => ({ ...d, [z.key]: e.target.value }))}
                            className="text-[12px] px-1.5 py-1 rounded-lg border border-gray-300 outline-none focus:border-blue-500 text-center"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-0.5">
                      <label className="text-[10.5px] text-[#666] shrink-0">Ngày áp dụng</label>
                      <input
                        type="date"
                        value={effectiveDateInput}
                        onChange={e => setEffectiveDateInput(e.target.value)}
                        className="flex-1 text-[11.5px] px-2 py-1 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="text-[10.5px] text-[#aaa]">Vùng của mỗi KCN gán ở tab <b>Khu vực</b>. Ngày áp dụng để nhớ mốc Nghị định có hiệu lực, không phải ngày sửa trên app.</div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={handleSaveRegionWages}
                        disabled={savingAllWages}
                        className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-60"
                      >
                        {savingAllWages ? 'Đang lưu…' : editingBatchId ? 'Lưu thay đổi' : 'Lưu'}
                      </button>
                      {editingBatchId && (
                        <button onClick={cancelEditBatch} className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50">
                          Huỷ
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => { const next = !showBatches; setShowBatches(next); if (next) loadBatches(); }}
                      className="text-[10.5px] text-blue-600 hover:underline"
                    >
                      {showBatches ? 'Ẩn lịch sử nhập lương vùng' : 'Xem lịch sử nhập lương vùng'}
                    </button>
                    {showBatches && (
                      <div className="max-h-[280px] overflow-y-auto space-y-1.5 border-t border-gray-100 pt-1.5">
                        {regionBatches.length === 0 && (
                          <div className="text-[10.5px] text-[#aaa] py-1">Chưa có lần nhập nào.</div>
                        )}
                        {(() => {
                          const sortedAsc = [...regionBatches].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
                          const prevBatchOf = (b: RegionWageBatch) => {
                            const idx = sortedAsc.findIndex(x => x.id === b.id);
                            return idx > 0 ? sortedAsc[idx - 1] : null;
                          };
                          // 208 giờ/tháng (26 ngày × 8 giờ) — cách quy đổi lương tháng → lương giờ theo Nghị định.
                          const hourlyOf = (amount: number) => Math.floor(amount / 208 / 100) * 100;
                          return regionBatches.map(b => {
                            const isActive = regionWageRows.I.effectiveDate === b.effectiveDate;
                            const isFuture = b.effectiveDate > todayStr;
                            const prev = prevBatchOf(b);
                            return (
                              <div key={b.id} className={`rounded-lg border p-2 space-y-1.5 ${isActive ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200'}`}>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[11px] font-medium text-[#333]">{new Date(b.effectiveDate).toLocaleDateString('vi-VN')}</span>
                                    {isActive && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Đang áp dụng</span>}
                                    {isFuture && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Sắp áp dụng</span>}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button onClick={() => startEditBatch(b)} className="text-[10px] text-blue-600 hover:underline">Sửa</button>
                                    <button onClick={() => handleDeleteBatch(b.id)} className="text-[10px] text-red-500 hover:underline">Xoá</button>
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  {REGION_ZONES.map(z => {
                                    const amount = b.wages[z.key];
                                    const prevAmount = prev?.wages[z.key];
                                    const pct = prevAmount ? ((amount - prevAmount) / prevAmount) * 100 : null;
                                    return (
                                      <div key={z.key} className="flex items-center gap-1.5 text-[10.5px]">
                                        <span className={`shrink-0 font-semibold w-5 h-3.5 text-[9px] inline-flex items-center justify-center rounded ${regionZoneColorCls(z.key)}`}>{z.label}</span>
                                        <span className="text-[#333] font-medium">{fmtRegionWage(amount)}tr</span>
                                        {pct != null && (
                                          <span className={`text-[9.5px] font-medium ${pct > 0 ? 'text-emerald-600' : pct < 0 ? 'text-red-500' : 'text-[#999]'}`}>
                                            ({pct > 0 ? '+' : ''}{pct.toFixed(1)}%)
                                          </span>
                                        )}
                                        <span className="text-[#aaa] ml-auto shrink-0">~{hourlyOf(amount).toLocaleString('vi-VN')}đ/giờ</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 border-t border-gray-100 pt-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-medium text-[#666]">Gán vùng hàng loạt cho KCN</div>
                      <label className="flex items-center gap-1 text-[10px] text-[#888] cursor-pointer">
                        <input type="checkbox" checked={bulkOnlyUnassigned} onChange={e => setBulkOnlyUnassigned(e.target.checked)} />
                        Chỉ KCN chưa gán
                      </label>
                    </div>
                    <div className="max-h-[130px] overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {marketZones
                        .filter(z => !bulkOnlyUnassigned || !z.region_zone)
                        .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
                        .map(z => (
                          <label key={z.id} className="flex items-center gap-2 px-2 py-1 text-[11.5px] text-[#333] cursor-pointer hover:bg-gray-50">
                            <input type="checkbox" checked={bulkZoneIds.includes(z.id)} onChange={() => toggleBulkZone(z.id)} />
                            <span className="flex-1 truncate">{z.name}</span>
                            {regionZoneLabel(z.region_zone) && (
                              <span className={`shrink-0 text-[9px] font-semibold w-5 h-3.5 inline-flex items-center justify-center rounded ${regionZoneColorCls(z.region_zone)}`}>{regionZoneLabel(z.region_zone)}</span>
                            )}
                          </label>
                        ))}
                      {marketZones.filter(z => !bulkOnlyUnassigned || !z.region_zone).length === 0 && (
                        <div className="px-2 py-2 text-[11px] text-[#aaa]">Mọi KCN đã gán vùng.</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={bulkZoneTarget}
                        onChange={e => setBulkZoneTarget(e.target.value as RegionZone | '')}
                        className="flex-1 text-[11.5px] px-2 py-1 rounded-lg border border-gray-300 outline-none bg-white"
                      >
                        <option value="">— Chọn vùng —</option>
                        {REGION_ZONES.map(z => <option key={z.key} value={z.key}>{z.label} · Vùng {z.key}</option>)}
                      </select>
                      <button
                        onClick={handleBulkAssign}
                        disabled={bulkAssigning || !bulkZoneTarget || bulkZoneIds.length === 0}
                        className="shrink-0 px-3 py-1 rounded-lg text-[11.5px] font-medium bg-[#1D4ED8] text-white disabled:opacity-40"
                      >
                        {bulkAssigning ? 'Đang gán…' : `Gán (${bulkZoneIds.length})`}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="p-3 flex flex-wrap gap-2 rounded-b-[10px]">
          {/* Thẻ lương tối thiểu vùng theo KCN đang lọc — mỗi KCN 1 vùng riêng (gán ở tab Khu vực) */}
          {zoneFilter !== 'all' ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2 min-w-[160px]">
              <div className="text-[11px] font-medium text-blue-800">Lương tối thiểu vùng · {zoneFilter}</div>
              {filterZoneRegion ? (
                <>
                  <div className="text-[14px] font-semibold text-blue-700 mt-0.5">{fmtRegionWage(filterZoneWage)}tr</div>
                  <div className="text-[10.5px] text-blue-500/80 mt-0.5">
                    {regionZoneLabel(filterZoneRegion)} (Vùng {filterZoneRegion})
                    {regionWageRows[filterZoneRegion as RegionZone]?.effectiveDate && ` · từ ${new Date(regionWageRows[filterZoneRegion as RegionZone].effectiveDate).toLocaleDateString('vi-VN')}`}
                  </div>
                </>
              ) : (
                <div className="text-[10.5px] text-amber-600 mt-1">KCN chưa gán vùng — gán ở tab <b>Khu vực</b></div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/40 px-3 py-2 min-w-[200px] flex items-center text-[11px] text-blue-700/90">
              Chọn 1 KCN để xem lương tối thiểu vùng của KCN đó · mỗi KCN 1 vùng riêng
            </div>
          )}
          {industryWageSummary.map(s => (
            <div key={s.industry} className="rounded-lg border border-[#E8E7E2] px-3 py-2 min-w-[160px]">
              <div className="text-[12px] font-medium text-[#222]">{s.industry}</div>
              <div className="text-[14px] font-semibold text-emerald-700 mt-0.5">{fmtTr(s.min)}–{fmtTr(s.max)}tr</div>
              <div className="text-[10.5px] text-[#999] mt-0.5">{s.count} nguồn · {s.names.join(', ')}{s.count > s.names.length ? '…' : ''}</div>
            </div>
          ))}
          {industryWageSummary.length === 0 && (
            <div className="text-[11.5px] text-[#aaa] px-1 py-2 self-center">
              {settings.srcProjects || settings.srcSurveys ? 'Chưa có ngành nghề nào có dữ liệu lương trong phạm vi đang lọc.' : 'Chưa chọn nguồn dữ liệu — mở "Tuỳ chọn" để bật.'}
            </div>
          )}
        </div>
      </div>
      <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2] flex-wrap gap-2">
          <div className="text-[12.5px] font-semibold text-[#111]">Lương thị trường theo khu vực & ngành nghề</div>
          <div className="flex items-center gap-2">
            <div className="flex border border-gray-300 rounded-lg overflow-hidden">
              <button onClick={() => setViewMode('list')} title="Dạng danh sách" className={`p-1.5 ${viewMode === 'list' ? 'bg-gray-100 text-[#111]' : 'text-[#999] hover:bg-gray-50'}`}><List size={14} /></button>
              <button onClick={() => setViewMode('card')} title="Dạng card (có ảnh cover)" className={`p-1.5 ${viewMode === 'card' ? 'bg-gray-100 text-[#111]' : 'text-[#999] hover:bg-gray-50'}`}><LayoutGrid size={14} /></button>
            </div>
            <button onClick={() => openAdd()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
              <Plus size={13} /> Thêm khảo sát
            </button>
          </div>
        </div>
        <div className="px-4 py-2 border-b border-[#E8E7E2] flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-[#888] shrink-0">Tỉnh/TP:</span>
          <SearchSelect
            value={provinceFilter}
            onChange={v => { setProvinceFilter(v); setZoneFilter('all'); }}
            options={[{ value: 'all', label: `Tất cả (${provinces.length})` }, ...provinces.map(p => ({ value: p, label: p }))]}
            className="w-52"
          />
          <span className="text-[12px] text-[#888] shrink-0">KCN:</span>
          <SearchSelect
            value={zoneFilter}
            onChange={setZoneFilter}
            options={[{ value: 'all', label: `Tất cả (${zonesInProvince.length})` }, ...zonesInProvince.map(z => ({ value: z, label: z }))]}
            className="w-64"
          />
          <span className="text-[12px] text-[#888] shrink-0">Ngành nghề:</span>
          <SearchSelect
            value={industryFilter}
            onChange={setIndustryFilter}
            options={[{ value: 'all', label: `Tất cả (${industries.length})` }, ...industries.map(i => ({ value: i, label: i }))]}
            className="w-52"
          />
          {industryFilter !== 'all' && (
            <button onClick={() => setIndustryFilter('all')} className="text-[11.5px] text-blue-600 hover:underline">Xoá lọc ngành</button>
          )}
        </div>
        {viewMode === 'list' && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-[#E8E7E2]">
              {['Khu vực / Ngành nghề', 'Phổ thông (tr)', 'Thời vụ (tr)', 'Chính thức (tr)', 'Nguồn LĐ', 'Lấp đầy', 'Ngày', ''].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {zonesToShow.map(zone => {
                const rows = marketSurveys.filter(s => s.zone_name === zone && matchesIndustry(s.industry));
                const clientLeadRows = (clientLeadRowsByZone.get(zone) ?? []).filter(e => matchesIndustry(e.industry));
                const isOfficial = officialZoneNames.has(zone);
                const zoneRegion = zoneToRegion[zone];
                return (
                  <Fragment key={zone}>
                    <tr className="bg-[#F9F9F7]">
                      <td colSpan={8} className="px-3 py-1.5 font-medium text-[11.5px]">
                        <span className="inline-flex items-center gap-2 flex-wrap">
                          {zone}
                          {regionZoneLabel(zoneRegion) ? (
                            <span className={`text-[10px] font-semibold w-6 h-4 inline-flex items-center justify-center rounded ${regionZoneColorCls(zoneRegion)}`}>{regionZoneLabel(zoneRegion)}</span>
                          ) : isOfficial ? (
                            <button onClick={() => goTab('zones', zone)} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100">⚠ chưa gán vùng</button>
                          ) : null}
                          {!isOfficial && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">⚠ không khớp KCN đã tạo</span>
                          )}
                          <button onClick={() => openAdd(zone)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] border border-[#E8E7E2] text-[#666] hover:bg-white"><Plus size={9} /> Thêm ngành</button>
                          {isOfficial ? (
                            <button onClick={() => goTab('zones', zone)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] border border-[#E8E7E2] text-[#666] hover:bg-white"><ExternalLink size={9} /> Hồ sơ KV</button>
                          ) : (
                            <button onClick={() => { setReassignZone(reassignZone === zone ? null : zone); setReassignValue(''); }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] border border-red-200 text-red-600 hover:bg-red-50"><Pencil size={9} /> Gộp vào KCN đúng</button>
                          )}
                        </span>
                        {reassignZone === zone && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <SearchSelect
                              value={reassignValue}
                              onChange={setReassignValue}
                              options={[...officialZoneNames].sort((a, b) => a.localeCompare(b, 'vi')).map(z => ({ value: z, label: z }))}
                              placeholder="Chọn KCN chính thức…"
                              className="w-56"
                            />
                            <button onClick={() => handleReassignZone(zone)} disabled={reassigning || !reassignValue.trim()} className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-blue-600 text-white disabled:opacity-40">{reassigning ? 'Đang gộp…' : 'Gộp'}</button>
                            <button onClick={() => setReassignZone(null)} className="text-[11px] px-2 py-1 rounded-lg border border-gray-300">Huỷ</button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {rows.length ? rows.map(d => (
                      <tr key={d.id} className="border-b border-[#F0EEE9] last:border-0">
                        <td className="px-3 py-2 pl-6">
                          {editIndustryId === d.id ? (
                            <div className="flex items-center gap-1.5">
                              <SearchSelect
                                value={editIndustryValue}
                                onChange={setEditIndustryValue}
                                options={industries.map(i => ({ value: i, label: i }))}
                                placeholder="Chọn ngành…"
                                allowAdd
                                onAdd={handleAddIndustry}
                                className="w-44"
                              />
                              <button onClick={() => handleSaveIndustry(d.id)} className="text-emerald-600 hover:text-emerald-700"><Check size={13} /></button>
                              <button onClick={() => setEditIndustryId(null)} className="text-[#aaa] hover:text-red-500"><X size={13} /></button>
                            </div>
                          ) : (
                            <span className={`inline-flex items-center gap-1.5 group ${d.industry ? 'text-[#333]' : 'text-amber-600'}`}>
                              └ {d.industry || 'Chưa gán ngành nghề'}
                              <button onClick={() => startEditIndustry(d.id, d.industry)} className="opacity-40 group-hover:opacity-100 text-[#999] hover:text-blue-600 transition"><Pencil size={11} /></button>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{fmtTr(d.wage_unskilled_min)}–{fmtTr(d.wage_unskilled_max)}tr</td>
                        <td className="px-3 py-2 text-blue-700 font-medium">{fmtTr(d.wage_seasonal_min)}–{fmtTr(d.wage_seasonal_max)}tr</td>
                        <td className="px-3 py-2 text-emerald-700 font-medium">{fmtTr(d.wage_skilled_min)}–{fmtTr(d.wage_skilled_max)}tr</td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${availPillCls(d.labor_availability)}`}>{d.labor_availability}</span></td>
                        <td className="px-3 py-2">{d.occupancy || '—'}</td>
                        <td className="px-3 py-2 text-[11px] text-[#aaa]">{new Date(d.survey_date).toLocaleDateString('vi-VN')}</td>
                        <td className="px-3 py-2"><button onClick={() => handleDelete(d.id)} className="text-[#aaa] hover:text-red-500"><Trash2 size={12} /></button></td>
                      </tr>
                    )) : null}
                    {clientLeadRows.map((e, i) => (
                      <tr key={`cl-${zone}-${i}`} className="border-b border-[#F0EEE9] last:border-0 bg-blue-50/30">
                        <td className="px-3 py-2 pl-6">
                          <span className="inline-flex items-center gap-1.5 text-[#333]">
                            └ {e.industry}
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">{e.name}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[#ccc]">—</td>
                        <td className="px-3 py-2 text-[#ccc]">—</td>
                        <td className="px-3 py-2 text-emerald-700 font-medium">{fmtTr(e.wageMin)}–{fmtTr(e.wageMax)}tr</td>
                        <td colSpan={4} className="px-3 py-2 text-[11px] text-[#aaa]">Từ Công ty/Dự án</td>
                      </tr>
                    ))}
                    {rows.length === 0 && clientLeadRows.length === 0 && (
                      <tr><td colSpan={8} className="px-3 py-2 pl-6 text-[#aaa] text-[11.5px]">Chưa có dữ liệu lương cho khu vực này</td></tr>
                    )}
                  </Fragment>
                );
              })}
              {zonesToShow.length === 0 && (
                <tr><td colSpan={8} className="text-center py-6 text-[#aaa]">Chưa có khảo sát lương nào</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        {viewMode === 'card' && (
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {zonesToShow.map(zone => {
            const rows = marketSurveys.filter(s => s.zone_name === zone && matchesIndustry(s.industry));
            const clientLeadRows = (clientLeadRowsByZone.get(zone) ?? []).filter(e => matchesIndustry(e.industry));
            const isOfficial = officialZoneNames.has(zone);
            const img = zoneToImage[zone];
            return (
              <div key={zone} className="bg-white border border-[#E8E7E2] rounded-[12px] overflow-hidden">
                {img ? (
                  <div className="h-32 w-full overflow-hidden bg-gray-100">
                    <img src={img} alt={zone} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="h-32 w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                    <ImageIcon size={20} className="text-[#ccc]" />
                  </div>
                )}
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-[#111] truncate">{zone}</div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {zoneToProvince[zone] && (
                          <span className="text-[10.5px] text-[#888] flex items-center gap-1"><MapPin size={10} /> {zoneToProvince[zone]}</span>
                        )}
                        {regionZoneLabel(zoneToRegion[zone]) && (
                          <span className={`text-[10px] font-semibold w-6 h-4 inline-flex items-center justify-center rounded ${regionZoneColorCls(zoneToRegion[zone])}`}>{regionZoneLabel(zoneToRegion[zone])}</span>
                        )}
                      </div>
                    </div>
                    {isOfficial ? (
                      <button onClick={() => goTab('zones', zone)} className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] border border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]"><ExternalLink size={9} /> Hồ sơ</button>
                    ) : (
                      <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">⚠ chưa khớp KCN</span>
                    )}
                  </div>
                  <div className="mt-2.5 pt-2.5 border-t border-gray-100 space-y-1.5">
                    {rows.map(d => (
                      <div key={d.id} className="flex items-center justify-between text-[11px]">
                        <span className="text-[#666] truncate mr-2">{d.industry || 'Chưa gán ngành'}</span>
                        <span className="shrink-0 text-emerald-700 font-medium">{fmtTr(d.wage_skilled_min)}–{fmtTr(d.wage_skilled_max)}tr</span>
                      </div>
                    ))}
                    {clientLeadRows.map((e, i) => (
                      <div key={`cl-${i}`} className="flex items-center justify-between text-[11px]">
                        <span className="text-[#666] truncate mr-2">{e.industry} <span className="text-[9.5px] px-1 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">{e.name}</span></span>
                        <span className="shrink-0 text-emerald-700 font-medium">{fmtTr(e.wageMin)}–{fmtTr(e.wageMax)}tr</span>
                      </div>
                    ))}
                    {rows.length === 0 && clientLeadRows.length === 0 && (
                      <div className="text-[11px] text-[#aaa]">Chưa có dữ liệu lương</div>
                    )}
                  </div>
                  <button onClick={() => openAdd(zone)} className="mt-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] border border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]"><Plus size={9} /> Thêm ngành</button>
                </div>
              </div>
            );
          })}
          {zonesToShow.length === 0 && (
            <div className="col-span-full text-center py-6 text-[#aaa] text-[12px]">Chưa có khảo sát lương nào</div>
          )}
        </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#111] flex items-center gap-1.5"><Coins size={15} /> Thêm khảo sát lương</h2>
              <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Khu vực *</label>
                <SearchSelect
                  value={form.zone_name}
                  onChange={v => setForm(f => ({ ...f, zone_name: v }))}
                  options={zoneNames.map(z => ({ value: z, label: z }))}
                  placeholder="Chọn KCN…"
                />
              </div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ngành nghề *</label>
                <SearchSelect
                  value={form.industry}
                  onChange={v => setForm(f => ({ ...f, industry: v }))}
                  options={industries.map(i => ({ value: i, label: i }))}
                  placeholder="Chọn ngành…"
                  allowAdd
                  onAdd={handleAddIndustry}
                />
              </div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">PT từ (tr)</label>
                <input type="number" step="0.1" value={form.pt_min} onChange={e => setForm(f => ({ ...f, pt_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">PT đến (tr)</label>
                <input type="number" step="0.1" value={form.pt_max} onChange={e => setForm(f => ({ ...f, pt_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Thời vụ từ (tr)</label>
                <input type="number" step="0.1" value={form.tv_min} onChange={e => setForm(f => ({ ...f, tv_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Thời vụ đến (tr)</label>
                <input type="number" step="0.1" value={form.tv_max} onChange={e => setForm(f => ({ ...f, tv_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Chính thức từ (tr)</label>
                <input type="number" step="0.1" value={form.ct_min} onChange={e => setForm(f => ({ ...f, ct_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Chính thức đến (tr)</label>
                <input type="number" step="0.1" value={form.ct_max} onChange={e => setForm(f => ({ ...f, ct_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nguồn LĐ</label>
                <select value={form.labor_availability} onChange={e => setForm(f => ({ ...f, labor_availability: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  {LABOR_AVAIL_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lấp đầy (%)</label>
                <input value={form.occupancy} onChange={e => setForm(f => ({ ...f, occupancy: e.target.value }))} placeholder="90%" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ngày khảo sát</label>
                <input type="date" value={form.survey_date} onChange={e => setForm(f => ({ ...f, survey_date: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Hủy</button>
              <button onClick={handleAdd} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
