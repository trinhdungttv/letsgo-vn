import { useState } from 'react';
import { X as XIcon, Check, AlertCircle } from 'lucide-react';
import type { Branch, Manager, BranchType } from '../../lib/types';
import { parseLatLngFromLink, isValidVnLatLng } from '../../lib/geo';

interface AddBranchModalProps {
  open: boolean;
  onClose: () => void;
  branches: Branch[];
  managers: Manager[];
  provinces: string[];
  addBranch: (fields: Omit<Branch, 'id' | 'created_at' | 'updated_at'>) => Promise<Branch>;
  addManager: (fields: { name: string; phone: string | null; email: string | null; region: string | null }) => Promise<Manager>;
  addProvince: (name: string) => void;
  toast: (m: string) => void;
  onCreated: (branch: Branch) => void;
}

export default function AddBranchModal({
  open, onClose, branches, managers, provinces, addBranch, addManager, addProvince, toast, onCreated,
}: AddBranchModalProps) {
  const [branchType, setBranchType] = useState<BranchType>('contracted');
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [managerSel, setManagerSel] = useState('');
  const [newManagerName, setNewManagerName] = useState('');
  const [location, setLocation] = useState('');
  const [mapLink, setMapLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ name: string } | null>(null);

  if (!open) return null;

  const nameDup = name.trim() && branches.some(b => b.name.toLowerCase() === name.trim().toLowerCase());

  const reset = () => {
    setBranchType('contracted'); setName(''); setShortName('');
    setManagerSel(''); setNewManagerName(''); setLocation(''); setMapLink(''); setResult(null);
  };
  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { toast('Vui lòng nhập tên chi nhánh'); return; }
    if (nameDup) { toast('Tên chi nhánh này đã tồn tại'); return; }

    setSubmitting(true);
    try {
      let managerId: string | null = null;
      let managerName: string | null = null;
      if (managerSel === '__new__') {
        const trimmedMgr = newManagerName.trim();
        if (trimmedMgr) {
          const created = await addManager({ name: trimmedMgr, phone: null, email: null, region: null });
          managerId = created.id; managerName = created.name;
        }
      } else if (managerSel) {
        const found = managers.find(m => m.id === managerSel);
        managerId = found?.id ?? null; managerName = found?.name ?? null;
      }

      // Dán link Google Maps → tự sinh toạ độ cho tab Bản đồ (Thị trường)
      const mapPos = parseLatLngFromLink(mapLink);
      const created = await addBranch({
        name: trimmedName,
        short_name: shortName.trim() || null,
        manager_id: managerId,
        manager_name: managerName,
        manager_avatar_url: null,
        region: null,
        location: location || null,
        map_link: mapLink.trim() || null,
        ...(isValidVnLatLng(mapPos) ? { lat: mapPos.lat, lng: mapPos.lng, geocoded_at: new Date().toISOString() } : {}),
        address: null,
        phone: null,
        email: null,
        established_date: null,
        status: 'active',
        branch_type: branchType,
        notes: null,
        status_note: null,
        difficulties: null,
        opportunities: null,
      });

      onCreated(created);
      setResult({ name: trimmedName });
      toast(`Đã tạo chi nhánh "${trimmedName}"`);
    } catch (e) {
      toast('Lỗi: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-2xl p-5 w-[420px]">
          <div className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[12.5px] bg-emerald-50 text-emerald-700">
            <Check size={16} className="shrink-0 mt-0.5" />
            <span>
              Đã tạo chi nhánh <strong>{result.name}</strong>. Gán khách hàng cho chi nhánh này ở trang Khách hàng.
            </span>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => reset()} className="flex-1 py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
              Thêm CN khác
            </button>
            <button onClick={handleClose} className="flex-1 py-2 rounded-lg text-[13px] font-semibold bg-[#0F6E56] text-white hover:opacity-90 transition">
              Đóng
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div>
            <div className="text-[15px] font-semibold text-[#111]">Thêm chi nhánh mới</div>
            <div className="text-[11px] text-[#999] mt-0.5">Tên và Khu vực được kiểm tra trùng riêng biệt</div>
          </div>
          <button onClick={handleClose} className="text-[#aaa] hover:text-[#666]"><XIcon size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-[11px] text-[#777] block mb-1">Loại chi nhánh</label>
            <div className="flex border border-gray-300 rounded-lg overflow-hidden max-w-[320px]">
              <button type="button" onClick={() => setBranchType('contracted')}
                className={`flex-1 py-1.5 text-[12px] font-medium transition ${branchType === 'contracted' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}>
                Đã khoán
              </button>
              <button type="button" onClick={() => setBranchType('company')}
                className={`flex-1 py-1.5 text-[12px] font-medium transition border-l border-gray-300 ${branchType === 'company' ? 'bg-blue-50 text-blue-700' : 'text-[#999] hover:text-[#555]'}`}>
                Dự án công ty
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[11px] text-[#777] block mb-1">Tên chi nhánh *</label>
              <input
                autoFocus type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Biên Hoà - Ms Thương"
                className={`w-full text-[13px] px-2.5 py-2 border rounded-lg outline-none focus:border-blue-500 ${nameDup ? 'border-red-400' : 'border-gray-300'}`}
              />
              {nameDup && (
                <div className="flex items-center gap-1 text-[11px] text-red-600 mt-1">
                  <AlertCircle size={12} /> Tên này đã tồn tại
                </div>
              )}
            </div>
            <div>
              <label className="text-[11px] text-[#777] block mb-1">Tên rút gọn</label>
              <input type="text" value={shortName} onChange={e => setShortName(e.target.value)} placeholder="BH" className="w-full text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[11px] text-[#777] block mb-1">Trưởng VP - CN</label>
              <select value={managerSel} onChange={e => setManagerSel(e.target.value)} className="w-full text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none bg-white">
                <option value="">— Chọn quản lý —</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                <option value="__new__">+ Thêm quản lý mới...</option>
              </select>
              {managerSel === '__new__' && (
                <input
                  type="text" value={newManagerName} onChange={e => setNewManagerName(e.target.value)}
                  placeholder="Tên quản lý mới" autoFocus
                  className="w-full text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500 mt-1.5"
                />
              )}
            </div>
            <div>
              <label className="text-[11px] text-[#777] block mb-1">Tỉnh / Thành phố</label>
              <select value={location} onChange={e => {
                if (e.target.value === '__new__') {
                  const v = prompt('Nhập tên Tỉnh/Thành phố mới:');
                  if (v && v.trim()) { addProvince(v.trim()); setLocation(v.trim()); }
                  return;
                }
                setLocation(e.target.value);
              }} className="w-full text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none bg-white">
                <option value="">— Chọn địa danh —</option>
                {provinces.map(p => <option key={p} value={p}>{p}</option>)}
                <option value="__new__">+ Thêm tỉnh/thành mới…</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-[#777] block mb-1">Link Google Maps</label>
            <input type="text" value={mapLink} onChange={e => setMapLink(e.target.value)} placeholder="https://maps.app.goo.gl/..." className="w-full text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 sticky bottom-0 bg-white">
          <button onClick={handleClose} className="px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">Huỷ</button>
          <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-[#0F6E56] text-white hover:opacity-90 disabled:opacity-50 transition">
            {submitting ? 'Đang tạo...' : 'Tạo chi nhánh'}
          </button>
        </div>
      </div>
    </div>
  );
}
