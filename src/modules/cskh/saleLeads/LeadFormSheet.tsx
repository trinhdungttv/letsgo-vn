// Form thêm / sửa 1 đầu mối. Gõ SĐT là dò trùng ngay: trùng bảng nháp hoặc đã là Sale / CTV → không lưu
// (mở dòng đã có thay vì tạo trùng); trùng người liên hệ của khách → chỉ nhắc, vẫn lưu được.
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { deleteSaleLeads, insertSaleLead, updateSaleLead, type SaleLeadInput } from '../../../lib/saleLeads/api';
import { matchAreaZones, matchCompetitor, ownersOf, type NamedItem, type PhoneOwner } from '../../../lib/saleLeads/match';
import { phoneKeysOf } from '../../../lib/saleLeads/parse';
import { SALE_LEAD_STATUS_HINT, SALE_LEAD_STATUS_LABEL, SALE_LEAD_STATUSES, type SaleLead, type SaleLeadStatus } from '../../../lib/saleLeads/types';
import { CatalogPick } from '../components/CatalogPick';
import { ChoiceChip, Sheet, SHEET_FOOTER } from '../components/Sheet';
import { inputCls } from '../ui';
import { PhoneCheckBox } from './parts';

const labelCls = 'block text-[12px] font-medium text-[#6E6E73] mb-1';

export function LeadFormSheet({ lead, initialPhone = '', zones, competitors, companies, phoneIndex, toast, onClose, onSaved, onOpenLead, onOpenSale }: {
  /** null = thêm mới. */
  lead: SaleLead | null;
  /** Thêm mới từ ô tra số: điền sẵn SĐT. */
  initialPhone?: string;
  zones: readonly NamedItem[];
  competitors: readonly NamedItem[];
  /** Tên đơn vị đã gặp trong bảng nháp (gợi ý khi gõ). */
  companies: readonly string[];
  phoneIndex: ReadonlyMap<string, PhoneOwner[]>;
  toast: (m: string) => void;
  onClose: () => void;
  onSaved: () => void;
  /** Số trùng 1 đầu mối khác → mở dòng đó. */
  onOpenLead: (id: string) => void;
  /** Số đã là Sale / CTV → mở hồ sơ Sale. */
  onOpenSale: (contactId: string) => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState(lead?.fullName ?? '');
  const [phone, setPhone] = useState(lead?.phone ?? initialPhone);
  const [company, setCompany] = useState(lead?.company ?? '');
  const [zoneIds, setZoneIds] = useState<string[]>(lead?.zoneIds ?? []);
  const [areaText, setAreaText] = useState(lead?.areaText ?? '');
  const [channelUrl, setChannelUrl] = useState(lead?.channelUrl ?? '');
  const [postUrl, setPostUrl] = useState(lead?.postUrl ?? '');
  const [note, setNote] = useState(lead?.note ?? '');
  const [status, setStatus] = useState<SaleLeadStatus>(lead?.status ?? 'new');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const keys = useMemo(() => phoneKeysOf(phone), [phone]);
  const owners = useMemo(() => ownersOf(keys, phoneIndex, lead?.id), [keys, phoneIndex, lead?.id]);
  const blocker = owners.find(o => o.kind === 'lead' || o.kind === 'sale');
  const competitor = useMemo(() => matchCompetitor(company, competitors), [company, competitors]);
  // Gõ chữ khu vực → tự chọn những KCN có trong danh mục
  const areaMatch = useMemo(() => matchAreaZones(areaText, zones), [areaText, zones]);
  const suggestZones = areaMatch.ids.filter(id => !zoneIds.includes(id));

  const save = async () => {
    if (!name.trim() && !keys.length) { setError('Nhập tên hoặc SĐT'); return; }
    if (phone.trim() && !keys.length) { setError('SĐT không đúng — số di động 10 số (VD 0912 345 678)'); return; }
    if (blocker) { setError(blocker.kind === 'sale' ? 'Số này đã là Sale / CTV — không cần thêm vào bảng nháp' : 'Số này đã có trong bảng nháp — mở dòng đó để ghi tiếp'); return; }
    const input: SaleLeadInput = {
      fullName: name, phone, company, zoneIds: [...new Set([...zoneIds, ...suggestZones])], areaText, channelUrl, postUrl, note,
      // Trạng thái "Đã chuyển" chỉ đặt bằng nút Chuyển sang Sale / CTV
      status: status === 'promoted' && lead?.status !== 'promoted' ? undefined : status,
    };
    setSaving(true);
    setError('');
    try {
      if (lead) await updateSaleLead(lead.id, input, user);
      else await insertSaleLead(input, user, 'Thêm tay');
      toast(lead ? 'Đã lưu đầu mối' : `Đã thêm đầu mối "${name.trim() || phone.trim()}"`);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!lead) return;
    if (!confirm(`Xoá đầu mối "${lead.fullName || lead.phone}" khỏi bảng nháp?\n\nXoá rồi thì số này KHÔNG còn được dò trùng nữa (lần sau nhập lại sẽ coi là số mới). `
      + 'Người đã gọi mà không hợp tác thì nên chọn tình trạng "Từ chối" thay vì xoá.\n\nKhôi phục được ở trang Lịch sử (Hoàn tác).')) return;
    setSaving(true);
    try {
      await deleteSaleLeads([lead.id], user);
      toast('Đã xoá đầu mối');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Sheet label={lead ? 'Sửa đầu mối' : 'Thêm đầu mối'} onClose={onClose} wide>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] pr-10">{lead ? 'Sửa đầu mối' : 'Thêm đầu mối'}</h2>
      <p className="text-[13px] text-[#6E6E73] mt-0.5">Bảng nháp — chưa chăm sóc, không nhắc việc. Gặp được rồi thì chuyển sang Sale / CTV.</p>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 rounded-[14px] bg-white md:bg-[#F5F5F7] p-3.5 md:p-4">
        <div>
          <label className={labelCls}>Tên</label>
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="VD: Hồng Ngân HR" autoFocus={!initialPhone} />
        </div>
        <div>
          <label className={labelCls}>SĐT</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} inputMode="tel" placeholder="0912 345 678 — nhiều số cách dấu phẩy" />
        </div>
        {phone.trim() && (
          <div className="md:col-span-2">
            {keys.length
              ? <PhoneCheckBox keys={keys} owners={owners} />
              : <p className="text-[12.5px] text-[#D70015]">Chưa đọc được số — số di động 10 số, VD 0912 345 678.</p>}
            {blocker && (
              <button type="button" onClick={() => (blocker.kind === 'sale' ? onOpenSale(blocker.id) : onOpenLead(blocker.id))}
                className="mt-1.5 text-[13px] font-medium text-[#0066CC] hover:opacity-70">
                {blocker.kind === 'sale' ? 'Mở hồ sơ Sale / CTV này ›' : 'Mở đầu mối đã có ›'}
              </button>
            )}
          </div>
        )}
        <div>
          <label className={labelCls}>Đơn vị / nơi làm</label>
          <input value={company} onChange={e => setCompany(e.target.value)} className={inputCls} list="sale-lead-companies" placeholder="VD: Manpower, Green Speed, làm tự do" />
          <datalist id="sale-lead-companies">
            {[...new Set([...companies, ...competitors.map(c => c.name)])].map(c => <option key={c} value={c} />)}
          </datalist>
          {competitor && <p className="text-[11.5px] text-[#B25000] mt-1">Trùng tên đối thủ «{competitor.name}» (Thị trường → Đối thủ)</p>}
        </div>
        <div>
          <label className={labelCls}>Khu vực (chữ)</label>
          <input value={areaText} onChange={e => setAreaText(e.target.value)} className={inputCls} placeholder="VD: KCN VSIP 1-2, KCN Mỹ Phước 3" />
          {areaMatch.unmatched.length > 0 && areaText.trim() && (
            <p className="text-[11.5px] text-[#86868B] mt-1">Chưa có trong danh mục KCN: {areaMatch.unmatched.join(', ')}</p>
          )}
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>KCN (để lọc){suggestZones.length > 0 && <span className="font-normal text-[#248A3D]"> · tự thêm khi lưu: {zones.filter(z => suggestZones.includes(z.id)).map(z => z.name).join(', ')}</span>}</label>
          <CatalogPick items={zones} value={zoneIds} onChange={setZoneIds} addLabel="Thêm KCN…" emptyText="Chưa có KCN nào trong Thị trường → Khu vực." />
        </div>
        <div>
          <label className={labelCls}>Link kênh</label>
          <input value={channelUrl} onChange={e => setChannelUrl(e.target.value)} className={inputCls} inputMode="url" placeholder="Trang Facebook / Zalo / TikTok…" />
        </div>
        <div>
          <label className={labelCls}>Link bài đăng</label>
          <input value={postUrl} onChange={e => setPostUrl(e.target.value)} className={inputCls} inputMode="url" placeholder="Bài đăng tuyển dụng" />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Ghi chú</label>
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className={`${inputCls} resize-y`} placeholder="VD: Đang tuyển cho Coherent" />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Tình trạng</label>
          <div className="flex flex-wrap gap-1.5">
            {SALE_LEAD_STATUSES.filter(s => s !== 'promoted' || lead?.status === 'promoted').map(s => (
              <span key={s} title={SALE_LEAD_STATUS_HINT[s]}><ChoiceChip active={status === s} onClick={() => setStatus(s)}>{SALE_LEAD_STATUS_LABEL[s]}</ChoiceChip></span>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-[13px] text-[#D70015]">{error}</p>}

      <div className={`${SHEET_FOOTER} mt-4 flex items-center gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        {lead && (
          <button type="button" onClick={remove} disabled={saving}
            className="inline-flex items-center gap-1.5 h-10 md:h-9 px-3.5 rounded-full text-[13px] font-medium text-[#D70015] hover:bg-[#FF3B30]/10 disabled:opacity-40 transition">
            <Trash2 size={15} /> Xoá
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="h-10 md:h-9 px-4 rounded-full text-[13px] font-medium text-[#1D1D1F] bg-black/[0.05] hover:bg-black/[0.08] transition">Huỷ</button>
        <button type="button" onClick={save} disabled={saving || !!blocker}
          className="h-10 md:h-9 px-5 rounded-full text-[13px] font-semibold text-white bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 transition">
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
    </Sheet>
  );
}
