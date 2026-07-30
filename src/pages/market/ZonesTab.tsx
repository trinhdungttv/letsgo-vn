import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, Bubble } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, Tooltip, Legend,
} from 'chart.js';
import { Plus, ArrowLeft, Check, Building2, Users, MapPin, Coins, Eye, FileText, X, LayoutGrid, List, Image as ImageIcon, GripVertical, Settings, RotateCcw, Pencil, Trash2, MoreVertical } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { MarketZone } from '../../lib/types';
import { fmtTr, occColor, availPillCls, LABOR_AVAIL_OPTIONS, type MarketTabProps } from './shared';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, Tooltip, Legend);

const CHART_COLORS = ['#1D4ED8', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#4F46E5', '#0D9488', '#9333EA'];

// Cùng ngưỡng với occColor() ở shared.ts, chỉ đổi sang mã hex cho Chart.js.
const occColorHex = (occ: number | null | undefined) => {
  const o = occ ?? 0;
  return o >= 90 ? '#10B981' : o >= 75 ? '#F59E0B' : '#EF4444';
};

// Bật/tắt từng biểu đồ tổng quan ở dashboard khu vực — lưu localStorage, không cần migration.
// Mặc định chỉ bật "Tỷ lệ lấp đầy" (giá trị cao, ít rối mắt nhất), 3 cái còn lại tắt sẵn.
interface ZoneDashSettings {
  occupancyBar: boolean;
  shareBar: boolean;
  opportunityMatrix: boolean;
  provinceBar: boolean;
}
const ZONE_DASH_SETTINGS_KEY = 'market_zones_dash_settings';
const DEFAULT_ZONE_DASH_SETTINGS: ZoneDashSettings = { occupancyBar: true, shareBar: false, opportunityMatrix: false, provinceBar: false };
const loadZoneDashSettings = (): ZoneDashSettings => {
  try {
    const raw = localStorage.getItem(ZONE_DASH_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_ZONE_DASH_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_ZONE_DASH_SETTINGS };
};
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import FilterDropdown, { ALL_OPTION } from '../../components/FilterDropdown';
import { KCNVisitHistory } from '../../components/workspace/KCNVisitHistory';
import { useProvinces } from '../../hooks/useProvinces';
import { parseLatLngFromLink, isValidVnLatLng } from '../../lib/geo';
import { fetchIndustries, addIndustry } from './industries';
import { fetchCountries, addCountry } from './countries';
import SearchSelect from './SearchSelect';
import RichTextEditor from './RichTextEditor';
import { REGION_ZONES, regionZoneLabel, regionZoneColorCls } from './regionWage';
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning';

function normalizeZoneName(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

const emptyAddForm = {
  name: '', full_name: '', location: '', operator: '', area: '', established_year: '',
  total_companies: '', total_workers: '', occupancy_pct: '', labor_availability: 'Trung bình', characteristics: '',
  map_link: '',
};

// Chọn nhiều giá trị từ 1 nguồn dữ liệu chung (ngành nghề / quốc gia…) — gõ để tìm hoặc
// thêm mới ngay nếu chưa có, tránh gõ tay tự do gây trùng lặp/không đồng bộ giữa các nơi.
function MultiPicker({ tags, options, onAdd, onRemove, onAddOption, color, placeholder }: {
  tags: string[];
  options: string[];
  onAdd: (v: string) => void;
  onRemove: (i: number) => void;
  onAddOption: (v: string) => void | Promise<void>;
  color: string;
  placeholder: string;
}) {
  return (
    <div className="flex-1 flex flex-wrap gap-1.5 items-center">
      {tags.map((t, i) => (
        <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${color}`}>
          {t}
          <button onClick={() => onRemove(i)} className="hover:opacity-70"><X size={10} /></button>
        </span>
      ))}
      <SearchSelect
        value=""
        onChange={onAdd}
        options={options.filter(o => !tags.includes(o)).map(o => ({ value: o, label: o }))}
        placeholder={placeholder}
        allowAdd
        onAdd={onAddOption}
        className="w-44"
      />
    </div>
  );
}

export default function ZonesTab({ marketZones, marketSurveys, clients, goTab, onRefresh, toast }: MarketTabProps) {
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<MarketZone> | null>(null);
  const [initialEditForm, setInitialEditForm] = useState<Partial<MarketZone> | null>(null);
  const [activeProvinces, setActiveProvinces] = useState<string[]>([ALL_OPTION]);
  const [viewMode, setViewMode] = useState<'list' | 'card'>(() => (localStorage.getItem('market_zones_view_mode') as 'list' | 'card') || 'list');
  useEffect(() => { localStorage.setItem('market_zones_view_mode', viewMode); }, [viewMode]);
  const [dashSettings, setDashSettings] = useState<ZoneDashSettings>(loadZoneDashSettings);
  const [showDashSettings, setShowDashSettings] = useState(false);
  const [showZoneMenu, setShowZoneMenu] = useState(false);
  useEffect(() => { localStorage.setItem(ZONE_DASH_SETTINGS_KEY, JSON.stringify(dashSettings)); }, [dashSettings]);

  // Chia đôi khối "Thông tin khu vực" thành 2 cột kéo được chiều ngang — tỉ lệ lưu
  // localStorage để F5 không mất (cùng pattern với LeadsTab).
  const infoSplitRef = useRef<HTMLDivElement>(null);
  const [infoLeftPct, setInfoLeftPct] = useState<number>(() => {
    const saved = Number(localStorage.getItem('market_zone_info_split_pct'));
    return saved >= 20 && saved <= 80 ? saved : 50;
  });
  const [infoDragging, setInfoDragging] = useState(false);
  useEffect(() => {
    if (!infoDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!infoSplitRef.current) return;
      const rect = infoSplitRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setInfoLeftPct(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => setInfoDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [infoDragging]);
  useEffect(() => { localStorage.setItem('market_zone_info_split_pct', String(infoLeftPct)); }, [infoLeftPct]);

  // Kéo ảnh cover để chỉnh object-position — cùng cơ chế với Đối thủ (CompetitorDetail); khung
  // xem trước cao h-36 khớp đúng chiều cao thumbnail thẻ KCN thật (ZonesTab card view).
  const imgBoxRef = useRef<HTMLDivElement>(null);
  const [draggingImg, setDraggingImg] = useState(false);
  const handleImgDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingImg(true);
    const box = imgBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const dxPct = (ev.movementX / rect.width) * 100;
      const dyPct = (ev.movementY / rect.height) * 100;
      setEditForm(f => f && ({
        ...f,
        image_pos_x: Math.min(100, Math.max(0, (f.image_pos_x ?? 50) - dxPct)),
        image_pos_y: Math.min(100, Math.max(0, (f.image_pos_y ?? 50) - dyPct)),
      }));
    };
    const onUp = () => {
      setDraggingImg(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const selected = marketZones.find(z => z.id === selectedId) || null;
  const { provinces: sharedProvinces, addProvince } = useProvinces(marketZones);
  const provinceOptions = sharedProvinces;
  const provinceNames = [ALL_OPTION, ...provinceOptions];
  const filteredZones = marketZones.filter(z => activeProvinces.includes(ALL_OPTION) || activeProvinces.includes(z.location || ''));

  // Đề xuất #1 — Tỷ lệ lấp đầy theo khu vực, xếp giảm dần.
  const occupancyChartData = useMemo(() =>
    [...filteredZones].sort((a, b) => (b.occupancy_pct ?? 0) - (a.occupancy_pct ?? 0)),
  [filteredZones]);

  // Đề xuất #2 — Thị phần LĐ của mình / tổng LĐ toàn khu, xếp giảm dần.
  const shareChartData = useMemo(() =>
    filteredZones.map(z => ({
      name: z.name,
      share: z.total_workers ? Math.round((z.lgv_workers / z.total_workers) * 100) : 0,
      lgv_workers: z.lgv_workers, total_workers: z.total_workers ?? 0,
    })).sort((a, b) => b.share - a.share),
  [filteredZones]);

  // Đề xuất #3 — Ma trận cơ hội: X = mức tiềm năng (★), Y = thị phần %, kích thước = tổng LĐ toàn khu.
  const matrixData = useMemo(() =>
    filteredZones.map((z, i) => ({
      name: z.name,
      x: z.potential || 0,
      y: z.total_workers ? Math.round((z.lgv_workers / z.total_workers) * 100) : 0,
      r: Math.max(6, Math.sqrt(z.total_workers ?? 0) / 4 + 6),
      color: CHART_COLORS[i % CHART_COLORS.length],
    })),
  [filteredZones]);

  // Đề xuất #4 — Tổng LĐ theo tỉnh/thành, xếp giảm dần.
  const provinceChartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const z of filteredZones) {
      const key = z.location || 'Chưa rõ';
      map.set(key, (map.get(key) ?? 0) + (z.total_workers ?? 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filteredZones]);

  const [industryOptions, setIndustryOptions] = useState<string[]>([]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  useEffect(() => {
    fetchIndustries(marketZones.flatMap(z => z.industries || [])).then(setIndustryOptions);
    fetchCountries(marketZones.flatMap(z => z.countries || [])).then(setCountryOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddIndustryOption = async (name: string) => {
    const err = await addIndustry(name);
    if (err) toast('Lỗi thêm ngành: ' + err);
    setIndustryOptions(prev => [...new Set([...prev, name])].sort((a, b) => a.localeCompare(b, 'vi')));
  };
  const handleAddCountryOption = async (name: string) => {
    const err = await addCountry(name);
    if (err) toast('Lỗi thêm quốc gia: ' + err);
    setCountryOptions(prev => [...new Set([...prev, name])].sort((a, b) => a.localeCompare(b, 'vi')));
  };

  useEffect(() => {
    if (selected) {
      const snapshot = {
        location: selected.location,
        operator: selected.operator, area: selected.area, established_year: selected.established_year,
        characteristics: selected.characteristics, strengths: selected.strengths, weaknesses: selected.weaknesses,
        labor_availability: selected.labor_availability, lgv_clients: selected.lgv_clients, lgv_workers: selected.lgv_workers,
        notes: selected.notes, industries: selected.industries || [], countries: selected.countries || [],
        map_link: selected.map_link ?? null,
        image_url: selected.image_url ?? null,
        image_fit: selected.image_fit ?? 'cover',
        image_pos_x: selected.image_pos_x ?? 50,
        image_pos_y: selected.image_pos_y ?? 50,
        region_zone: selected.region_zone ?? null,
        overview_notes: selected.overview_notes ?? '',
      };
      setEditForm(snapshot);
      setInitialEditForm(snapshot);
    } else {
      setEditForm(null);
      setInitialEditForm(null);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cảnh báo F5/đóng tab khi hồ sơ khu vực đang sửa mà chưa bấm "Lưu".
  const zoneDirty = editForm != null && initialEditForm != null && JSON.stringify(editForm) !== JSON.stringify(initialEditForm);
  useBeforeUnloadWarning(zoneDirty);

  const handleAddZone = async () => {
    const name = addForm.name.trim();
    if (!name) { toast('Nhập tên khu vực'); return; }

    const normalizedNew = normalizeZoneName(name);
    const exactDup = marketZones.find(z => normalizeZoneName(z.name) === normalizedNew);
    if (exactDup) {
      toast(`Tên "${name}" đã tồn tại (trùng với "${exactDup.name}") — vui lòng đặt tên khác`);
      return;
    }
    const similar = marketZones.find(z => {
      const n = normalizeZoneName(z.name);
      return levenshtein(n, normalizedNew) <= 2;
    });
    if (similar) {
      const proceed = confirm(`Tên "${name}" gần giống với khu vực đã có "${similar.name}". Bạn có chắc đây không phải trùng lặp và muốn tạo khu vực mới?`);
      if (!proceed) return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.from('market_zones').insert({
        name,
        full_name: addForm.full_name || null,
        location: addForm.location || null,
        operator: addForm.operator || null,
        area: addForm.area || null,
        established_year: addForm.established_year || null,
        total_companies: parseInt(addForm.total_companies) || 0,
        total_workers: parseInt(addForm.total_workers) || 0,
        occupancy_pct: parseInt(addForm.occupancy_pct) || 0,
        labor_availability: addForm.labor_availability,
        characteristics: addForm.characteristics || null,
        map_link: addForm.map_link.trim() || null,
        ...(() => {
          // Dán link Google Maps → tự sinh toạ độ cho tab Bản đồ
          const p = parseLatLngFromLink(addForm.map_link);
          return isValidVnLatLng(p) ? { lat: p.lat, lng: p.lng, geocoded_at: new Date().toISOString() } : {};
        })(),
      }).select().single();
      if (error) throw error;
      await logActivity({
        user, action: 'insert', table: 'market_zones', recordId: data.id,
        description: `Thêm hồ sơ khu vực "${name}"`,
        newData: data,
      });
      await onRefresh();
      setShowAdd(false);
      setAddForm(emptyAddForm);
      toast('Đã tạo hồ sơ khu vực!');
    } catch (e: any) {
      if (e.message?.includes('duplicate key value violates unique constraint')) {
        toast(`Tên "${name}" đã tồn tại — vui lòng đặt tên khác`);
      } else {
        toast('Lỗi: ' + e.message);
      }
    }
    setSaving(false);
  };

  const handleSaveZone = async () => {
    if (!selected || !editForm) return;
    setSaving(true);
    try {
      // Dán link Google Maps → tự sinh toạ độ; xoá link (khi trước đó có) → xoá toạ độ đi kèm
      const mapPos = parseLatLngFromLink(editForm.map_link);
      const linkCleared = !(editForm.map_link ?? '').trim() && !!selected.map_link;
      const updates = {
        ...editForm,
        map_link: (editForm.map_link ?? '').trim() || null,
        ...(isValidVnLatLng(mapPos)
          ? { lat: mapPos.lat, lng: mapPos.lng, geocoded_at: new Date().toISOString() }
          : linkCleared ? { lat: null, lng: null, geocoded_at: null } : {}),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('market_zones').update(updates).eq('id', selected.id);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'market_zones', recordId: selected.id,
        description: `Cập nhật hồ sơ khu vực "${selected.name}"`,
        oldData: selected, newData: { ...selected, ...updates },
      });
      await onRefresh();
      setInitialEditForm(editForm);
      toast('Đã lưu hồ sơ: ' + selected.name);
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  // Đổi tên KCN — vì tên KCN được nhiều nơi khác lưu dưới dạng CHỮ (không phải FK), đổi
  // tên ở đây phải cập nhật lại các nơi đang khớp đúng theo tên cũ, nếu không dữ liệu ở đó
  // sẽ "rơi mất" (không còn khớp với KCN nào, dù dữ liệu gốc vẫn còn).
  const handleRenameZone = async () => {
    if (!selected) return;
    const input = prompt('Tên khu vực mới:', selected.full_name || selected.name);
    if (input == null) return;
    const name = input.trim();
    if (!name || name === selected.name) return;

    const normalizedNew = normalizeZoneName(name);
    const exactDup = marketZones.find(z => z.id !== selected.id && normalizeZoneName(z.name) === normalizedNew);
    if (exactDup) { toast(`Tên "${name}" đã tồn tại (trùng với "${exactDup.name}") — vui lòng đặt tên khác`); return; }

    setSaving(true);
    try {
      const oldName = selected.name;
      const { error } = await supabase.from('market_zones').update({ name, updated_at: new Date().toISOString() }).eq('id', selected.id);
      if (error) throw error;

      // Cập nhật các nơi khác đang lưu đúng tên cũ (so khớp tuyệt đối) — không đụng tới
      // các giá trị gõ tay gần giống nhưng không khớp tuyệt đối (an toàn hơn, tránh sửa nhầm).
      await Promise.all([
        supabase.from('market_surveys').update({ zone_name: name }).eq('zone_name', oldName),
        supabase.from('competitors').update({ zone_name: name }).eq('zone_name', oldName),
        supabase.from('market_leads').update({ region: name }).eq('region', oldName),
        supabase.from('clients').update({ region: name }).eq('region', oldName),
        ...clients.filter(c => c.industrial_zones?.includes(oldName)).map(c =>
          supabase.from('clients').update({ industrial_zones: c.industrial_zones.map(z => z === oldName ? name : z) }).eq('id', c.id),
        ),
      ]);

      await logActivity({
        user, action: 'update', table: 'market_zones', recordId: selected.id,
        description: `Đổi tên khu vực "${oldName}" → "${name}"`,
        oldData: selected, newData: { ...selected, name },
      });
      await onRefresh();
      setShowZoneMenu(false);
      toast(`Đã đổi tên thành "${name}"`);
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  // Xoá KCN — market_zones.id là FK thật của kcn_visits (ON DELETE CASCADE, sẽ mất theo)
  // và payroll_calculator/region_price_comparison (ON DELETE SET NULL, chỉ gỡ liên kết,
  // không mất dữ liệu). Cảnh báo rõ số lượng bản ghi liên quan trước khi xoá thật.
  const handleDeleteZone = async () => {
    if (!selected) return;
    setShowZoneMenu(false);
    try {
      const [{ count: surveyCount }, { count: compCount }, { count: visitCount }] = await Promise.all([
        supabase.from('market_surveys').select('id', { count: 'exact', head: true }).eq('zone_name', selected.name),
        supabase.from('competitors').select('id', { count: 'exact', head: true }).eq('zone_name', selected.name),
        supabase.from('kcn_visits').select('id', { count: 'exact', head: true }).eq('zone_id', selected.id),
      ]);
      const clientCount = clients.filter(c => c.industrial_zones?.includes(selected.name)).length;

      const parts: string[] = [];
      if (visitCount) parts.push(`${visitCount} lịch sử khảo sát KCN (sẽ xoá vĩnh viễn)`);
      if (surveyCount) parts.push(`${surveyCount} lần khảo sát lương đang gắn tên KCN này (không xoá, chỉ không còn khớp KCN)`);
      if (compCount) parts.push(`${compCount} đối thủ đang gắn KCN này`);
      if (clientCount) parts.push(`${clientCount} khách hàng đang gắn KCN này (sẽ tự gỡ khỏi hồ sơ họ)`);
      const warning = parts.length ? `\n\nDữ liệu liên quan:\n- ${parts.join('\n- ')}` : '';
      if (!confirm(`Xoá vĩnh viễn khu vực "${selected.name}"? Không thể hoàn tác.${warning}`)) return;

      setSaving(true);
      // Gỡ tên KCN khỏi thẻ "Khu vực" của các khách hàng đang gắn — tránh để lại tag rác
      // trỏ tới 1 KCN không còn tồn tại.
      await Promise.all(
        clients.filter(c => c.industrial_zones?.includes(selected.name)).map(c =>
          supabase.from('clients').update({ industrial_zones: c.industrial_zones.filter(z => z !== selected.name) }).eq('id', c.id),
        ),
      );

      const { error } = await supabase.from('market_zones').delete().eq('id', selected.id);
      if (error) throw error;
      await logActivity({
        user, action: 'delete', table: 'market_zones', recordId: selected.id,
        description: `Xoá khu vực "${selected.name}"`,
        oldData: selected,
      });
      setSelectedId(null);
      await onRefresh();
      toast(`Đã xoá khu vực "${selected.name}"`);
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleSetPotential = async (n: number) => {
    if (!selected) return;
    try {
      const { error } = await supabase.from('market_zones').update({ potential: n, updated_at: new Date().toISOString() }).eq('id', selected.id);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'market_zones', recordId: selected.id,
        description: `Cập nhật mức độ tiềm năng khu vực "${selected.name}" thành ${n} sao`,
        oldData: selected, newData: { ...selected, potential: n },
      });
      await onRefresh();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  if (selected && editForm) {
    const sh = selected.total_workers ? Math.round((selected.lgv_workers / selected.total_workers) * 100) : 0;
    const wageRows = marketSurveys.filter(s => s.zone_name === selected.name);
    const zoneClients = clients.filter(c => c.industrial_zones?.includes(selected.name));
    const contractStatus = (c: typeof clients[number]) => {
      if (!c.contract_end) return { label: 'Đang hiệu lực', cls: 'bg-emerald-50 text-emerald-700' };
      return new Date(c.contract_end) >= new Date()
        ? { label: 'Đang hiệu lực', cls: 'bg-emerald-50 text-emerald-700' }
        : { label: 'Hết hạn', cls: 'bg-red-50 text-red-700' };
    };
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => setSelectedId(null)} className="p-1.5 rounded-lg border border-[#E8E7E2] hover:bg-[#F9F9F7]"><ArrowLeft size={14} /></button>
          <div>
            <div className="text-[13px] font-semibold text-[#111] flex items-center gap-2">
              {selected.full_name || selected.name}
              {regionZoneLabel(selected.region_zone) && (
                <span className={`text-[10.5px] font-semibold w-7 h-5 inline-flex items-center justify-center rounded ${regionZoneColorCls(selected.region_zone)}`}>
                  {regionZoneLabel(selected.region_zone)}
                </span>
              )}
            </div>
            <div className="text-[11px] text-[#888]">{selected.location || '—'}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map(i => (
                <button key={i} onClick={() => handleSetPotential(i)} className="text-[16px] leading-none">
                  <span className={i <= selected.potential ? 'text-amber-400' : 'text-gray-300'}>★</span>
                </button>
              ))}
            </div>
            <button onClick={handleSaveZone} disabled={saving} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-60">
              <Check size={13} /> {saving ? 'Đang lưu...' : 'Lưu'}
            </button>
            <div className="relative">
              <button onClick={() => setShowZoneMenu(v => !v)} title="Đổi tên / Xoá khu vực" className={`p-1.5 rounded-lg border transition ${showZoneMenu ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]'}`}>
                <MoreVertical size={14} />
              </button>
              {showZoneMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowZoneMenu(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-20 w-48 bg-white border border-[#E8E7E2] rounded-[10px] shadow-xl py-1">
                    <button onClick={handleRenameZone} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[#333] hover:bg-[#F9F9F7] text-left">
                      <Pencil size={12} /> Đổi tên khu vực
                    </button>
                    <button onClick={handleDeleteZone} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 text-left">
                      <Trash2 size={12} /> Xoá khu vực
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => goTab('wage', selected.name)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]"><Coins size={11} /> Lương khu vực này</button>
          <button onClick={() => goTab('comp', selected.name)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]"><Eye size={11} /> Đối thủ tại đây</button>
          <button onClick={() => goTab('leads', selected.name)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]"><Building2 size={11} /> Công ty trong KCN</button>
          <button onClick={() => goTab('quote', selected.name)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]"><FileText size={11} /> Tạo báo giá</button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <div className="bg-[#F9F9F7] rounded-lg px-3 py-2"><div className="text-[10.5px] text-[#888]">Số công ty</div><div className="text-[16px] font-medium">{selected.total_companies ?? 0}</div><div className="text-[10.5px] text-[#aaa]">FDI: {selected.fdi_companies ?? 0}</div></div>
          <div className="bg-[#F9F9F7] rounded-lg px-3 py-2"><div className="text-[10.5px] text-[#888]">Tổng LĐ</div><div className="text-[16px] font-medium text-blue-700">{(selected.total_workers ?? 0).toLocaleString('vi-VN')}</div><div className="text-[10.5px] text-[#aaa]">Toàn KCN</div></div>
          <div className="bg-[#F9F9F7] rounded-lg px-3 py-2"><div className="text-[10.5px] text-[#888]">Lấp đầy</div><div className={`text-[16px] font-medium ${occColor(selected.occupancy_pct).split(' ')[0]}`}>{selected.occupancy_pct ?? 0}%</div><div className="text-[10.5px] text-[#aaa]">{selected.area || '—'}</div></div>
          <div className="bg-[#F9F9F7] rounded-lg px-3 py-2 border-l-[3px] border-blue-500"><div className="text-[10.5px] text-[#888]">P. Kinh Doanh</div><div className="text-[16px] font-medium text-blue-700">{selected.lgv_workers} LĐ</div><div className="text-[10.5px] text-[#aaa]">{selected.lgv_clients} KH · {sh}%</div></div>
        </div>

        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Thông tin khu vực <span className="text-[11px] font-normal text-[#aaa]">· Click ô để sửa</span></div>
          <div ref={infoSplitRef} className={`p-4 flex items-start ${infoDragging ? 'select-none' : ''}`}>
            <div className="space-y-2.5 min-w-0" style={{ width: `${infoLeftPct}%` }}>
              <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0">Tỉnh / Thành phố</span>
                <select value={editForm.location || ''} onChange={e => {
                  if (e.target.value === '__new__') {
                    const v = prompt('Nhập tên Tỉnh/Thành phố mới:');
                    if (v && v.trim()) { addProvince(v.trim()); setEditForm(f => ({ ...f, location: v.trim() })); }
                    return;
                  }
                  setEditForm(f => ({ ...f, location: e.target.value || null }));
                }} className="text-[12.5px] px-2 py-1 rounded border border-gray-200 outline-none bg-white min-w-0 flex-1">
                  <option value="">—</option>
                  {provinceOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  <option value="__new__">+ Thêm tỉnh/thành mới…</option>
                </select>
              </div>
              <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0">Vùng lương tối thiểu</span>
                <select value={editForm.region_zone || ''} onChange={e => setEditForm(f => ({ ...f, region_zone: e.target.value || null }))} className="text-[12.5px] px-2 py-1 rounded border border-gray-200 outline-none bg-white min-w-0 flex-1">
                  <option value="">— Chưa gán vùng —</option>
                  {REGION_ZONES.map(z => <option key={z.key} value={z.key}>{z.label} · Vùng {z.key}</option>)}
                </select>
                {regionZoneLabel(editForm.region_zone) && (
                  <span className={`text-[10.5px] font-semibold w-7 h-5 inline-flex items-center justify-center rounded shrink-0 ${regionZoneColorCls(editForm.region_zone)}`}>
                    {regionZoneLabel(editForm.region_zone)}
                  </span>
                )}
              </div>
              <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0">Google Maps</span>
                <div className="flex gap-1.5 flex-1 min-w-0 items-center">
                  <input value={editForm.map_link || ''} onChange={e => setEditForm(f => ({ ...f, map_link: e.target.value }))}
                    title={editForm.map_link || ''} placeholder="Dán link → tự định vị lên Bản đồ"
                    className="text-[12.5px] flex-1 min-w-0 truncate px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7]" />
                  {editForm.map_link && (
                    <a href={editForm.map_link} target="_blank" rel="noopener noreferrer" title="Mở link"
                      className="p-1 rounded border border-gray-300 text-[#666] hover:bg-[#F5F4EF] transition shrink-0">
                      <MapPin size={11} />
                    </a>
                  )}
                  {selected.lat != null && selected.lng != null && (
                    <span title="Đã định vị" className="text-emerald-600 shrink-0 text-[11px]">✓</span>
                  )}
                </div>
              </div>
              <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0">Ảnh cover</span>
                <div className="flex gap-1.5 flex-1 min-w-0 items-center">
                  <input value={editForm.image_url || ''} onChange={e => setEditForm(f => ({ ...f, image_url: e.target.value }))}
                    title={editForm.image_url || ''} placeholder="Dán link ảnh cổng KCN…"
                    className="text-[12.5px] flex-1 min-w-0 truncate px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7]" />
                  {editForm.image_url && (
                    <div className="w-8 h-8 rounded overflow-hidden border border-gray-200 shrink-0">
                      <img src={editForm.image_url} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              </div>
              {editForm.image_url && (
                <div className="flex gap-3"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0 pt-1">Chế độ hiển thị</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-1.5">
                      <button
                        type="button"
                        onClick={() => setEditForm(f => f && ({ ...f, image_fit: 'cover' }))}
                        className={`px-2 py-1 rounded-lg text-[10.5px] font-medium border transition ${editForm.image_fit !== 'contain' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-[#666] hover:bg-[#F9F9F7]'}`}
                      >
                        Lấp đầy (cắt ảnh)
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditForm(f => f && ({ ...f, image_fit: 'contain' }))}
                        className={`px-2 py-1 rounded-lg text-[10.5px] font-medium border transition ${editForm.image_fit === 'contain' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-[#666] hover:bg-[#F9F9F7]'}`}
                      >
                        Tự khớp (giữ nguyên ảnh)
                      </button>
                    </div>
                    <div
                      ref={imgBoxRef}
                      onMouseDown={editForm.image_fit === 'contain' ? undefined : handleImgDragStart}
                      className={`h-36 w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100 ${editForm.image_fit === 'contain' ? '' : draggingImg ? 'cursor-grabbing' : 'cursor-grab'}`}
                    >
                      <img
                        src={editForm.image_url}
                        alt=""
                        draggable={false}
                        className={`w-full h-full pointer-events-none select-none ${editForm.image_fit === 'contain' ? 'object-contain' : 'object-cover'}`}
                        style={{ objectPosition: `${editForm.image_pos_x ?? 50}% ${editForm.image_pos_y ?? 50}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10.5px] text-[#999]">
                        {editForm.image_fit === 'contain' ? 'Chế độ tự khớp: hiện toàn bộ ảnh, không cắt' : 'Kéo ảnh để chỉnh vị trí hiển thị — khung này đúng tỷ lệ thẻ thật'}
                      </span>
                      {editForm.image_fit !== 'contain' && (
                        <button onClick={() => setEditForm(f => f && ({ ...f, image_pos_x: 50, image_pos_y: 50 }))} className="inline-flex items-center gap-1 text-[10.5px] text-blue-600 hover:underline shrink-0">
                          <RotateCcw size={10} /> Về giữa
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0">Ban quản lý</span>
                <input value={editForm.operator || ''} onChange={e => setEditForm(f => ({ ...f, operator: e.target.value }))} className="text-[12.5px] flex-1 min-w-0 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7]" />
              </div>
              <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0">Diện tích · Năm TL</span>
                <div className="flex gap-1.5 flex-1 min-w-0 items-center">
                  <input value={editForm.area || ''} onChange={e => setEditForm(f => ({ ...f, area: e.target.value }))} className="text-[12.5px] w-16 min-w-0 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7]" />
                  <span className="text-[11px] text-[#999] shrink-0">Ha</span>
                  <input value={editForm.established_year || ''} onChange={e => setEditForm(f => ({ ...f, established_year: e.target.value }))} className="text-[12.5px] w-16 min-w-0 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7]" />
                  {(() => {
                    const y = parseInt(editForm.established_year || '', 10);
                    if (!y || y < 1900 || y > new Date().getFullYear()) return null;
                    return <span className="text-[11px] text-[#999] shrink-0">({new Date().getFullYear() - y} năm)</span>;
                  })()}
                </div>
              </div>
              <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0">Nguồn lao động</span>
                <select value={editForm.labor_availability} onChange={e => setEditForm(f => ({ ...f, labor_availability: e.target.value }))} className="text-[12.5px] px-2 py-1 rounded border border-gray-200 outline-none bg-white min-w-0 flex-1">
                  {LABOR_AVAIL_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden border-l-[3px] border-l-blue-500">
                <div className="px-4 py-2.5 border-b border-[#F0EEE9] flex items-center gap-1.5 text-[12.5px] font-semibold text-[#111]"><FileText size={13} className="text-blue-600" /> Tổng quan</div>
                <RichTextEditor
                  value={editForm.overview_notes || ''}
                  onChange={html => setEditForm(f => f && ({ ...f, overview_notes: html }))}
                  placeholder="Ghi tổng quan KCN — bất kỳ thông tin quan trọng nào bạn muốn lưu lại…"
                />
              </div>
            </div>

            <div
              onMouseDown={() => setInfoDragging(true)}
              className="relative w-3 shrink-0 self-stretch flex items-center justify-center cursor-col-resize group"
              title="Kéo để đổi chiều rộng"
            >
              <div className={`w-1 h-full min-h-[80px] rounded-full transition ${infoDragging ? 'bg-blue-400' : 'bg-[#E8E7E2] group-hover:bg-blue-300'}`} />
              <GripVertical size={12} className="absolute text-[#bbb] group-hover:text-blue-500 pointer-events-none" />
            </div>

            <div className="space-y-2.5 min-w-0" style={{ width: `${100 - infoLeftPct}%` }}>
              <div className="flex gap-3 items-start"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0 pt-1">Ngành nghề chủ yếu</span>
                <MultiPicker tags={editForm.industries || []} options={industryOptions} color="bg-blue-50 text-blue-700"
                  placeholder="+ chọn ngành nghề…" onAddOption={handleAddIndustryOption}
                  onAdd={v => setEditForm(f => ({ ...f, industries: [...(f?.industries || []), v] }))}
                  onRemove={i => setEditForm(f => ({ ...f, industries: (f?.industries || []).filter((_, idx) => idx !== i) }))} />
              </div>
              <div className="flex gap-3 items-start"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0 pt-1">FDI từ quốc gia</span>
                <MultiPicker tags={editForm.countries || []} options={countryOptions} color="bg-violet-50 text-violet-700"
                  placeholder="+ chọn quốc gia…" onAddOption={handleAddCountryOption}
                  onAdd={v => setEditForm(f => ({ ...f, countries: [...(f?.countries || []), v] }))}
                  onRemove={i => setEditForm(f => ({ ...f, countries: (f?.countries || []).filter((_, idx) => idx !== i) }))} />
              </div>
              <div className="flex gap-3 items-start"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0 pt-1">Đặc thù</span>
                <textarea value={editForm.characteristics || ''} onChange={e => setEditForm(f => ({ ...f, characteristics: e.target.value }))} rows={2} className="text-[12.5px] flex-1 min-w-0 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7] resize-y leading-relaxed" />
              </div>
              <div className="flex gap-3 items-start"><span className="text-[11.5px] text-emerald-600 w-[130px] shrink-0 pt-1">✓ Điểm mạnh</span>
                <textarea value={editForm.strengths || ''} onChange={e => setEditForm(f => ({ ...f, strengths: e.target.value }))} rows={2} className="text-[12.5px] flex-1 min-w-0 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7] resize-y leading-relaxed" />
              </div>
              <div className="flex gap-3 items-start"><span className="text-[11.5px] text-red-500 w-[130px] shrink-0 pt-1">✗ Điểm yếu</span>
                <textarea value={editForm.weaknesses || ''} onChange={e => setEditForm(f => ({ ...f, weaknesses: e.target.value }))} rows={2} className="text-[12.5px] flex-1 min-w-0 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7] resize-y leading-relaxed" />
              </div>
              <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0">P. Kinh Doanh</span>
                <div className="flex items-center gap-2 text-[12.5px] min-w-0">
                  <input type="number" value={editForm.lgv_clients ?? 0} onChange={e => setEditForm(f => ({ ...f, lgv_clients: parseInt(e.target.value) || 0 }))} className="w-14 min-w-0 px-2 py-1 rounded border border-gray-200 outline-none" /> KH ·
                  <input type="number" value={editForm.lgv_workers ?? 0} onChange={e => setEditForm(f => ({ ...f, lgv_workers: parseInt(e.target.value) || 0 }))} className="w-16 min-w-0 px-2 py-1 rounded border border-gray-200 outline-none" /> LĐ
                </div>
              </div>
              <div className="flex gap-3 items-start"><span className="text-[11.5px] text-[#888] w-[130px] shrink-0 pt-1">Ghi chú chiến lược</span>
                <textarea value={editForm.notes || ''} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="text-[12.5px] flex-1 min-w-0 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7] resize-y leading-relaxed" />
              </div>
            </div>
          </div>
        </div>

        <KCNVisitHistory zoneId={selected.id} zoneName={selected.name} toast={toast} onChanged={onRefresh} />

        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111] flex items-center gap-1.5"><Coins size={12} /> Lương theo ngành tại khu vực này</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-[#E8E7E2]">
                {['Ngành nghề', 'Phổ thông (tr)', 'Thời vụ (tr)', 'Chính thức (tr)', 'Nguồn LĐ'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {wageRows.length ? wageRows.map(d => (
                  <tr key={d.id} className="border-b border-[#F0EEE9] last:border-0">
                    <td className="px-3 py-2 text-[#888]">└ {d.industry || '—'}</td>
                    <td className="px-3 py-2">{fmtTr(d.wage_unskilled_min)} – {fmtTr(d.wage_unskilled_max)}</td>
                    <td className="px-3 py-2 text-blue-700">{fmtTr(d.wage_seasonal_min)} – {fmtTr(d.wage_seasonal_max)}</td>
                    <td className="px-3 py-2 text-emerald-700">{fmtTr(d.wage_skilled_min)} – {fmtTr(d.wage_skilled_max)}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${availPillCls(d.labor_availability)}`}>{d.labor_availability}</span></td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="text-center py-4 text-[#aaa]">Chưa có dữ liệu lương. Thêm ở tab Lương TT.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111] flex items-center gap-1.5"><Building2 size={12} /> Công ty chúng tôi đang làm tại đây</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-[#E8E7E2]">
                {['Tên công ty', 'Số lao động hiện tại', 'Người quản lý', 'Trạng thái HĐ'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {zoneClients.length ? zoneClients.map(c => {
                  const cs = contractStatus(c);
                  return (
                    <tr key={c.id} className="border-b border-[#F0EEE9] last:border-0">
                      <td className="px-3 py-2 font-medium text-[#111]">{c.name}</td>
                      <td className="px-3 py-2 text-blue-700">{(c.current_workers ?? 0).toLocaleString('vi-VN')}</td>
                      <td className="px-3 py-2 text-[#666]">{c.manager || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${cs.cls}`}>{cs.label}</span>
                        {c.contract_end && <span className="ml-1.5 text-[10.5px] text-[#aaa]">{formatDate(c.contract_end)}</span>}
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={4} className="text-center py-4 text-[#aaa]">Chưa có công ty nào thuộc khu này. Gán "Khu Công Nghiệp" trong hồ sơ khách hàng để hiển thị tại đây.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-3 py-1.5 bg-[#F9F9F7] rounded-lg text-[11px] text-[#aaa]">Cập nhật: {new Date(selected.updated_at).toLocaleDateString('vi-VN')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[12.5px] font-medium text-[#111]">Hồ sơ khu vực</div>
          <div className="text-[11px] text-[#888]">Click vào khu vực để xem & chỉnh sửa hồ sơ đầy đủ</div>
        </div>
        <div className="flex items-center gap-2">
          <FilterDropdown label="Tỉnh/Thành" options={provinceNames} selected={activeProvinces} onChange={setActiveProvinces} />
          <div className="flex border border-gray-300 rounded-lg overflow-hidden">
            <button onClick={() => setViewMode('list')} title="Dạng danh sách" className={`p-1.5 ${viewMode === 'list' ? 'bg-gray-100 text-[#111]' : 'text-[#999] hover:bg-gray-50'}`}><List size={14} /></button>
            <button onClick={() => setViewMode('card')} title="Dạng card (có ảnh cover)" className={`p-1.5 ${viewMode === 'card' ? 'bg-gray-100 text-[#111]' : 'text-[#999] hover:bg-gray-50'}`}><LayoutGrid size={14} /></button>
          </div>
          <div className="relative shrink-0">
            <button onClick={() => setShowDashSettings(v => !v)} className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border transition ${showDashSettings ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]'}`}>
              <Settings size={13} /> Tuỳ chọn hiển thị
            </button>
            {showDashSettings && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowDashSettings(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-20 w-[270px] max-w-[calc(100vw-2rem)] bg-white border border-[#E8E7E2] rounded-[12px] shadow-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[12.5px] font-semibold text-[#111]">Biểu đồ tổng quan</div>
                    <button onClick={() => setShowDashSettings(false)} className="p-1 hover:bg-gray-100 rounded"><X size={13} /></button>
                  </div>
                  <div className="text-[10.5px] text-[#999]">Bật/tắt để đỡ rối mắt — lựa chọn được nhớ trên trình duyệt này.</div>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-[12px] text-[#444] cursor-pointer">
                      <input type="checkbox" checked={dashSettings.occupancyBar} onChange={e => setDashSettings(s => ({ ...s, occupancyBar: e.target.checked }))} />
                      Tỷ lệ lấp đầy theo khu vực
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-[#444] cursor-pointer">
                      <input type="checkbox" checked={dashSettings.shareBar} onChange={e => setDashSettings(s => ({ ...s, shareBar: e.target.checked }))} />
                      Thị phần LĐ của mình theo khu vực
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-[#444] cursor-pointer">
                      <input type="checkbox" checked={dashSettings.opportunityMatrix} onChange={e => setDashSettings(s => ({ ...s, opportunityMatrix: e.target.checked }))} />
                      Ma trận cơ hội khu vực
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-[#444] cursor-pointer">
                      <input type="checkbox" checked={dashSettings.provinceBar} onChange={e => setDashSettings(s => ({ ...s, provinceBar: e.target.checked }))} />
                      Tổng LĐ theo tỉnh/thành
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
            <Plus size={13} /> Thêm khu vực
          </button>
        </div>
      </div>

      {dashSettings.occupancyBar && occupancyChartData.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
          <div className="text-[12.5px] font-semibold text-[#111] mb-2">Tỷ lệ lấp đầy theo khu vực</div>
          <div style={{ height: Math.max(120, occupancyChartData.length * 28) }}>
            <Bar
              data={{
                labels: occupancyChartData.map(z => z.name),
                datasets: [{
                  data: occupancyChartData.map(z => z.occupancy_pct ?? 0),
                  backgroundColor: occupancyChartData.map(z => occColorHex(z.occupancy_pct)),
                  borderRadius: 4, barThickness: 14,
                }],
              }}
              options={{
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.raw}% lấp đầy` } } },
                scales: {
                  x: { min: 0, max: 100, ticks: { font: { size: 10 }, callback: (v) => v + '%' }, grid: { color: '#F0EEE9' } },
                  y: { ticks: { font: { size: 10.5 } }, grid: { display: false } },
                },
              }}
            />
          </div>
        </div>
      )}

      {dashSettings.shareBar && shareChartData.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
          <div className="text-[12.5px] font-semibold text-[#111] mb-2">Thị phần lao động của mình theo khu vực</div>
          <div className="text-[10.5px] text-[#999] mb-2">LĐ của P. Kinh Doanh / Tổng LĐ toàn khu (%)</div>
          <div style={{ height: Math.max(120, shareChartData.length * 28) }}>
            <Bar
              data={{
                labels: shareChartData.map(z => z.name),
                datasets: [{ data: shareChartData.map(z => z.share), backgroundColor: '#1D4ED8', borderRadius: 4, barThickness: 14 }],
              }}
              options={{
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: { callbacks: { label: (ctx) => {
                    const d = shareChartData[ctx.dataIndex];
                    return `${d.share}% · ${d.lgv_workers.toLocaleString('vi-VN')}/${d.total_workers.toLocaleString('vi-VN')} LĐ`;
                  } } },
                },
                scales: {
                  x: { min: 0, ticks: { font: { size: 10 }, callback: (v) => v + '%' }, grid: { color: '#F0EEE9' } },
                  y: { ticks: { font: { size: 10.5 } }, grid: { display: false } },
                },
              }}
            />
          </div>
        </div>
      )}

      {dashSettings.opportunityMatrix && matrixData.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
          <div className="text-[12.5px] font-semibold text-[#111] mb-2">Ma trận cơ hội khu vực</div>
          <div className="text-[10.5px] text-[#999] mb-2">Trục ngang: mức tiềm năng (★) · Trục dọc: thị phần LĐ hiện tại (%) · Kích thước chấm: tổng LĐ toàn khu</div>
          <div style={{ height: 240 }}>
            <Bubble
              data={{
                datasets: [{
                  data: matrixData.map(d => ({ x: d.x, y: d.y, r: d.r })),
                  backgroundColor: matrixData.map(d => d.color + 'CC'),
                  borderColor: matrixData.map(d => d.color),
                  borderWidth: 1.5,
                }],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: { callbacks: { label: (ctx) => {
                    const d = matrixData[ctx.dataIndex];
                    return `${d.name}: ${d.x}★ tiềm năng · ${d.y}% thị phần`;
                  } } },
                },
                scales: {
                  x: { min: 0, max: 5.5, title: { display: true, text: 'Mức tiềm năng (★)', font: { size: 10 } }, ticks: { font: { size: 10 }, stepSize: 1, precision: 0 }, grid: { color: '#F0EEE9' } },
                  y: { min: 0, title: { display: true, text: 'Thị phần hiện tại (%)', font: { size: 10 } }, ticks: { font: { size: 10 }, callback: (v) => v + '%' }, grid: { color: '#F0EEE9' } },
                },
              }}
            />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {matrixData.map(d => (
              <span key={d.name} className="inline-flex items-center gap-1 text-[10px] text-[#888]">
                <span className="w-2 h-2 rounded-full" style={{ background: d.color }} /> {d.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {dashSettings.provinceBar && provinceChartData.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
          <div className="text-[12.5px] font-semibold text-[#111] mb-2">Tổng lao động theo tỉnh/thành</div>
          <div style={{ height: Math.max(120, provinceChartData.length * 28) }}>
            <Bar
              data={{
                labels: provinceChartData.map(([name]) => name),
                datasets: [{ data: provinceChartData.map(([, v]) => v), backgroundColor: '#65A30D', borderRadius: 4, barThickness: 14 }],
              }}
              options={{
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { ticks: { font: { size: 10 } }, grid: { color: '#F0EEE9' } },
                  y: { ticks: { font: { size: 10.5 } }, grid: { display: false } },
                },
              }}
            />
          </div>
        </div>
      )}

      {viewMode === 'list' && (
        <div className="grid grid-cols-3 gap-3">
          {filteredZones.map(z => (
            <div key={z.id} onClick={() => setSelectedId(z.id)} className="bg-white border border-[#E8E7E2] rounded-[10px] p-3 cursor-pointer hover:border-blue-300 transition">
              <div className="text-[12px] font-medium text-[#111]">{z.name}</div>
              <div className="text-[11px] text-[#888] mb-1.5">{z.location || '—'}</div>
              <div className="h-1 bg-[#F0EEE9] rounded-full overflow-hidden mb-1.5">
                <div className={`h-1 rounded-full ${occColor(z.occupancy_pct).split(' ')[1]}`} style={{ width: `${z.occupancy_pct ?? 0}%` }} />
              </div>
              <div className="flex justify-between text-[10.5px] text-[#888]">
                <span className="inline-flex items-center gap-1"><Building2 size={10} /> {z.total_companies ?? 0}</span>
                <span className="inline-flex items-center gap-1"><Users size={10} /> {((z.total_workers ?? 0) / 1000).toFixed(0)}k LĐ</span>
                <span className={`font-medium ${occColor(z.occupancy_pct).split(' ')[0]}`}>{z.occupancy_pct ?? 0}%</span>
              </div>
            </div>
          ))}
          <div onClick={() => setShowAdd(true)} className="border border-dashed border-gray-300 rounded-[10px] flex items-center justify-center gap-1.5 p-3 cursor-pointer text-[12px] text-[#aaa] hover:border-blue-300 hover:text-blue-500 transition">
            <Plus size={14} /> Thêm khu vực
          </div>
        </div>
      )}

      {viewMode === 'card' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredZones.map(z => (
            <div key={z.id} onClick={() => setSelectedId(z.id)} className="bg-white border border-[#E8E7E2] rounded-[12px] overflow-hidden cursor-pointer hover:border-blue-300 hover:shadow-sm transition">
              {z.image_url ? (
                <div className="h-36 w-full overflow-hidden bg-gray-100">
                  <img src={z.image_url} alt={z.name} className={`w-full h-full ${z.image_fit === 'contain' ? 'object-contain' : 'object-cover'}`} style={{ objectPosition: `${z.image_pos_x ?? 50}% ${z.image_pos_y ?? 50}%` }} />
                </div>
              ) : (
                <div className="h-36 w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                  <ImageIcon size={22} className="text-[#ccc]" />
                </div>
              )}
              <div className="p-3.5">
                <div className="text-[13px] font-semibold text-[#111]">{z.name}</div>
                <div className="text-[11px] text-[#888] flex items-center gap-1 mt-0.5"><MapPin size={10} /> {z.location || '—'}</div>
                <div className="h-1 bg-[#F0EEE9] rounded-full overflow-hidden my-2">
                  <div className={`h-1 rounded-full ${occColor(z.occupancy_pct).split(' ')[1]}`} style={{ width: `${z.occupancy_pct ?? 0}%` }} />
                </div>
                <div className="flex justify-between text-[10.5px] text-[#888]">
                  <span className="inline-flex items-center gap-1"><Building2 size={10} /> {z.total_companies ?? 0} cty</span>
                  <span className="inline-flex items-center gap-1"><Users size={10} /> {((z.total_workers ?? 0) / 1000).toFixed(0)}k LĐ</span>
                  <span className={`font-medium ${occColor(z.occupancy_pct).split(' ')[0]}`}>{z.occupancy_pct ?? 0}%</span>
                </div>
              </div>
            </div>
          ))}
          <div onClick={() => setShowAdd(true)} className="border border-dashed border-gray-300 rounded-[12px] flex items-center justify-center gap-1.5 min-h-[150px] cursor-pointer text-[12px] text-[#aaa] hover:border-blue-300 hover:text-blue-500 transition">
            <Plus size={16} /> Thêm khu vực
          </div>
        </div>
      )}

      {marketZones.length === 0 && (
        <div className="text-center py-8 text-[12px] text-[#aaa]">Chưa có hồ sơ khu vực nào. Bấm "Thêm khu vực" để bắt đầu.</div>
      )}
      {marketZones.length > 0 && filteredZones.length === 0 && (
        <div className="text-center py-8 text-[12px] text-[#aaa]">Không có khu vực nào thuộc tỉnh/thành đã chọn.</div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#111] flex items-center gap-1.5"><MapPin size={15} /> Thêm khu vực mới</h2>
              <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Tên khu vực *</label>
                <input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="KCN Nhơn Trạch 3" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Tên đầy đủ</label>
                <input value={addForm.full_name} onChange={e => setAddForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Khu Công Nghiệp..." className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Tỉnh / Thành phố</label>
                <select value={addForm.location} onChange={e => {
                  if (e.target.value === '__new__') {
                    const v = prompt('Nhập tên Tỉnh/Thành phố mới:');
                    if (v && v.trim()) { addProvince(v.trim()); setAddForm(f => ({ ...f, location: v.trim() })); }
                    return;
                  }
                  setAddForm(f => ({ ...f, location: e.target.value }));
                }} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 bg-white">
                  <option value="">—</option>
                  {provinceOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  <option value="__new__">+ Thêm tỉnh/thành mới…</option>
                </select></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ban quản lý</label>
                <input value={addForm.operator} onChange={e => setAddForm(f => ({ ...f, operator: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Diện tích</label>
                <input value={addForm.area} onChange={e => setAddForm(f => ({ ...f, area: e.target.value }))} placeholder="500 ha" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Năm thành lập</label>
                <input value={addForm.established_year} onChange={e => setAddForm(f => ({ ...f, established_year: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Số công ty</label>
                <input type="number" value={addForm.total_companies} onChange={e => setAddForm(f => ({ ...f, total_companies: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Tổng LĐ</label>
                <input type="number" value={addForm.total_workers} onChange={e => setAddForm(f => ({ ...f, total_workers: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lấp đầy (%)</label>
                <input type="number" max={100} value={addForm.occupancy_pct} onChange={e => setAddForm(f => ({ ...f, occupancy_pct: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nguồn LĐ</label>
                <select value={addForm.labor_availability} onChange={e => setAddForm(f => ({ ...f, labor_availability: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  {LABOR_AVAIL_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select></div>
              <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Link Google Maps</label>
                <input value={addForm.map_link} onChange={e => setAddForm(f => ({ ...f, map_link: e.target.value }))} placeholder="https://maps.google.com/…/@lat,lng…" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Đặc thù sơ bộ</label>
                <textarea value={addForm.characteristics} onChange={e => setAddForm(f => ({ ...f, characteristics: e.target.value }))} rows={2} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 resize-y leading-relaxed" /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Hủy</button>
              <button onClick={handleAddZone} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Tạo hồ sơ'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
