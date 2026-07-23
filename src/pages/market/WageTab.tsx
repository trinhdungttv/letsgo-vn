import { Fragment, useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, ExternalLink, Coins, X, Pencil, Check, List, LayoutGrid, Image as ImageIcon, MapPin } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { availPillCls, LABOR_AVAIL_OPTIONS, type MarketTabProps } from './shared';
import { logActivity } from '../../lib/audit';
import { useAuth } from '../../lib/auth';
import SearchSelect from './SearchSelect';
import { fetchIndustries, addIndustry } from './industries';

const emptyForm = {
  zone_name: '', industry: '', pt_min: '', pt_max: '', tv_min: '', tv_max: '', ct_min: '', ct_max: '',
  labor_availability: 'Trung bình', occupancy: '', survey_date: new Date().toISOString().split('T')[0],
};

export default function WageTab({ marketZones, marketSurveys, marketLeads, clients, zoneFilter, setZoneFilter, goTab, onRefresh, toast }: MarketTabProps) {
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [provinceFilter, setProvinceFilter] = useState<string>('all');
  const [editIndustryId, setEditIndustryId] = useState<string | null>(null);
  const [editIndustryValue, setEditIndustryValue] = useState('');
  const [reassignZone, setReassignZone] = useState<string | null>(null);
  const [reassignValue, setReassignValue] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'card'>(() => (localStorage.getItem('market_wage_view_mode') as 'list' | 'card') || 'list');
  useEffect(() => { localStorage.setItem('market_wage_view_mode', viewMode); }, [viewMode]);

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

  // Khớp Khách hàng/Dự án với bộ lọc Tỉnh/TP + KCN đang chọn trên bảng khảo sát —
  // dùng chung logic zoneToProvince để "Mức lương theo ngành nghề" chỉ tổng hợp đúng
  // phạm vi đang lọc, không lẫn dữ liệu ngoài phạm vi (KCN không thuộc tỉnh đã chọn…).
  const matchesFilter = (region: string | null | undefined, zones: string[] | undefined) => {
    if (zoneFilter !== 'all') {
      if (region === zoneFilter || zones?.includes(zoneFilter)) return true;
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

  // Tổng hợp mức lương theo NGÀNH NGHỀ từ dữ liệu đã nhập ở tab Công ty/Dự án — cả Khách
  // hàng đang hợp tác (clients.wage_min/max) lẫn Dự án/Công ty đang tìm hiểu
  // (marketLeads.wage_min/max), giới hạn theo Tỉnh/TP + KCN đang lọc ở bảng bên dưới.
  const industryWageSummary = useMemo(() => {
    interface Acc { min: number; max: number; count: number; names: string[] }
    const map = new Map<string, Acc>();
    const feed = (industry: string | null | undefined, wageMin: number | null | undefined, wageMax: number | null | undefined, name: string) => {
      if (!industry || wageMin == null || wageMax == null) return;
      const key = industry.trim();
      if (!key) return;
      const cur = map.get(key) ?? { min: wageMin, max: wageMax, count: 0, names: [] };
      cur.min = Math.min(cur.min, wageMin);
      cur.max = Math.max(cur.max, wageMax);
      cur.count += 1;
      if (cur.names.length < 4) cur.names.push(name);
      map.set(key, cur);
    };
    clients.filter(c => matchesFilter(c.region, c.industrial_zones ?? undefined)).forEach(c => feed(c.industry, c.wage_min, c.wage_max, c.name));
    marketLeads.filter(l => matchesFilter(l.region, undefined)).forEach(l => feed(l.industry, l.wage_min, l.wage_max, l.company_name));
    return [...map.entries()]
      .map(([industry, v]) => ({ industry, ...v }))
      .sort((a, b) => a.industry.localeCompare(b.industry, 'vi'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, marketLeads, provinceFilter, zoneFilter, zoneToProvince]);

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

  return (
    <div className="space-y-3">
      {industryWageSummary.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2]">
            <div className="text-[12.5px] font-semibold text-[#111]">Mức lương theo ngành nghề (tổng hợp từ Công ty/Dự án)</div>
            <div className="text-[11px] text-[#999] mt-0.5">
              Gộp từ Khách hàng đang hợp tác + Công ty/Dự án đang tìm hiểu đã nhập lương khảo sát
              {provinceFilter !== 'all' || zoneFilter !== 'all' ? ` · trong phạm vi đang lọc (${zoneFilter !== 'all' ? zoneFilter : provinceFilter})` : ', theo mọi khu vực'}
            </div>
          </div>
          <div className="p-3 flex flex-wrap gap-2">
            {industryWageSummary.map(s => (
              <div key={s.industry} className="rounded-lg border border-[#E8E7E2] px-3 py-2 min-w-[160px]">
                <div className="text-[12px] font-medium text-[#222]">{s.industry}</div>
                <div className="text-[14px] font-semibold text-emerald-700 mt-0.5">{fmtTr(s.min)}–{fmtTr(s.max)}tr</div>
                <div className="text-[10.5px] text-[#999] mt-0.5">{s.count} nguồn · {s.names.join(', ')}{s.count > s.names.length ? '…' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}
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
                const rows = marketSurveys.filter(s => s.zone_name === zone);
                const isOfficial = officialZoneNames.has(zone);
                return (
                  <Fragment key={zone}>
                    <tr className="bg-[#F9F9F7]">
                      <td colSpan={8} className="px-3 py-1.5 font-medium text-[11.5px]">
                        <span className="inline-flex items-center gap-2 flex-wrap">
                          {zone}
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
                    )) : (
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
            const rows = marketSurveys.filter(s => s.zone_name === zone);
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
                      {zoneToProvince[zone] && (
                        <div className="text-[10.5px] text-[#888] flex items-center gap-1 mt-0.5"><MapPin size={10} /> {zoneToProvince[zone]}</div>
                      )}
                    </div>
                    {isOfficial ? (
                      <button onClick={() => goTab('zones', zone)} className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] border border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]"><ExternalLink size={9} /> Hồ sơ</button>
                    ) : (
                      <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">⚠ chưa khớp KCN</span>
                    )}
                  </div>
                  <div className="mt-2.5 pt-2.5 border-t border-gray-100 space-y-1.5">
                    {rows.length ? rows.map(d => (
                      <div key={d.id} className="flex items-center justify-between text-[11px]">
                        <span className="text-[#666] truncate mr-2">{d.industry || 'Chưa gán ngành'}</span>
                        <span className="shrink-0 text-emerald-700 font-medium">{fmtTr(d.wage_skilled_min)}–{fmtTr(d.wage_skilled_max)}tr</span>
                      </div>
                    )) : (
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
