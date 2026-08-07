import { useState, useMemo } from 'react';
import { X as XIcon, Check, Building2, MapPin, CalendarClock, Percent, AlertTriangle } from 'lucide-react';
import type { Client, Branch, Manager, BranchStaff, MarketZone, ServiceType } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import { parseLatLngFromLink, isValidVnLatLng } from '../../lib/geo';
import { normalizeDayRange } from '../../utils/timelineDays';
import DayCell from '../DayCell';

interface AddClientModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (client: Client) => void;
  branches: Branch[];
  managers: Manager[];
  allBranchStaffs: BranchStaff[];
  marketZones: MarketZone[];
  clients: Client[];
  toast: (m: string) => void;
}

type DayRow = { start: number | null; end: number | null };

function DayRangeField({
  label, dot, value, onChange,
}: { label: string; dot: string; value: DayRow; onChange: (v: DayRow) => void }) {
  // Dùng chung ô nhập với Tài chính: ô trái có nút CT-1, ô phải có nút CT.
  return (
    <div className="flex items-center gap-3">
      <div className="w-[100px] shrink-0 flex items-center gap-1.5 text-[12px] font-medium text-[#444]">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="flex-1">
        <label className="text-[10px] text-[#999] block mb-0.5">Ngày bắt đầu</label>
        <DayCell quick="eom1" value={value.start} onChange={v => onChange({ ...value, start: v })} />
      </div>
      <div className="flex-1">
        <label className="text-[10px] text-[#999] block mb-0.5">Ngày kết thúc</label>
        <DayCell quick="eom" value={value.end} onChange={v => onChange({ ...value, end: v })} />
      </div>
    </div>
  );
}

export default function AddClientModal({
  open, onClose, onCreated, branches, managers, allBranchStaffs, marketZones, clients, toast,
}: AddClientModalProps) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [region, setRegion] = useState('');
  const [manager, setManager] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [mapLink, setMapLink] = useState('');

  const [serviceType, setServiceType] = useState<ServiceType>('leasing');
  const [paymentTermDays, setPaymentTermDays] = useState(30);
  const [cutoff, setCutoff] = useState<DayRow>({ start: 25, end: null });
  const [calc, setCalc] = useState<DayRow>({ start: 27, end: null });
  const [salary, setSalary] = useState<DayRow>({ start: 5, end: null });

  const [projectType, setProjectType] = useState<'managed' | 'contracted'>('contracted');
  const [lgPct, setLgPct] = useState(40);
  const [cnPct, setCnPct] = useState(60);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; missing: string[]; name: string } | null>(null);

  const regionOptions = useMemo(() => [...new Set(branches.map(b => b.region || b.name))].sort(), [branches]);
  const branchForRegion = branches.find(b => (b.region || b.name) === region) || null;
  const branchStaffsForRegion = branchForRegion ? allBranchStaffs.filter(s => s.branch_id === branchForRegion.id) : [];
  const managerOptions = branchStaffsForRegion.length > 0
    ? branchStaffsForRegion.map(s => s.name)
    : managers.filter(m => !region || m.region === region).map(m => m.name);

  if (!open) return null;

  const reset = () => {
    setName(''); setNameError(''); setZoneName(''); setRegion(''); setManager('');
    setPhone(''); setEmail(''); setNotes(''); setMapLink(''); setServiceType('leasing'); setPaymentTermDays(30);
    setCutoff({ start: 25, end: null }); setCalc({ start: 27, end: null }); setSalary({ start: 5, end: null });
    setProjectType('contracted'); setLgPct(40); setCnPct(60); setResult(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const onZoneChange = (z: string) => {
    setZoneName(z);
    const zone = marketZones.find(mz => mz.name === z);
    if (!zone || !zone.location) return;
    const match = branches.find(b => (b.location || '').toLowerCase().includes(zone.location!.toLowerCase()) || (b.region || b.name).toLowerCase().includes(zone.location!.toLowerCase()));
    if (match) setRegion(match.region || match.name);
  };

  const onLgChange = (v: string) => { const n = Math.min(100, Math.max(0, +v || 0)); setLgPct(n); setCnPct(Math.round((100 - n) * 10) / 10); };
  const onCnChange = (v: string) => { const n = Math.min(100, Math.max(0, +v || 0)); setCnPct(n); setLgPct(Math.round((100 - n) * 10) / 10); };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setNameError('Vui lòng nhập tên công ty'); return; }
    if (clients.some(c => c.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setNameError('Tên công ty này đã tồn tại trong hệ thống');
      return;
    }
    setSubmitting(true);
    try {
      const nCutoff = normalizeDayRange(cutoff.start, cutoff.end);
      const nCalc = normalizeDayRange(calc.start, calc.end);
      const nSalary = normalizeDayRange(salary.start, salary.end);
      const leasingFields = serviceType !== 'recruitment'
        ? {
            cutoff_day: nCutoff.start, cutoff_day_end: nCutoff.end,
            calc_day: nCalc.start, calc_day_end: nCalc.end,
            salary_day: nSalary.start, salary_day_end: nSalary.end,
          }
        : { cutoff_day: null, calc_day: null, salary_day: null, cutoff_day_end: null, calc_day_end: null, salary_day_end: null };

      const payload = {
        name: trimmed,
        region: region || null,
        manager: manager || null,
        industrial_zones: zoneName ? [zoneName] : [],
        status: 'ok',
        client_type: 'active',
        service_type: serviceType,
        payment_term_days: serviceType === 'recruitment' ? paymentTermDays : 30,
        ...leasingFields,
        project_type: projectType,
        default_lg_pct: projectType === 'contracted' ? lgPct : 100,
        default_cn_pct: projectType === 'contracted' ? cnPct : 0,
        phone: phone || null,
        email: email || null,
        notes: notes || null,
        map_link: mapLink.trim() || null,
        // Dán link Google Maps → tự sinh toạ độ cho tab Bản đồ (Thị trường)
        ...(() => {
          const p = parseLatLngFromLink(mapLink);
          return isValidVnLatLng(p) ? { lat: p.lat, lng: p.lng, geocoded_at: new Date().toISOString() } : {};
        })(),
      };

      const { data, error } = await supabase.from('clients').insert(payload).select().single();
      if (error) throw error;
      const created = data as Client;

      onCreated(created);
      await logActivity({
        user, action: 'insert', table: 'clients', recordId: created.id,
        description: `Thêm khách hàng mới "${trimmed}"${region ? ` (${region})` : ''} - ${serviceType === 'recruitment' ? 'Giới thiệu lao động' : serviceType === 'hoh' ? 'HOH' : 'Cho thuê lao động'}`,
        newData: created,
      });

      const missing: string[] = [];
      if (!region) missing.push('chi nhánh');
      if (!manager) missing.push('người quản lý');
      if (serviceType !== 'recruitment' && !cutoff.start) missing.push('lịch chốt công');
      setResult({ ok: missing.length === 0, missing, name: trimmed });
      toast(`Đã thêm khách hàng "${trimmed}"`);
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
          <div className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[12.5px] ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {result.ok ? <Check size={16} className="shrink-0 mt-0.5" /> : <AlertTriangle size={16} className="shrink-0 mt-0.5" />}
            <span>
              Đã tạo <strong>{result.name}</strong> {result.ok ? 'với đầy đủ thông tin.' : `nhưng còn thiếu ${result.missing.join(', ')} — bổ sung sau trong trang Khách hàng.`}
            </span>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => { reset(); }} className="flex-1 py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
              Thêm KH khác
            </button>
            <button onClick={handleClose} className="flex-1 py-2 rounded-lg text-[13px] font-semibold bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
              Đóng
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-[640px] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div>
            <div className="text-[15px] font-semibold text-[#111]">Thêm khách hàng mới</div>
            <div className="text-[11px] text-[#999] mt-0.5">Chỉ tên công ty là bắt buộc — phần còn lại có thể bổ sung sau</div>
          </div>
          <button onClick={handleClose} className="text-[#aaa] hover:text-[#666]"><XIcon size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Company info */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Building2 size={14} className="text-[#999]" />
              <span className="text-[12px] font-medium text-[#555]">Thông tin công ty</span>
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">bắt buộc</span>
            </div>
            <input
              autoFocus type="text" value={name}
              onChange={e => { setName(e.target.value); setNameError(''); }}
              placeholder="VD: Samsung Electronics Việt Nam"
              className={`w-full text-[13px] px-3 py-2 border rounded-lg outline-none focus:border-blue-500 ${nameError ? 'border-red-400' : 'border-gray-300'}`}
            />
            {nameError && <div className="text-[11px] text-red-600 mt-1">{nameError}</div>}
          </div>

          {/* Location */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-1.5 mb-2">
              <MapPin size={14} className="text-[#999]" />
              <span className="text-[12px] font-medium text-[#555]">Vị trí và liên kết module</span>
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">tuỳ chọn</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[11px] text-[#777] block mb-1">Khu công nghiệp (Thị trường)</label>
                <select value={zoneName} onChange={e => onZoneChange(e.target.value)} className="w-full text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none bg-white">
                  <option value="">— Chọn KCN —</option>
                  {marketZones.map(z => <option key={z.id} value={z.name}>{z.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-[#777] block mb-1">Chi nhánh phụ trách</label>
                <select value={region} onChange={e => { setRegion(e.target.value); setManager(''); }} className="w-full text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none bg-white">
                  <option value="">— Chọn chi nhánh —</option>
                  {regionOptions.map(r => <option key={r} value={r}>{branches.find(b => (b.region || b.name) === r)?.name || r}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-2.5">
              <label className="text-[11px] text-[#777] block mb-1">Người quản lý</label>
              <select value={manager} onChange={e => setManager(e.target.value)} className="w-full text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none bg-white">
                <option value="">— Chọn quản lý —</option>
                {managerOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Timeline */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-1.5 mb-1">
              <CalendarClock size={14} className="text-[#999]" />
              <span className="text-[12px] font-medium text-[#555]">Lịch chốt công / tính lương / phát lương</span>
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">tuỳ chọn</span>
            </div>
            <div className="text-[10.5px] text-[#999] mb-2.5">Dùng chung dữ liệu với Tài chính → Timeline KH — sửa ở đâu cũng đồng bộ.</div>

            <div className="flex border border-gray-300 rounded-lg overflow-hidden max-w-[300px] mb-3">
              <button type="button" onClick={() => setServiceType('leasing')}
                className={`flex-1 py-1.5 text-[11.5px] font-medium transition ${serviceType === 'leasing' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}>
                Cho thuê lao động
              </button>
              <button type="button" onClick={() => setServiceType('recruitment')}
                className={`flex-1 py-1.5 text-[11.5px] font-medium transition border-l border-gray-300 ${serviceType === 'recruitment' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}>
                Giới thiệu LĐ
              </button>
              <button type="button" onClick={() => setServiceType('hoh')}
                className={`flex-1 py-1.5 text-[11.5px] font-medium transition border-l border-gray-300 ${serviceType === 'hoh' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}>
                HOH
              </button>
            </div>

            {serviceType !== 'recruitment' ? (
              <div className="space-y-2.5">
                <DayRangeField label="Chốt công" dot="bg-orange-400" value={cutoff} onChange={setCutoff} />
                <DayRangeField label="Tính lương" dot="bg-blue-400" value={calc} onChange={setCalc} />
                <DayRangeField label="Phát lương" dot="bg-purple-500" value={salary} onChange={setSalary} />
              </div>
            ) : (
              <div>
                <label className="text-[11px] text-[#777] block mb-1">Thời hạn công nợ (ngày sau xuất HĐ)</label>
                <input type="number" min={1} value={paymentTermDays} onChange={e => setPaymentTermDays(+e.target.value || 30)} className="w-[140px] text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none" />
              </div>
            )}
          </div>

          {/* Khoán */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Percent size={14} className="text-[#999]" />
              <span className="text-[12px] font-medium text-[#555]">Khoán và phân chia lợi nhuận</span>
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">tuỳ chọn</span>
            </div>
            <div className="flex border border-gray-300 rounded-lg overflow-hidden max-w-[320px] mb-3">
              <button type="button" onClick={() => setProjectType('managed')}
                className={`flex-1 py-1.5 text-[11.5px] font-medium transition ${projectType === 'managed' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}>
                Không khoán - Nhận lương
              </button>
              <button type="button" onClick={() => setProjectType('contracted')}
                className={`flex-1 py-1.5 text-[11.5px] font-medium transition border-l border-gray-300 ${projectType === 'contracted' ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#999] hover:text-[#555]'}`}>
                Đã nhận khoán
              </button>
            </div>
            {projectType === 'contracted' && (
              <div className="flex items-center gap-2.5">
                <span className="text-[12px] text-[#666]">Let's Go VN</span>
                <input type="number" min={0} max={100} value={lgPct} onChange={e => onLgChange(e.target.value)} className="w-[64px] text-[13px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none text-right" />
                <span className="text-[12px] text-[#999]">%</span>
                <span className="text-[12px] text-[#666] ml-2">Chi nhánh</span>
                <input type="number" min={0} max={100} value={cnPct} onChange={e => onCnChange(e.target.value)} className="w-[64px] text-[13px] px-2 py-1.5 border border-gray-300 rounded-lg outline-none text-right" />
                <span className="text-[12px] text-[#999]">%</span>
              </div>
            )}
          </div>

          {/* Contact */}
          <div className="border-t border-gray-100 pt-4">
            <div className="text-[12px] font-medium text-[#555] mb-2">Liên hệ</div>
            <div className="grid grid-cols-2 gap-2.5">
              <input type="text" placeholder="Điện thoại" value={phone} onChange={e => setPhone(e.target.value)} className="text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none" />
              <input type="text" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none" />
            </div>
            <input type="text" placeholder="Link Google Maps (…/@lat,lng…) → tự định vị lên Bản đồ Thị trường" value={mapLink} onChange={e => setMapLink(e.target.value)} className="w-full mt-2.5 text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none" />
            <textarea rows={2} placeholder="Ghi chú nội bộ..." value={notes} onChange={e => setNotes(e.target.value)} className="w-full mt-2.5 text-[13px] px-2.5 py-2 border border-gray-300 rounded-lg outline-none resize-none" />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 sticky bottom-0 bg-white">
          <button onClick={handleClose} className="px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">Huỷ</button>
          <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-50 transition">
            {submitting ? 'Đang tạo...' : 'Tạo khách hàng'}
          </button>
        </div>
      </div>
    </div>
  );
}
