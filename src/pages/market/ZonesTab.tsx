import { useEffect, useState } from 'react';
import { Plus, ArrowLeft, Check, Building2, Users, MapPin, Coins, Eye, FileText, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { MarketZone } from '../../lib/types';
import { fmtTr, occColor, availPillCls, LABOR_AVAIL_OPTIONS, type MarketTabProps } from './shared';

const emptyAddForm = {
  name: '', full_name: '', location: '', operator: '', area: '', established_year: '',
  total_companies: '', total_workers: '', occupancy_pct: '', labor_availability: 'Trung bình', characteristics: '',
};

function TagList({ tags, onAdd, onRemove, color }: { tags: string[]; onAdd: (v: string) => void; onRemove: (i: number) => void; color: string }) {
  const [val, setVal] = useState('');
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {tags.map((t, i) => (
        <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${color}`}>
          {t}
          <button onClick={() => onRemove(i)} className="hover:opacity-70"><X size={10} /></button>
        </span>
      ))}
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && val.trim()) { onAdd(val.trim()); setVal(''); } }}
        placeholder="+ thêm"
        className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-gray-300 outline-none w-16 focus:w-24 transition-all"
      />
    </div>
  );
}

export default function ZonesTab({ marketZones, marketSurveys, goTab, onRefresh, toast }: MarketTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<MarketZone> | null>(null);

  const selected = marketZones.find(z => z.id === selectedId) || null;

  useEffect(() => {
    if (selected) {
      setEditForm({
        operator: selected.operator, area: selected.area, established_year: selected.established_year,
        characteristics: selected.characteristics, strengths: selected.strengths, weaknesses: selected.weaknesses,
        labor_availability: selected.labor_availability, lgv_clients: selected.lgv_clients, lgv_workers: selected.lgv_workers,
        notes: selected.notes, industries: selected.industries || [], countries: selected.countries || [],
      });
    } else {
      setEditForm(null);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddZone = async () => {
    if (!addForm.name.trim()) { toast('Nhập tên khu vực'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('market_zones').insert({
        name: addForm.name.trim(),
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
      });
      if (error) throw error;
      await onRefresh();
      setShowAdd(false);
      setAddForm(emptyAddForm);
      toast('Đã tạo hồ sơ khu vực!');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleSaveZone = async () => {
    if (!selected || !editForm) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('market_zones').update({
        ...editForm, updated_at: new Date().toISOString(),
      }).eq('id', selected.id);
      if (error) throw error;
      await onRefresh();
      toast('Đã lưu hồ sơ: ' + selected.name);
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleSetPotential = async (n: number) => {
    if (!selected) return;
    try {
      const { error } = await supabase.from('market_zones').update({ potential: n, updated_at: new Date().toISOString() }).eq('id', selected.id);
      if (error) throw error;
      await onRefresh();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  if (selected && editForm) {
    const sh = selected.total_workers ? Math.round((selected.lgv_workers / selected.total_workers) * 100) : 0;
    const wageRows = marketSurveys.filter(s => s.zone_name === selected.name);
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => setSelectedId(null)} className="p-1.5 rounded-lg border border-[#E8E7E2] hover:bg-[#F9F9F7]"><ArrowLeft size={14} /></button>
          <div>
            <div className="text-[13px] font-semibold text-[#111]">{selected.full_name || selected.name}</div>
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
          <div className="p-4 space-y-2.5">
            <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[150px] shrink-0">Ban quản lý</span>
              <input value={editForm.operator || ''} onChange={e => setEditForm(f => ({ ...f, operator: e.target.value }))} className="text-[12.5px] flex-1 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7]" />
            </div>
            <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[150px] shrink-0">Diện tích · Năm thành lập</span>
              <div className="flex gap-2 flex-1">
                <input value={editForm.area || ''} onChange={e => setEditForm(f => ({ ...f, area: e.target.value }))} className="text-[12.5px] w-24 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7]" />
                <input value={editForm.established_year || ''} onChange={e => setEditForm(f => ({ ...f, established_year: e.target.value }))} className="text-[12.5px] w-20 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7]" />
              </div>
            </div>
            <div className="flex gap-3 items-start"><span className="text-[11.5px] text-[#888] w-[150px] shrink-0 pt-1">Ngành nghề chủ yếu</span>
              <TagList tags={editForm.industries || []} color="bg-blue-50 text-blue-700"
                onAdd={v => setEditForm(f => ({ ...f, industries: [...(f?.industries || []), v] }))}
                onRemove={i => setEditForm(f => ({ ...f, industries: (f?.industries || []).filter((_, idx) => idx !== i) }))} />
            </div>
            <div className="flex gap-3 items-start"><span className="text-[11.5px] text-[#888] w-[150px] shrink-0 pt-1">FDI từ quốc gia</span>
              <TagList tags={editForm.countries || []} color="bg-violet-50 text-violet-700"
                onAdd={v => setEditForm(f => ({ ...f, countries: [...(f?.countries || []), v] }))}
                onRemove={i => setEditForm(f => ({ ...f, countries: (f?.countries || []).filter((_, idx) => idx !== i) }))} />
            </div>
            <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[150px] shrink-0">Nguồn lao động</span>
              <select value={editForm.labor_availability} onChange={e => setEditForm(f => ({ ...f, labor_availability: e.target.value }))} className="text-[12.5px] px-2 py-1 rounded border border-gray-200 outline-none bg-white">
                {LABOR_AVAIL_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="flex gap-3 items-start"><span className="text-[11.5px] text-[#888] w-[150px] shrink-0 pt-1">Đặc thù</span>
              <textarea value={editForm.characteristics || ''} onChange={e => setEditForm(f => ({ ...f, characteristics: e.target.value }))} rows={2} className="text-[12.5px] flex-1 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7] resize-none" />
            </div>
            <div className="flex gap-3 items-start"><span className="text-[11.5px] text-emerald-600 w-[150px] shrink-0 pt-1">✓ Điểm mạnh</span>
              <textarea value={editForm.strengths || ''} onChange={e => setEditForm(f => ({ ...f, strengths: e.target.value }))} rows={2} className="text-[12.5px] flex-1 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7] resize-none" />
            </div>
            <div className="flex gap-3 items-start"><span className="text-[11.5px] text-red-500 w-[150px] shrink-0 pt-1">✗ Điểm yếu</span>
              <textarea value={editForm.weaknesses || ''} onChange={e => setEditForm(f => ({ ...f, weaknesses: e.target.value }))} rows={2} className="text-[12.5px] flex-1 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7] resize-none" />
            </div>
            <div className="flex gap-3 items-center"><span className="text-[11.5px] text-[#888] w-[150px] shrink-0">P. Kinh Doanh</span>
              <div className="flex items-center gap-2 text-[12.5px]">
                <input type="number" value={editForm.lgv_clients ?? 0} onChange={e => setEditForm(f => ({ ...f, lgv_clients: parseInt(e.target.value) || 0 }))} className="w-16 px-2 py-1 rounded border border-gray-200 outline-none" /> KH ·
                <input type="number" value={editForm.lgv_workers ?? 0} onChange={e => setEditForm(f => ({ ...f, lgv_workers: parseInt(e.target.value) || 0 }))} className="w-20 px-2 py-1 rounded border border-gray-200 outline-none" /> LĐ
              </div>
            </div>
            <div className="flex gap-3 items-start"><span className="text-[11.5px] text-[#888] w-[150px] shrink-0 pt-1">Ghi chú chiến lược</span>
              <textarea value={editForm.notes || ''} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="text-[12.5px] flex-1 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 outline-none bg-transparent focus:bg-[#F9F9F7] resize-none" />
            </div>
          </div>
        </div>

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
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
          <Plus size={13} /> Thêm khu vực
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {marketZones.map(z => (
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

      {marketZones.length === 0 && (
        <div className="text-center py-8 text-[12px] text-[#aaa]">Chưa có hồ sơ khu vực nào. Bấm "Thêm khu vực" để bắt đầu.</div>
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
                <input value={addForm.location} onChange={e => setAddForm(f => ({ ...f, location: e.target.value }))} placeholder="Đồng Nai" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" /></div>
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
              <div className="col-span-2 flex flex-col gap-1"><label className="text-[12px] text-[#666] font-medium">Đặc thù sơ bộ</label>
                <textarea value={addForm.characteristics} onChange={e => setAddForm(f => ({ ...f, characteristics: e.target.value }))} rows={2} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 resize-none" /></div>
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
