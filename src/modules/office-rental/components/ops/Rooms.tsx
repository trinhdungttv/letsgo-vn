import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useOffice } from '../../data/OfficeDataProvider';
import { LANDLORD_NAME, LANDLORD_SHORT, nextSortOrder, sortLeases } from '../../data/selectors';
import { fmtMoney, fmtUSD, fmtVND } from '../../lib/calc/money';
import { toVND } from '../../lib/calc/vat';
import { contractState, effectiveRoomStatus, occupancy, roomTenants, todayStr } from '../../lib/ops';
import type { BdsRoom } from '../../lib/types';
import { DecimalInput, MoneyInput } from '../MoneyInput';
import { Card, CurrencySelect, Field, Kpi, Modal, TextInput, cls } from '../ui';
import { ContractBadge, RoomStatusBadge } from './shared';

type RoomForm = Omit<BdsRoom, 'id'> & { id?: string; tenantId: string };

const emptyForm = (sort: number): RoomForm => ({
  code: '', name: '', area_m2: null, head_lease_id: null, location: '', status: 'vacant', list_price: null,
  list_currency: 'VND', sort_order: sort, note: '', tenantId: '',
});

export default function Rooms() {
  const { rows, calc, currentMonth, settings, insert, patch, remove } = useOffice();
  const leases = sortLeases(rows.bds_head_leases);
  const rooms = [...rows.bds_rooms].sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code, 'vi', { numeric: true }));
  const today = todayStr();
  const occ = occupancy(rows.bds_rooms, rows.bds_tenants);
  const rate = calc.settings.exchangeRate || 1;
  const [form, setForm] = useState<RoomForm | null>(null);
  const [saving, setSaving] = useState(false);

  const vacantLoss = rooms
    .filter(r => effectiveRoomStatus(r, rows.bds_tenants) === 'vacant')
    .reduce((a, r) => a + toVND(Number(r.list_price) || 0, r.list_currency, rate), 0);

  const open = (r?: BdsRoom) => {
    if (!r) { setForm(emptyForm(nextSortOrder(rooms))); return; }
    const t = roomTenants(r, rows.bds_tenants)[0];
    setForm({ ...r, name: r.name || '', location: r.location || '', note: r.note || '', tenantId: t?.id || '' });
  };

  const save = async () => {
    if (!form || !form.code.trim()) return;
    setSaving(true);
    const data = {
      code: form.code.trim(), name: form.name?.trim() || null, area_m2: form.area_m2, head_lease_id: form.head_lease_id,
      location: form.location?.trim() || null, status: form.status === 'occupied' ? 'vacant' as const : form.status,
      list_price: form.list_price || null, list_currency: form.list_currency, sort_order: form.sort_order, note: form.note?.trim() || null,
    };
    let id = form.id;
    if (id) patch('bds_rooms', id, data, true);
    else id = (await insert('bds_rooms', data))?.id;
    if (id) {
      // Gán khách: khách được chọn trỏ về phòng này; khách cũ của phòng (nếu bỏ chọn) được gỡ ra
      for (const t of rows.bds_tenants.filter(x => x.room_id === id && x.id !== form.tenantId)) patch('bds_tenants', t.id, { room_id: null }, true);
      if (form.tenantId) {
        const t = rows.bds_tenants.find(x => x.id === form.tenantId);
        if (t && t.room_id !== id) {
          patch('bds_tenants', t.id, { room_id: id, ...(form.head_lease_id && !t.head_lease_id ? { head_lease_id: form.head_lease_id } : {}) }, true);
        }
      }
      setForm(null);
    }
    setSaving(false);
  };

  const del = async (r: BdsRoom) => {
    const n = roomTenants(r, rows.bds_tenants).length;
    if (!confirm(`Xoá phòng ${r.code}?${n ? `\n${n} khách đang gán vào phòng này sẽ được gỡ (khách và doanh thu vẫn giữ nguyên).` : ''}`)) return;
    await remove('bds_rooms', r.id);
  };

  const groups = [
    ...leases.filter(l => !l.is_parking || rooms.some(r => r.head_lease_id === l.id)).map(l => ({ key: l.id, title: `${l.name}`, sub: LANDLORD_NAME[l.landlord], tag: LANDLORD_SHORT[l.landlord], list: rooms.filter(r => r.head_lease_id === l.id) })),
    { key: 'none', title: 'Chưa gán mặt bằng gốc', sub: '', tag: '', list: rooms.filter(r => !r.head_lease_id || !leases.some(l => l.id === r.head_lease_id)) },
  ].filter(g => g.list.length || g.key !== 'none');

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        <Kpi label="Số phòng" value={rooms.length} sub={`${rooms.filter(r => effectiveRoomStatus(r, rows.bds_tenants) === 'occupied').length} đang thuê`} />
        <Kpi label="Tỷ lệ lấp đầy" value={occ.rate === null ? '—' : `${Math.round(occ.rate * 100)}%`} sub={`${occ.occupied.toLocaleString('en-US')}/${occ.total.toLocaleString('en-US')} m²`} />
        <Kpi label="Phòng trống" tone={vacantLoss > 0 ? 'neg' : 'default'} value={rooms.filter(r => effectiveRoomStatus(r, rows.bds_tenants) === 'vacant').length} sub={vacantLoss > 0 ? `Bỏ phí ~${fmtVND(vacantLoss)}/tháng` : 'Theo giá chào'} />
        <div className="flex items-center justify-end"><button className={`${cls.btn} ${cls.primary}`} onClick={() => open()}><Plus size={13} /> Thêm phòng / chia mặt bằng</button></div>
      </div>

      {groups.map(g => (
        <Card key={g.key} title={<>{g.title} {g.tag && <span className="text-[11px] font-normal text-gray-400">· thuê từ {g.sub}</span>}</>} desc={g.list.length ? `${g.list.reduce((a, r) => a + (Number(r.area_m2) || 0), 0).toLocaleString('en-US')} m² · ${g.list.length} phòng` : 'Chưa chia phòng'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {g.list.map(r => {
              const st = effectiveRoomStatus(r, rows.bds_tenants);
              const ts = roomTenants(r, rows.bds_tenants);
              return (
                <div key={r.id} className={`rounded-xl border p-3 ${st === 'vacant' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-[#FCFCFB]'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-[#111]">{r.code}{r.name ? ` — ${r.name}` : ''}</div>
                      <div className="text-[11px] text-gray-500">📐 {r.area_m2 ? `${Number(r.area_m2).toLocaleString('en-US')} m²` : '— m²'}{r.location ? ` · ${r.location}` : ''}</div>
                    </div>
                    <RoomStatusBadge status={st} />
                  </div>
                  <div className="mt-2 space-y-1 text-[12px]">
                    {ts.map(t => {
                      const rent = calc.rent[currentMonth]?.[t.id] || 0;
                      return (
                        <div key={t.id}>
                          <div className="font-medium">🏢 {t.name}</div>
                          <div className="text-gray-500 flex flex-wrap items-center gap-1.5">
                            {rent > 0 ? <>Giá thuê: {fmtMoney(rent, t.currency)}{t.currency === 'USD' && ` (≈${fmtVND(rent * rate)})`}{r.area_m2 ? ` · ${fmtMoney(rent / Number(r.area_m2), t.currency)}/m²` : ''}</> : 'Chưa nhập tiền thuê tháng này'}
                          </div>
                          <ContractBadge c={contractState(t, today, settings.alert_days ?? 60)} />
                        </div>
                      );
                    })}
                    {!ts.length && (
                      <div className="text-gray-500">
                        {r.list_price ? <>Giá chào: <b>{fmtMoney(r.list_price, r.list_currency)}</b>/tháng{r.list_currency === 'USD' && ` (≈${fmtVND(r.list_price * rate)})`}</> : 'Chưa có giá chào'}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5 mt-2.5">
                    <button className={`${cls.btn} ${cls.secondary} !py-1 !px-2`} onClick={() => open(r)}><Pencil size={12} /> Sửa / gán khách</button>
                    <button className={`${cls.btn} ${cls.ghost} !py-1 !px-2 hover:!text-red-600`} onClick={() => del(r)}><Trash2 size={12} /></button>
                  </div>
                </div>
              );
            })}
            {!g.list.length && <div className="text-[12px] text-gray-400">Bấm "Thêm phòng" để chia mặt bằng này thành các phòng.</div>}
          </div>
        </Card>
      ))}

      <Modal
        open={!!form} onClose={() => setForm(null)}
        title={form?.id ? `Sửa phòng ${form.code}` : 'Thêm phòng / chia nhỏ mặt bằng'}
        footer={<>
          <button className={`${cls.btn} ${cls.secondary}`} onClick={() => setForm(null)}>Huỷ</button>
          <button className={`${cls.btn} ${cls.primary}`} disabled={!form?.code.trim() || saving} onClick={save}>{form?.id ? 'Lưu' : 'Tạo phòng'}</button>
        </>}
      >
        {form && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Mã phòng *"><TextInput className="w-full" value={form.code} onChange={v => setForm({ ...form, code: v })} placeholder="VP1, MT-01…" /></Field>
            <Field label="Tên phòng"><TextInput className="w-full" value={form.name || ''} onChange={v => setForm({ ...form, name: v })} placeholder="Phòng A" /></Field>
            <Field label="Mặt bằng gốc (CĐT)">
              <select className={`${cls.inputSm} w-full`} value={form.head_lease_id || ''} onChange={e => setForm({ ...form, head_lease_id: e.target.value || null })}>
                <option value="">— Chưa gán —</option>
                {leases.map(l => <option key={l.id} value={l.id}>{LANDLORD_SHORT[l.landlord]} · {l.name}</option>)}
              </select>
            </Field>
            <Field label="Diện tích (m²)"><DecimalInput value={form.area_m2} onChange={v => setForm({ ...form, area_m2: v })} /></Field>
            <Field label="Mô tả vị trí" className="sm:col-span-2"><TextInput className="w-full" value={form.location || ''} onChange={v => setForm({ ...form, location: v })} placeholder="Tầng trệt, cánh trái…" /></Field>
            <Field label="Khách đang thuê" hint="Có khách → phòng tự hiện 'Đang thuê'">
              <select className={`${cls.inputSm} w-full`} value={form.tenantId} onChange={e => setForm({ ...form, tenantId: e.target.value })}>
                <option value="">— Không có —</option>
                {rows.bds_tenants.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Khi không có khách">
              <select className={`${cls.inputSm} w-full`} value={form.status === 'reserved' ? 'reserved' : 'vacant'} onChange={e => setForm({ ...form, status: e.target.value as 'vacant' | 'reserved' })}>
                <option value="vacant">Trống</option>
                <option value="reserved">Giữ chỗ</option>
              </select>
            </Field>
            <Field label="Giá chào thuê / tháng" hint="Dùng để tính 'bỏ phí' khi trống">
              <div className="flex gap-1.5">
                <MoneyInput currency={form.list_currency} value={form.list_price} onChange={v => setForm({ ...form, list_price: v })} />
                <CurrencySelect value={form.list_currency} onChange={v => setForm({ ...form, list_currency: v })} />
              </div>
              {form.list_currency === 'USD' && !!form.list_price && <div className="text-[10.5px] text-gray-400 mt-0.5">≈ {fmtVND(form.list_price * rate)} · {fmtUSD(form.list_price)}</div>}
            </Field>
            <Field label="Ghi chú"><TextInput className="w-full" value={form.note || ''} onChange={v => setForm({ ...form, note: v })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
