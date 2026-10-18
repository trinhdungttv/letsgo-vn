import { useState } from 'react';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { useOffice } from '../../data/OfficeDataProvider';
import { fmtDate } from '../../lib/ops';
import type { AssetStatus, BdsAsset } from '../../lib/types';
import { Badge, Card, Field, Modal, TextInput, cls } from '../ui';

const STATUS: Record<AssetStatus, { label: string; tone: 'green' | 'blue' | 'amber' | 'red' | 'gray' }> = {
  ok: { label: 'Bình thường', tone: 'green' },
  maintenance: { label: 'Cần bảo trì', tone: 'amber' },
  repairing: { label: '⚙️ Đang sửa', tone: 'blue' },
  broken: { label: 'Hỏng', tone: 'red' },
  retired: { label: 'Đã thanh lý', tone: 'gray' },
};

type Form = Omit<BdsAsset, 'id'> & { id?: string };

export default function Assets() {
  const { rows, insert, patch, remove } = useOffice();
  const [form, setForm] = useState<Form | null>(null);
  const [filter, setFilter] = useState<'all' | AssetStatus>('all');
  const roomOf = new Map(rows.bds_rooms.map(r => [r.id, r]));
  const assets = [...rows.bds_assets]
    .filter(a => filter === 'all' || a.status === filter)
    .sort((a, b) => (a.code || '~').localeCompare(b.code || '~', 'vi', { numeric: true }) || a.name.localeCompare(b.name, 'vi'));
  const ticketCount = (id: string) => rows.bds_tickets.filter(t => t.asset_id === id && (t.status === 'open' || t.status === 'in_progress')).length;

  const nextCode = () => {
    const n = rows.bds_assets.map(a => Number((a.code || '').match(/(\d+)$/)?.[1] || 0)).reduce((m, x) => Math.max(m, x), 0) + 1;
    return `AS-${String(n).padStart(3, '0')}`;
  };

  const save = async () => {
    if (!form?.name.trim()) return;
    const data = {
      code: form.code?.trim() || null, name: form.name.trim(), room_id: form.room_id || null, location: form.location?.trim() || null,
      installed_on: form.installed_on || null, status: form.status, drive_url: form.drive_url?.trim() || null, note: form.note?.trim() || null,
    };
    if (form.id) { patch('bds_assets', form.id, data, true); setForm(null); }
    else if (await insert('bds_assets', data)) setForm(null);
  };

  return (
    <div className="space-y-3 md:space-y-4">
      <Card
        pad={false}
        title="Danh mục thiết bị"
        desc={`${rows.bds_assets.filter(a => a.status !== 'retired').length} thiết bị đang quản lý`}
        actions={<>
          <select className={cls.inputSm} value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
            <option value="all">Tất cả trạng thái</option>
            {(Object.keys(STATUS) as AssetStatus[]).map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
          <button className={`${cls.btn} ${cls.primary}`} onClick={() => setForm({ code: nextCode(), name: '', room_id: null, location: '', installed_on: null, status: 'ok', drive_url: '', note: '' })}><Plus size={13} /> Thêm thiết bị</button>
        </>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left`}>Mã TS</th>
                <th className={`${cls.th} text-left`}>Tên thiết bị</th>
                <th className={`${cls.th} text-left`}>Vị trí</th>
                <th className={`${cls.th} text-left`}>Ngày lắp đặt</th>
                <th className={`${cls.th} text-left`}>Trạng thái</th>
                <th className={`${cls.th} text-left`}>Hồ sơ</th>
                <th className={cls.th} />
              </tr>
            </thead>
            <tbody>
              {assets.map(a => {
                const room = a.room_id ? roomOf.get(a.room_id) : undefined;
                const open = ticketCount(a.id);
                return (
                  <tr key={a.id} className={`border-t border-gray-100 ${a.status === 'retired' ? 'opacity-60' : ''}`}>
                    <td className={`${cls.td} font-semibold`}>{a.code || '—'}</td>
                    <td className={cls.td}>{a.name}{a.note && <div className="text-[10.5px] text-gray-400">{a.note}</div>}</td>
                    <td className={cls.td}>{[room ? `${room.code}${room.name ? ` · ${room.name}` : ''}` : null, a.location].filter(Boolean).join(' · ') || '—'}</td>
                    <td className={cls.td}>{fmtDate(a.installed_on)}</td>
                    <td className={cls.td}>
                      <div className="flex flex-wrap gap-1"><Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>{open > 0 && <a href="#/office-tickets"><Badge tone="red">{open} sự cố mở</Badge></a>}</div>
                    </td>
                    <td className={cls.td}>{a.drive_url ? <a className="text-blue-600 hover:underline inline-flex items-center gap-1" href={a.drive_url} target="_blank" rel="noreferrer"><ExternalLink size={11} /> Drive</a> : '—'}</td>
                    <td className={`${cls.td} text-right`}>
                      <div className="flex justify-end gap-1">
                        <button className={`${cls.btn} ${cls.secondary} !py-1 !px-2`} onClick={() => setForm({ ...a, location: a.location || '', drive_url: a.drive_url || '', note: a.note || '' })}><Pencil size={12} /></button>
                        <button className="p-1 text-gray-300 hover:text-red-500" title="Xoá thiết bị" onClick={() => { if (confirm(`Xoá thiết bị "${a.name}"? (Các ticket liên quan vẫn giữ, chỉ bỏ liên kết)`)) remove('bds_assets', a.id); }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!assets.length && <tr><td colSpan={7} className="text-center text-gray-400 py-6">Chưa có thiết bị.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={!!form} onClose={() => setForm(null)} title={form?.id ? `Sửa thiết bị ${form.code || ''}` : 'Thêm thiết bị'}
        footer={<><button className={`${cls.btn} ${cls.secondary}`} onClick={() => setForm(null)}>Huỷ</button><button className={`${cls.btn} ${cls.primary}`} disabled={!form?.name.trim()} onClick={save}>Lưu</button></>}
      >
        {form && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Mã TS"><TextInput className="w-full" value={form.code || ''} onChange={v => setForm({ ...form, code: v })} /></Field>
            <Field label="Tên thiết bị *"><TextInput className="w-full" value={form.name} onChange={v => setForm({ ...form, name: v })} placeholder="Máy lạnh Daikin 2HP" /></Field>
            <Field label="Phòng">
              <select className={`${cls.inputSm} w-full`} value={form.room_id || ''} onChange={e => setForm({ ...form, room_id: e.target.value || null })}>
                <option value="">— Khu vực chung —</option>
                {rows.bds_rooms.map(r => <option key={r.id} value={r.id}>{r.code}{r.name ? ` — ${r.name}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Vị trí cụ thể"><TextInput className="w-full" value={form.location || ''} onChange={v => setForm({ ...form, location: v })} placeholder="Hành lang, toàn tòa nhà…" /></Field>
            <Field label="Ngày lắp đặt"><input type="date" className={`${cls.inputSm} w-full`} value={form.installed_on || ''} onChange={e => setForm({ ...form, installed_on: e.target.value || null })} /></Field>
            <Field label="Trạng thái">
              <select className={`${cls.inputSm} w-full`} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as AssetStatus })}>
                {(Object.keys(STATUS) as AssetStatus[]).map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
              </select>
            </Field>
            <Field label="Link Google Drive (hồ sơ, bảo hành)" className="sm:col-span-2"><TextInput className="w-full" value={form.drive_url || ''} onChange={v => setForm({ ...form, drive_url: v })} placeholder="https://drive.google.com/…" /></Field>
            <Field label="Ghi chú" className="sm:col-span-2"><TextInput className="w-full" value={form.note || ''} onChange={v => setForm({ ...form, note: v })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
