import { useEffect, useRef, useState } from 'react';
import { Plus, X, ArrowRight, Pencil, Users, GripVertical } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { MarketTabProps } from './shared';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import { parseLatLngFromLink, isValidVnLatLng } from '../../lib/geo';
import SearchSelect from './SearchSelect';
import SupplierFillCard from './SupplierFillCard';
import SocialLinksRow from '../../components/SocialLinksRow';
import WageDetailTable from './WageDetailTable';
import { fetchIndustries, addIndustry } from './industries';
import { fetchWageFields, addWageField, deleteWageField, wageDetailToStrings, wageDetailToNumbers } from './wageFields';
import { type RegionZone, OFFICIAL_REGION_WAGES, fetchRegionWages, regionZoneLabel, regionWageOf, regionZoneColorCls } from './regionWage';
import { fmtTr } from './shared';
import type { Client } from '../../lib/types';
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning';

const STATUS_OPTIONS = ['Chưa LH', 'Đang TH', 'Đã LH'];
const statusCls = (s: string) => s === 'Đã LH' ? 'bg-emerald-50 text-emerald-700' : s === 'Đang TH' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700';

const emptyLeadForm = {
  company_name: '', region: '', industry: '', workers_needed: '', source: '', lgv_qty: '0', map_link: '',
  wage_min: '', wage_max: '', allowance_notes: '', wage_detail: {} as Record<string, string>, wage_detail_client: {} as Record<string, string>,
};
const emptyClientSetupForm = {
  client_id: '', industry: '', workers_needed: '', lgv_qty: '0',
  wage_min: '', wage_max: '', allowance_notes: '', map_link: '', wage_detail: {} as Record<string, string>, wage_detail_client: {} as Record<string, string>,
};

// Lương 2 phía: wage_detail (LGVN trả NLĐ) vs wage_detail_client (Công ty trả LGVN) — cùng
// bộ trường nên so được từng khoản. Chỉ tính khi CẢ HAI phía đã có ít nhất 1 số liệu.
function computeWageMargin(lgvn: Record<string, string>, company: Record<string, string>) {
  const hasLgvn = Object.values(lgvn).some(v => v.trim());
  const hasCompany = Object.values(company).some(v => v.trim());
  if (!hasLgvn || !hasCompany) return null;
  const allFields = [...new Set([...Object.keys(lgvn), ...Object.keys(company)])];
  const rows = allFields
    .map(field => {
      const l = parseFloat(lgvn[field] || '0') || 0;
      const c = parseFloat(company[field] || '0') || 0;
      return { field, lgvn: l, company: c, diff: c - l };
    })
    .filter(r => r.lgvn || r.company);
  const totalLgvn = rows.reduce((s, r) => s + r.lgvn, 0);
  const totalCompany = rows.reduce((s, r) => s + r.company, 0);
  return { rows, totalLgvn, totalCompany, totalDiff: totalCompany - totalLgvn };
}

function WageMarginSummary({ lgvn, company }: { lgvn: Record<string, string>; company: Record<string, string> }) {
  const margin = computeWageMargin(lgvn, company);
  if (!margin) return null;
  const diffCls = (d: number) => d > 0 ? 'text-emerald-700' : d < 0 ? 'text-red-600' : 'text-[#999]';
  const fmtDiff = (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(2)}tr`;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 px-2.5 py-2 space-y-1">
      <div className="text-[11px] font-semibold text-emerald-800">Chênh lệch (Công ty trả − LGVN trả)</div>
      {margin.rows.map(r => (
        <div key={r.field} className="flex items-center justify-between text-[11px] text-[#555]">
          <span className="truncate">{r.field}</span>
          <span className={`shrink-0 font-medium ${diffCls(r.diff)}`}>{fmtDiff(r.diff)}</span>
        </div>
      ))}
      <div className="flex items-center justify-between text-[11.5px] font-semibold pt-1 mt-1 border-t border-emerald-200">
        <span className="text-[#333]">Tổng</span>
        <span className={diffCls(margin.totalDiff)}>{fmtDiff(margin.totalDiff)}</span>
      </div>
    </div>
  );
}

export default function LeadsTab({ marketLeads, clients, competitors, marketZones, zoneFilter, setZoneFilter, onRefresh, toast }: MarketTabProps) {
  const { user } = useAuth();
  const [addTab, setAddTab] = useState<'client' | 'lead' | null>(null);
  const [leadForm, setLeadForm] = useState(emptyLeadForm);
  const [clientForm, setClientForm] = useState(emptyClientSetupForm);
  // Cảnh báo F5/đóng tab khi đang gõ dở form thêm KH/dự án mới mà chưa bấm "Thêm".
  useBeforeUnloadWarning(!!addTab && (
    addTab === 'client' ? JSON.stringify(clientForm) !== JSON.stringify(emptyClientSetupForm) : JSON.stringify(leadForm) !== JSON.stringify(emptyLeadForm)
  ));
  const [saving, setSaving] = useState(false);
  const [industries, setIndustries] = useState<string[]>([]);
  const [wageFields, setWageFields] = useState<string[]>([]);
  const [editClientId, setEditClientId] = useState<string | null>(null);
  const [editLeadId, setEditLeadId] = useState<string | null>(null);
  const [provinceFilter, setProvinceFilter] = useState('all');
  const [industryFilter, setIndustryFilter] = useState('all');
  // 4 mức lương tối thiểu vùng — nguồn chung ở bảng region_wages (sửa tại tab Lương TT).
  const [regionWages, setRegionWages] = useState<Record<RegionZone, number>>(OFFICIAL_REGION_WAGES);
  useEffect(() => { fetchRegionWages().then(setRegionWages); }, []);

  // Chia đôi "Khách hàng đang hợp tác" / "Dự án/Công ty đang tìm hiểu" thành 2 khối kéo
  // được chiều ngang — tỉ lệ lưu vào localStorage để F5 không mất, khỏi kéo lại.
  const splitRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState<number>(() => {
    const saved = Number(localStorage.getItem('market_leads_split_pct'));
    return saved >= 20 && saved <= 80 ? saved : 50;
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  useEffect(() => { localStorage.setItem('market_leads_split_pct', String(leftPct)); }, [leftPct]);

  useEffect(() => {
    fetchIndustries([...marketLeads.map(l => l.industry), ...clients.map(c => c.industry)]).then(setIndustries);
    fetchWageFields().then(setWageFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddIndustry = async (name: string) => {
    const err = await addIndustry(name);
    if (err) toast('Lỗi thêm ngành: ' + err);
    setIndustries(prev => [...new Set([...prev, name])].sort((a, b) => a.localeCompare(b, 'vi')));
  };

  // Trường lương chi tiết DÙNG CHUNG toàn hệ thống — thêm/xoá ở bất kỳ đâu (Let's Go VN hay
  // 1 NCC, ở bất kỳ công ty/dự án nào) đều áp dụng cho mọi nơi khác ngay lập tức.
  const handleAddWageField = async (name: string) => {
    const err = await addWageField(name);
    if (err) toast('Lỗi thêm trường lương: ' + err);
    setWageFields(prev => [...new Set([...prev, name])]);
  };
  const handleDeleteWageField = async (name: string) => {
    const err = await deleteWageField(name);
    if (err) toast('Lỗi xoá trường lương: ' + err);
    setWageFields(prev => prev.filter(f => f !== name));
  };

  // Tỉnh/TP suy ra từ tên KCN (marketZones.location), giống cách làm ở tab Lương TT.
  const zoneToProvince: Record<string, string> = {};
  marketZones.forEach(z => { if (z.location) zoneToProvince[z.name] = z.location; });
  const provinces = [...new Set(marketZones.map(z => z.location).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi'));
  const zoneNames = [...new Set([
    ...marketZones.map(z => z.name),
    ...marketLeads.map(l => l.region).filter(Boolean) as string[],
    ...clients.flatMap(c => c.industrial_zones ?? []),
  ])].sort((a, b) => a.localeCompare(b, 'vi'));
  const zonesInProvince = provinceFilter === 'all' ? zoneNames : zoneNames.filter(z => zoneToProvince[z] === provinceFilter);

  // So khớp không phân biệt hoa/thường & chấp nhận lệch tiền tố "KCN " — region gõ tay
  // ("BIÊN HOÀ 2") thường khác tên KCN chính thức ("KCN Biên Hoà 2"), so khớp tuyệt đối
  // sẽ bỏ sót khách hàng/dự án dù đã gán đúng khu vực (vd: TCL tại KCN Biên Hoà 2).
  const zoneMatches = (a: string | null | undefined, b: string | null | undefined) => {
    if (!a || !b) return false;
    const na = a.trim().toLowerCase();
    const nb = b.trim().toLowerCase();
    return na === nb || na.includes(nb) || nb.includes(na);
  };
  const matchesProvince = (region: string | null | undefined, zones: string[] | undefined) => {
    if (provinceFilter === 'all') return true;
    if (region && zoneToProvince[region] === provinceFilter) return true;
    if (region === provinceFilter) return true;
    if (zones?.some(z => zoneToProvince[z] === provinceFilter)) return true;
    return false;
  };
  const matchesZone = (region: string | null | undefined, zones: string[] | undefined) => {
    if (zoneFilter === 'all') return true;
    if (zoneMatches(region, zoneFilter)) return true;
    if (zones?.some(z => zoneMatches(z, zoneFilter))) return true;
    return false;
  };
  const matchesIndustry = (industry: string | null | undefined) => industryFilter === 'all' || industry === industryFilter;

  // Vùng lương tối thiểu của 1 khách hàng/dự án — suy từ KCN đã gán (industrial_zones của
  // khách hàng, hoặc region của dự án) khớp sang market_zones.region_zone. Mỗi KCN 1 vùng.
  const regionInfoFor = (names: (string | null | undefined)[]): { zone: string; label: string; wage: number | null } | null => {
    for (const n of names) {
      if (!n) continue;
      const z = marketZones.find(mz => zoneMatches(mz.name, n) && mz.region_zone);
      const label = regionZoneLabel(z?.region_zone);
      if (z && z.region_zone && label) return { zone: z.region_zone, label, wage: regionWageOf(z.region_zone, regionWages) };
    }
    return null;
  };

  const list = marketLeads.filter(l => matchesProvince(l.region, undefined) && matchesZone(l.region, undefined) && matchesIndustry(l.industry));
  const trackedClients = clients.filter(c =>
    c.market_workers_needed != null &&
    matchesProvince(c.region, c.industrial_zones ?? undefined) &&
    matchesZone(c.region, c.industrial_zones ?? undefined) &&
    matchesIndustry(c.industry),
  );
  const untrackedClients = clients.filter(c => c.market_workers_needed == null);

  const toNum = (v: string) => v.trim() ? parseFloat(v) * 1_000_000 : null;

  // ── Dự án/Công ty đang tìm hiểu (market_leads) ──

  const handleAddLead = async () => {
    if (!leadForm.company_name.trim()) { toast('Nhập tên công ty'); return; }
    setSaving(true);
    try {
      const mapPos = parseLatLngFromLink(leadForm.map_link);
      const { data, error } = await supabase.from('market_leads').insert({
        company_name: leadForm.company_name.trim(),
        region: leadForm.region || (zoneFilter !== 'all' ? zoneFilter : null),
        industry: leadForm.industry || null,
        workers_needed: parseInt(leadForm.workers_needed) || 0,
        source: leadForm.source || null,
        status: 'Chưa LH',
        suppliers: [{ name: "Let's Go VN", qty: parseInt(leadForm.lgv_qty) || 0, is_us: true }],
        map_link: leadForm.map_link.trim() || null,
        wage_min: toNum(leadForm.wage_min),
        wage_max: toNum(leadForm.wage_max),
        allowance_notes: leadForm.allowance_notes.trim() || null,
        wage_detail: wageDetailToNumbers(leadForm.wage_detail),
        wage_detail_client: wageDetailToNumbers(leadForm.wage_detail_client),
        ...(isValidVnLatLng(mapPos) ? { lat: mapPos.lat, lng: mapPos.lng, geocoded_at: new Date().toISOString() } : {}),
      }).select().single();
      if (error) throw error;
      await logActivity({
        user, action: 'insert', table: 'market_leads', recordId: data.id,
        description: `Thêm công ty/dự án "${leadForm.company_name.trim()}"`,
        newData: data,
      });
      await onRefresh();
      setAddTab(null);
      setLeadForm(emptyLeadForm);
      toast('Đã thêm công ty/dự án');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleEditLead = async (leadId: string, patch: EditPatch) => {
    setSaving(true);
    try {
      const mapPos = parseLatLngFromLink(patch.map_link);
      const { error } = await supabase.from('market_leads').update({
        industry: patch.industry || null,
        workers_needed: parseInt(patch.workers_needed) || 0,
        wage_min: toNum(patch.wage_min),
        wage_max: toNum(patch.wage_max),
        allowance_notes: patch.allowance_notes.trim() || null,
        map_link: patch.map_link.trim() || null,
        website_url: patch.website_url.trim() || null,
        facebook_url: patch.facebook_url.trim() || null,
        youtube_url: patch.youtube_url.trim() || null,
        tiktok_url: patch.tiktok_url.trim() || null,
        wage_detail: wageDetailToNumbers(patch.wage_detail),
        wage_detail_client: wageDetailToNumbers(patch.wage_detail_client),
        ...(isValidVnLatLng(mapPos) ? { lat: mapPos.lat, lng: mapPos.lng, geocoded_at: new Date().toISOString() } : {}),
      }).eq('id', leadId);
      if (error) throw error;
      await onRefresh();
      setEditLeadId(null);
      toast('Đã cập nhật');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  // NCC được chọn từ hồ sơ Đối thủ → tự đồng bộ ngược cột "Đang cung cấp cho" bên đó,
  // để 1 nguồn dữ liệu duy nhất, không phải nhập tay 2 nơi.
  const syncCompetitorSupplyingFor = async (supplierName: string, companyName: string) => {
    const comp = competitors.find(c => c.company_name === supplierName);
    if (!comp || comp.supplying_for?.includes(companyName)) return;
    const supplying_for = [...(comp.supplying_for ?? []), companyName];
    await supabase.from('competitors').update({ supplying_for }).eq('id', comp.id);
  };

  const handleAddSupplierToLead = async (leadId: string, name: string, qty: number, wageMin: number | null, wageMax: number | null, wageDetail: Record<string, number>) => {
    const lead = marketLeads.find(l => l.id === leadId);
    if (!lead) return;
    try {
      const newSuppliers = [...lead.suppliers, { name, qty, is_us: false, wage_min: wageMin, wage_max: wageMax, wage_detail: wageDetail }];
      const { error } = await supabase.from('market_leads').update({ suppliers: newSuppliers }).eq('id', leadId);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'market_leads', recordId: leadId,
        description: `Thêm NCC "${name}" cho công ty/dự án "${lead.company_name}"`,
        oldData: lead, newData: { ...lead, suppliers: newSuppliers },
      });
      await syncCompetitorSupplyingFor(name, lead.company_name);
      await onRefresh();
      toast('Đã thêm NCC');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleEditSupplierOfLead = async (leadId: string, index: number, name: string, qty: number, wageMin: number | null, wageMax: number | null, wageDetail: Record<string, number>) => {
    const lead = marketLeads.find(l => l.id === leadId);
    if (!lead) return;
    try {
      const newSuppliers = lead.suppliers.map((s, i) => i === index ? { ...s, name, qty, wage_min: wageMin, wage_max: wageMax, wage_detail: wageDetail } : s);
      const { error } = await supabase.from('market_leads').update({ suppliers: newSuppliers }).eq('id', leadId);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'market_leads', recordId: leadId,
        description: `Sửa NCC "${name}" của công ty/dự án "${lead.company_name}"`,
        oldData: lead, newData: { ...lead, suppliers: newSuppliers },
      });
      await onRefresh();
      toast('Đã cập nhật NCC');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleDeleteSupplierOfLead = async (leadId: string, index: number) => {
    const lead = marketLeads.find(l => l.id === leadId);
    if (!lead) return;
    try {
      const removed = lead.suppliers[index];
      const newSuppliers = lead.suppliers.filter((_, i) => i !== index);
      const { error } = await supabase.from('market_leads').update({ suppliers: newSuppliers }).eq('id', leadId);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'market_leads', recordId: leadId,
        description: `Xoá NCC "${removed?.name}" khỏi công ty/dự án "${lead.company_name}"`,
        oldData: lead, newData: { ...lead, suppliers: newSuppliers },
      });
      await onRefresh();
      toast('Đã xoá NCC');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleStatusChange = async (leadId: string, status: string) => {
    try {
      const lead = marketLeads.find(l => l.id === leadId);
      const { error } = await supabase.from('market_leads').update({ status }).eq('id', leadId);
      if (error) throw error;
      if (lead) {
        await logActivity({
          user, action: 'update', table: 'market_leads', recordId: leadId,
          description: `Cập nhật trạng thái "${lead.company_name}": ${lead.status} → ${status}`,
          oldData: lead, newData: { ...lead, status },
        });
      }
      await onRefresh();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handlePushCRM = async (companyName: string, region: string | null, workersNeeded: number) => {
    try {
      const { error } = await supabase.from('crm_pipeline').insert({
        company_name: companyName, region, worker_estimate: workersNeeded || null,
        stage: 'tiem-nang', notes: 'Phát hiện từ Module Thị trường',
      });
      if (error) throw error;
      toast('Đã đẩy "' + companyName + '" sang CRM!');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  // ── Khách hàng đang hợp tác (clients.market_*) ──

  const handleSetupClient = async () => {
    if (!clientForm.client_id) { toast('Chọn khách hàng'); return; }
    setSaving(true);
    try {
      const mapPos = parseLatLngFromLink(clientForm.map_link);
      const patch = {
        industry: clientForm.industry || null,
        market_workers_needed: parseInt(clientForm.workers_needed) || 0,
        market_suppliers: [{ name: "Let's Go VN", qty: parseInt(clientForm.lgv_qty) || 0, is_us: true }],
        wage_min: toNum(clientForm.wage_min),
        wage_max: toNum(clientForm.wage_max),
        allowance_notes: clientForm.allowance_notes.trim() || null,
        map_link: clientForm.map_link.trim() || null,
        wage_detail: wageDetailToNumbers(clientForm.wage_detail),
        wage_detail_client: wageDetailToNumbers(clientForm.wage_detail_client),
        ...(isValidVnLatLng(mapPos) ? { lat: mapPos.lat, lng: mapPos.lng, geocoded_at: new Date().toISOString() } : {}),
      };
      const { error } = await supabase.from('clients').update(patch).eq('id', clientForm.client_id);
      if (error) throw error;
      const client = clients.find(c => c.id === clientForm.client_id);
      await logActivity({
        user, action: 'update', table: 'clients', recordId: clientForm.client_id,
        description: `Thiết lập theo dõi thị trường cho khách hàng "${client?.name}"`,
        oldData: client, newData: { ...client, ...patch },
      });
      await onRefresh();
      setAddTab(null);
      setClientForm(emptyClientSetupForm);
      toast('Đã thiết lập theo dõi thị trường');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleEditClient = async (clientId: string, patch: EditPatch) => {
    setSaving(true);
    try {
      const mapPos = parseLatLngFromLink(patch.map_link);
      const { error } = await supabase.from('clients').update({
        industry: patch.industry || null,
        market_workers_needed: parseInt(patch.workers_needed) || 0,
        wage_min: toNum(patch.wage_min),
        wage_max: toNum(patch.wage_max),
        allowance_notes: patch.allowance_notes.trim() || null,
        map_link: patch.map_link.trim() || null,
        website_url: patch.website_url.trim() || null,
        facebook_url: patch.facebook_url.trim() || null,
        youtube_url: patch.youtube_url.trim() || null,
        tiktok_url: patch.tiktok_url.trim() || null,
        wage_detail: wageDetailToNumbers(patch.wage_detail),
        wage_detail_client: wageDetailToNumbers(patch.wage_detail_client),
        ...(isValidVnLatLng(mapPos) ? { lat: mapPos.lat, lng: mapPos.lng, geocoded_at: new Date().toISOString() } : {}),
      }).eq('id', clientId);
      if (error) throw error;
      await onRefresh();
      setEditClientId(null);
      toast('Đã cập nhật');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleAddSupplierToClient = async (client: Client, name: string, qty: number, wageMin: number | null, wageMax: number | null, wageDetail: Record<string, number>) => {
    try {
      const newSuppliers = [...(client.market_suppliers ?? []), { name, qty, is_us: false, wage_min: wageMin, wage_max: wageMax, wage_detail: wageDetail }];
      const { error } = await supabase.from('clients').update({ market_suppliers: newSuppliers }).eq('id', client.id);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'clients', recordId: client.id,
        description: `Thêm NCC "${name}" cho khách hàng "${client.name}"`,
        oldData: client, newData: { ...client, market_suppliers: newSuppliers },
      });
      await syncCompetitorSupplyingFor(name, client.name);
      await onRefresh();
      toast('Đã thêm NCC');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleEditSupplierOfClient = async (client: Client, index: number, name: string, qty: number, wageMin: number | null, wageMax: number | null, wageDetail: Record<string, number>) => {
    try {
      const current = client.market_suppliers ?? [];
      const newSuppliers = current.map((s, i) => i === index ? { ...s, name, qty, wage_min: wageMin, wage_max: wageMax, wage_detail: wageDetail } : s);
      const { error } = await supabase.from('clients').update({ market_suppliers: newSuppliers }).eq('id', client.id);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'clients', recordId: client.id,
        description: `Sửa NCC "${name}" của khách hàng "${client.name}"`,
        oldData: client, newData: { ...client, market_suppliers: newSuppliers },
      });
      await onRefresh();
      toast('Đã cập nhật NCC');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleDeleteSupplierOfClient = async (client: Client, index: number) => {
    try {
      const current = client.market_suppliers ?? [];
      const removed = current[index];
      const newSuppliers = current.filter((_, i) => i !== index);
      const { error } = await supabase.from('clients').update({ market_suppliers: newSuppliers }).eq('id', client.id);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'clients', recordId: client.id,
        description: `Xoá NCC "${removed?.name}" khỏi khách hàng "${client.name}"`,
        oldData: client, newData: { ...client, market_suppliers: newSuppliers },
      });
      await onRefresh();
      toast('Đã xoá NCC');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const wageFmt = (min: number | null | undefined, max: number | null | undefined) =>
    min != null && max != null ? `${(min / 1_000_000).toFixed(1)}–${(max / 1_000_000).toFixed(1)}tr` : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] text-[#888]">Phát hiện khi khảo sát · Xem thị phần nhà cung ứng</div>
        <button onClick={() => { setAddTab('lead'); setLeadForm(emptyLeadForm); setClientForm(emptyClientSetupForm); }} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
          <Plus size={13} /> Thêm công ty
        </button>
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-[#888] shrink-0">Tỉnh/TP:</span>
        <SearchSelect
          value={provinceFilter}
          onChange={v => { setProvinceFilter(v); setZoneFilter('all'); }}
          options={[{ value: 'all', label: `Tất cả (${provinces.length})` }, ...provinces.map(p => ({ value: p, label: p }))]}
          className="w-48"
        />
        <span className="text-[12px] text-[#888] shrink-0">KCN:</span>
        <SearchSelect
          value={zoneFilter}
          onChange={setZoneFilter}
          options={[{ value: 'all', label: `Tất cả (${zonesInProvince.length})` }, ...zonesInProvince.map(z => ({ value: z, label: z }))]}
          className="w-56"
        />
        <span className="text-[12px] text-[#888] shrink-0">Ngành nghề:</span>
        <SearchSelect
          value={industryFilter}
          onChange={setIndustryFilter}
          options={[{ value: 'all', label: `Tất cả (${industries.length})` }, ...industries.map(i => ({ value: i, label: i }))]}
          className="w-48"
        />
        {(provinceFilter !== 'all' || zoneFilter !== 'all' || industryFilter !== 'all') && (
          <button onClick={() => { setProvinceFilter('all'); setZoneFilter('all'); setIndustryFilter('all'); }} className="text-[11.5px] text-blue-600 hover:underline">Xoá lọc</button>
        )}
      </div>

      <div ref={splitRef} className={`flex items-start ${dragging ? 'select-none' : ''}`}>
      {/* ── Khách hàng đang hợp tác ── */}
      <div className="space-y-2 min-w-0" style={{ width: `${leftPct}%` }}>
        <div className="text-[12.5px] font-semibold text-[#111] flex items-center gap-1.5"><Users size={13} /> Khách hàng đang hợp tác</div>
        <div className="space-y-3">
          {trackedClients.map(c => (
            <div key={c.id} className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="flex items-start justify-between gap-2 px-4 py-2.5 bg-emerald-50/40 border-b border-[#E8E7E2] flex-wrap">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium flex items-center gap-1.5 flex-wrap">
                    {c.name}
                    {(() => { const r = regionInfoFor([...(c.industrial_zones ?? []), c.region]); return r && (
                      <span className={`text-[10px] font-semibold w-6 h-4 inline-flex items-center justify-center rounded ${regionZoneColorCls(r.zone)}`}>{r.label}</span>
                    ); })()}
                  </div>
                  <div className="text-[11px] text-[#888] mt-0.5">
                    {c.region || '—'} · {c.industry || '—'}{wageFmt(c.wage_min, c.wage_max) ? ` · Lương ${wageFmt(c.wage_min, c.wage_max)}` : ''}
                    {c.allowance_notes ? ` · ${c.allowance_notes}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <SocialLinksRow websiteUrl={c.website_url} facebookUrl={c.facebook_url} youtubeUrl={c.youtube_url} tiktokUrl={c.tiktok_url} />
                  <button onClick={() => setEditClientId(editClientId === c.id ? null : c.id)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border border-[#E8E7E2] text-[#666] hover:bg-white shrink-0"><Pencil size={11} /> Sửa</button>
                </div>
              </div>
              {editClientId === c.id && (
                <ClientEditForm client={c} saving={saving} industries={industries} onAddIndustry={handleAddIndustry}
                  wageFields={wageFields} onAddWageField={handleAddWageField} onDeleteWageField={handleDeleteWageField}
                  onCancel={() => setEditClientId(null)} onSave={patch => handleEditClient(c.id, patch)} />
              )}
              <div className="p-4">
                <SupplierFillCard
                  workersNeeded={c.market_workers_needed ?? 0}
                  suppliers={c.market_suppliers ?? []}
                  saving={saving}
                  competitors={competitors}
                  wageFields={wageFields} onAddWageField={handleAddWageField} onDeleteWageField={handleDeleteWageField}
                  onAddSupplier={(name, qty, wageMin, wageMax, wageDetail) => handleAddSupplierToClient(c, name, qty, wageMin, wageMax, wageDetail)}
                  onEditSupplier={(idx, name, qty, wageMin, wageMax, wageDetail) => handleEditSupplierOfClient(c, idx, name, qty, wageMin, wageMax, wageDetail)}
                  onDeleteSupplier={idx => handleDeleteSupplierOfClient(c, idx)}
                />
              </div>
            </div>
          ))}
          {trackedClients.length === 0 && (
            <div className="text-center py-6 text-[12px] text-[#aaa] bg-white border border-dashed border-[#E8E7E2] rounded-[10px]">
              Chưa có khách hàng nào được thiết lập theo dõi thị trường — bấm "Thêm công ty" → chọn "Khách hàng đang hợp tác"
            </div>
          )}
          {untrackedClients.length > 0 && (
            <div className="text-[11px] text-[#999]">
              {untrackedClients.length} khách hàng đang hợp tác khác chưa thiết lập ngành nghề/lấp đầy tại đây.
            </div>
          )}
        </div>
      </div>

      <div
        onMouseDown={() => setDragging(true)}
        className="relative w-3 shrink-0 self-stretch flex items-center justify-center cursor-col-resize group"
        title="Kéo để đổi chiều rộng"
      >
        <div className={`w-1 h-full min-h-[80px] rounded-full transition ${dragging ? 'bg-blue-400' : 'bg-[#E8E7E2] group-hover:bg-blue-300'}`} />
        <GripVertical size={12} className="absolute text-[#bbb] group-hover:text-blue-500 pointer-events-none" />
      </div>

      {/* ── Dự án / Công ty đang tìm hiểu ── */}
      <div className="space-y-2 min-w-0" style={{ width: `${100 - leftPct}%` }}>
        <div className="text-[12.5px] font-semibold text-[#111]">Dự án / Công ty đang tìm hiểu</div>
        <div className="space-y-3">
          {list.map(l => (
            <div key={l.id} className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
              <div className="flex items-start justify-between gap-2 px-4 py-2.5 bg-[#F9F9F7] border-b border-[#E8E7E2] flex-wrap">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium flex items-center gap-1.5 flex-wrap">
                    {l.company_name}
                    <select value={l.status} onChange={e => handleStatusChange(l.id, e.target.value)} className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium border-0 outline-none ${statusCls(l.status)}`}>
                      {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                    </select>
                    {(() => { const r = regionInfoFor([l.region]); return r && (
                      <span className={`text-[10px] font-semibold w-6 h-4 inline-flex items-center justify-center rounded ${regionZoneColorCls(r.zone)}`}>{r.label}</span>
                    ); })()}
                  </div>
                  <div className="text-[11px] text-[#888] mt-0.5">
                    {l.region || '—'} · {l.industry || '—'} · {l.source || '—'} · {new Date(l.lead_date).toLocaleDateString('vi-VN')}
                    {wageFmt(l.wage_min, l.wage_max) ? ` · Lương ${wageFmt(l.wage_min, l.wage_max)}` : ''}
                    {l.allowance_notes ? ` · ${l.allowance_notes}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <SocialLinksRow websiteUrl={l.website_url} facebookUrl={l.facebook_url} youtubeUrl={l.youtube_url} tiktokUrl={l.tiktok_url} />
                  <button onClick={() => setEditLeadId(editLeadId === l.id ? null : l.id)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border border-[#E8E7E2] text-[#666] hover:bg-white"><Pencil size={11} /> Sửa</button>
                  <button onClick={() => handlePushCRM(l.company_name, l.region, l.workers_needed)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
                    Đẩy CRM <ArrowRight size={12} />
                  </button>
                </div>
              </div>
              {editLeadId === l.id && (
                <LeadEditForm lead={l} saving={saving} industries={industries} onAddIndustry={handleAddIndustry}
                  wageFields={wageFields} onAddWageField={handleAddWageField} onDeleteWageField={handleDeleteWageField}
                  onCancel={() => setEditLeadId(null)} onSave={patch => handleEditLead(l.id, patch)} />
              )}
              <div className="p-4">
                <SupplierFillCard
                  workersNeeded={l.workers_needed}
                  suppliers={l.suppliers}
                  saving={saving}
                  competitors={competitors}
                  wageFields={wageFields} onAddWageField={handleAddWageField} onDeleteWageField={handleDeleteWageField}
                  onAddSupplier={(name, qty, wageMin, wageMax, wageDetail) => handleAddSupplierToLead(l.id, name, qty, wageMin, wageMax, wageDetail)}
                  onEditSupplier={(idx, name, qty, wageMin, wageMax, wageDetail) => handleEditSupplierOfLead(l.id, idx, name, qty, wageMin, wageMax, wageDetail)}
                  onDeleteSupplier={idx => handleDeleteSupplierOfLead(l.id, idx)}
                />
              </div>
            </div>
          ))}
          {list.length === 0 && (
            <div className="text-center py-8 text-[12px] text-[#aaa]">Chưa có công ty/dự án nào được phát hiện</div>
          )}
        </div>
      </div>
      </div>

      {addTab && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-semibold text-[#111]">Thêm công ty</h2>
              <button onClick={() => setAddTab(null)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <div className="flex items-center gap-1 mb-4 bg-[#F3F2EE] rounded-lg p-1">
              <button onClick={() => setAddTab('client')} className={`flex-1 px-3 py-1.5 rounded-md text-[12px] font-medium transition ${addTab === 'client' ? 'bg-white shadow-sm text-[#111]' : 'text-[#888]'}`}>Khách hàng đang hợp tác</button>
              <button onClick={() => setAddTab('lead')} className={`flex-1 px-3 py-1.5 rounded-md text-[12px] font-medium transition ${addTab === 'lead' ? 'bg-white shadow-sm text-[#111]' : 'text-[#888]'}`}>Công ty mới đang tìm hiểu</button>
            </div>

            {addTab === 'client' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Khách hàng *</label>
                  <SearchSelect
                    value={clientForm.client_id}
                    onChange={v => setClientForm(f => ({ ...f, client_id: v }))}
                    options={untrackedClients.map(c => ({ value: c.id, label: c.name }))}
                    placeholder={untrackedClients.length ? 'Chọn khách hàng…' : 'Tất cả khách hàng đã thiết lập'}
                  />
                </div>
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ngành nghề</label>
                  <SearchSelect value={clientForm.industry} onChange={v => setClientForm(f => ({ ...f, industry: v }))}
                    options={industries.map(i => ({ value: i, label: i }))} placeholder="Chọn ngành…" allowAdd onAdd={handleAddIndustry} /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nhu cầu LĐ</label>
                  <input type="number" value={clientForm.workers_needed} onChange={e => setClientForm(f => ({ ...f, workers_needed: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Let's Go VN đang cung cấp</label>
                  <input type="number" value={clientForm.lgv_qty} onChange={e => setClientForm(f => ({ ...f, lgv_qty: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương từ (tr)</label>
                  <input type="number" step="0.1" value={clientForm.wage_min} onChange={e => setClientForm(f => ({ ...f, wage_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương đến (tr)</label>
                  <input type="number" step="0.1" value={clientForm.wage_max} onChange={e => setClientForm(f => ({ ...f, wage_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="col-span-2 space-y-1.5">
                  <WageDetailTable label="Chi tiết lương · LGVN trả NLĐ" fields={wageFields} value={clientForm.wage_detail} onChange={v => setClientForm(f => ({ ...f, wage_detail: v }))}
                    onAddField={handleAddWageField} onDeleteField={handleDeleteWageField} />
                  <WageDetailTable label="Chi tiết lương · Công ty trả LGVN" fields={wageFields} value={clientForm.wage_detail_client} onChange={v => setClientForm(f => ({ ...f, wage_detail_client: v }))}
                    onAddField={handleAddWageField} onDeleteField={handleDeleteWageField} />
                  <WageMarginSummary lgvn={clientForm.wage_detail} company={clientForm.wage_detail_client} />
                </div>
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Phụ cấp / ghi chú</label>
                  <textarea value={clientForm.allowance_notes} onChange={e => setClientForm(f => ({ ...f, allowance_notes: e.target.value }))} rows={2} placeholder="Phụ cấp chuyên cần 300k, xăng xe 200k…" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 resize-y leading-relaxed" /></div>
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Link Google Maps</label>
                  <input value={clientForm.map_link} onChange={e => setClientForm(f => ({ ...f, map_link: e.target.value }))} placeholder="https://maps.google.com/…/@lat,lng… (tuỳ chọn)" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Tên công ty *</label>
                  <input value={leadForm.company_name} onChange={e => setLeadForm(f => ({ ...f, company_name: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Khu vực</label>
                  <input value={leadForm.region} onChange={e => setLeadForm(f => ({ ...f, region: e.target.value }))} placeholder="KCN Biên Hòa 2" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Ngành nghề</label>
                  <SearchSelect value={leadForm.industry} onChange={v => setLeadForm(f => ({ ...f, industry: v }))}
                    options={industries.map(i => ({ value: i, label: i }))} placeholder="Chọn ngành…" allowAdd onAdd={handleAddIndustry} /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nhu cầu LĐ</label>
                  <input type="number" value={leadForm.workers_needed} onChange={e => setLeadForm(f => ({ ...f, workers_needed: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Nguồn thông tin</label>
                  <input value={leadForm.source} onChange={e => setLeadForm(f => ({ ...f, source: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Let's Go VN đang cung cấp</label>
                  <input type="number" value={leadForm.lgv_qty} onChange={e => setLeadForm(f => ({ ...f, lgv_qty: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương từ (tr)</label>
                  <input type="number" step="0.1" value={leadForm.wage_min} onChange={e => setLeadForm(f => ({ ...f, wage_min: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Lương đến (tr)</label>
                  <input type="number" step="0.1" value={leadForm.wage_max} onChange={e => setLeadForm(f => ({ ...f, wage_max: e.target.value }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
                <div className="col-span-2 space-y-1.5">
                  <WageDetailTable label="Chi tiết lương · LGVN trả NLĐ" fields={wageFields} value={leadForm.wage_detail} onChange={v => setLeadForm(f => ({ ...f, wage_detail: v }))}
                    onAddField={handleAddWageField} onDeleteField={handleDeleteWageField} />
                  <WageDetailTable label="Chi tiết lương · Công ty trả LGVN" fields={wageFields} value={leadForm.wage_detail_client} onChange={v => setLeadForm(f => ({ ...f, wage_detail_client: v }))}
                    onAddField={handleAddWageField} onDeleteField={handleDeleteWageField} />
                  <WageMarginSummary lgvn={leadForm.wage_detail} company={leadForm.wage_detail_client} />
                </div>
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Phụ cấp / ghi chú</label>
                  <textarea value={leadForm.allowance_notes} onChange={e => setLeadForm(f => ({ ...f, allowance_notes: e.target.value }))} rows={2} placeholder="Phụ cấp chuyên cần, xăng xe…" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 resize-y leading-relaxed" /></div>
                <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Link Google Maps</label>
                  <input value={leadForm.map_link} onChange={e => setLeadForm(f => ({ ...f, map_link: e.target.value }))} placeholder="https://maps.google.com/…/@lat,lng… (tuỳ chọn)" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={() => setAddTab(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Hủy</button>
              <button onClick={addTab === 'client' ? handleSetupClient : handleAddLead} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Thêm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface EditPatch {
  industry: string; wage_min: string; wage_max: string; allowance_notes: string; workers_needed: string; map_link: string;
  website_url: string; facebook_url: string; youtube_url: string; tiktok_url: string;
  wage_detail: Record<string, string>; wage_detail_client: Record<string, string>;
}

function EditFormFields({ initial, industries, onAddIndustry, onCancel, onSave, saving, wageFields, onAddWageField, onDeleteWageField }: {
  initial: EditPatch;
  industries: string[];
  onAddIndustry: (name: string) => void;
  onCancel: () => void;
  onSave: (patch: EditPatch) => void;
  saving: boolean;
  wageFields: string[];
  onAddWageField: (name: string) => void;
  onDeleteWageField: (name: string) => void;
}) {
  const [patch, setPatch] = useState<EditPatch>(initial);
  useBeforeUnloadWarning(JSON.stringify(patch) !== JSON.stringify(initial));
  return (
    <div className="px-4 py-3 bg-blue-50/30 border-b border-[#E8E7E2] grid grid-cols-2 gap-2.5">
      <div className="col-span-2 flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">Ngành nghề</label>
        <SearchSelect value={patch.industry} onChange={v => setPatch(p => ({ ...p, industry: v }))}
          options={industries.map(i => ({ value: i, label: i }))} placeholder="Chọn ngành…" allowAdd onAdd={onAddIndustry} /></div>
      <div className="flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">Nhu cầu LĐ</label>
        <input type="number" value={patch.workers_needed} onChange={e => setPatch(p => ({ ...p, workers_needed: e.target.value }))} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
      <div />
      <div className="flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">Lương từ (tr)</label>
        <input type="number" step="0.1" value={patch.wage_min} onChange={e => setPatch(p => ({ ...p, wage_min: e.target.value }))} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
      <div className="flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">Lương đến (tr)</label>
        <input type="number" step="0.1" value={patch.wage_max} onChange={e => setPatch(p => ({ ...p, wage_max: e.target.value }))} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
      <div className="col-span-2 space-y-1.5">
        <WageDetailTable
          label="Chi tiết lương · LGVN trả NLĐ"
          fields={wageFields} value={patch.wage_detail} onChange={v => setPatch(p => ({ ...p, wage_detail: v }))}
          onAddField={onAddWageField} onDeleteField={onDeleteWageField}
        />
        <WageDetailTable
          label="Chi tiết lương · Công ty trả LGVN"
          fields={wageFields} value={patch.wage_detail_client} onChange={v => setPatch(p => ({ ...p, wage_detail_client: v }))}
          onAddField={onAddWageField} onDeleteField={onDeleteWageField}
        />
        <WageMarginSummary lgvn={patch.wage_detail} company={patch.wage_detail_client} />
      </div>
      <div className="col-span-2 flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">Phụ cấp / ghi chú</label>
        <textarea value={patch.allowance_notes} onChange={e => setPatch(p => ({ ...p, allowance_notes: e.target.value }))} rows={2} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 resize-y leading-relaxed" /></div>
      <div className="col-span-2 flex flex-col gap-1"><label className="text-[11px] text-[#666] font-medium">Link Google Maps</label>
        <input value={patch.map_link} onChange={e => setPatch(p => ({ ...p, map_link: e.target.value }))} placeholder="https://maps.google.com/…/@lat,lng…" className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
      <div className="col-span-2 flex flex-col gap-1.5">
        <label className="text-[11px] text-[#666] font-medium">Kênh online — theo dõi hoạt động công ty</label>
        <div className="grid grid-cols-2 gap-2">
          <input value={patch.website_url} onChange={e => setPatch(p => ({ ...p, website_url: e.target.value }))} placeholder="Website https://…" className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
          <input value={patch.facebook_url} onChange={e => setPatch(p => ({ ...p, facebook_url: e.target.value }))} placeholder="Facebook https://…" className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
          <input value={patch.youtube_url} onChange={e => setPatch(p => ({ ...p, youtube_url: e.target.value }))} placeholder="YouTube https://…" className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
          <input value={patch.tiktok_url} onChange={e => setPatch(p => ({ ...p, tiktok_url: e.target.value }))} placeholder="TikTok https://…" className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
        </div>
      </div>
      <div className="col-span-2 flex gap-2 mt-1">
        <button onClick={onCancel} className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-[11.5px] font-medium text-gray-600">Hủy</button>
        <button onClick={() => onSave(patch)} disabled={saving} className="flex-1 px-3 py-1.5 bg-[#1D4ED8] text-white rounded-lg text-[11.5px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu'}</button>
      </div>
    </div>
  );
}

type EditFormExtraProps = { industries: string[]; onAddIndustry: (n: string) => void; onCancel: () => void; onSave: (p: EditPatch) => void; saving: boolean; wageFields: string[]; onAddWageField: (n: string) => void; onDeleteWageField: (n: string) => void };

function ClientEditForm({ client, ...rest }: { client: Client } & EditFormExtraProps) {
  return <EditFormFields initial={{
    industry: client.industry ?? '',
    workers_needed: String(client.market_workers_needed ?? ''),
    wage_min: client.wage_min != null ? String(client.wage_min / 1_000_000) : '',
    wage_max: client.wage_max != null ? String(client.wage_max / 1_000_000) : '',
    allowance_notes: client.allowance_notes ?? '',
    map_link: client.map_link ?? '',
    website_url: client.website_url ?? '',
    facebook_url: client.facebook_url ?? '',
    youtube_url: client.youtube_url ?? '',
    tiktok_url: client.tiktok_url ?? '',
    wage_detail: wageDetailToStrings(client.wage_detail),
    wage_detail_client: wageDetailToStrings(client.wage_detail_client),
  }} {...rest} />;
}

function LeadEditForm({ lead, ...rest }: { lead: import('../../lib/types').MarketLead } & EditFormExtraProps) {
  return <EditFormFields initial={{
    industry: lead.industry ?? '',
    workers_needed: String(lead.workers_needed ?? ''),
    wage_min: lead.wage_min != null ? String(lead.wage_min / 1_000_000) : '',
    wage_max: lead.wage_max != null ? String(lead.wage_max / 1_000_000) : '',
    allowance_notes: lead.allowance_notes ?? '',
    map_link: lead.map_link ?? '',
    website_url: lead.website_url ?? '',
    facebook_url: lead.facebook_url ?? '',
    youtube_url: lead.youtube_url ?? '',
    tiktok_url: lead.tiktok_url ?? '',
    wage_detail: wageDetailToStrings(lead.wage_detail),
    wage_detail_client: wageDetailToStrings(lead.wage_detail_client),
  }} {...rest} />;
}
