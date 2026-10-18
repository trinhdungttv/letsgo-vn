import { useState } from 'react';
import { Check, ExternalLink, History, Plus, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { useAuth } from '../../../../lib/auth';
import { useOffice } from '../../data/OfficeDataProvider';
import { sortCategories } from '../../data/selectors';
import { currentMonthKey, monthLabel, toMonthKey } from '../../lib/calc/months';
import { fmtVND } from '../../lib/calc/money';
import { TICKET_STEPS, ticketCode } from '../../lib/ops';
import type { BdsTicket, TicketPriority, TicketResponsibility } from '../../lib/types';
import { MoneyInput } from '../MoneyInput';
import { Badge, Banner, Card, Empty, Field, Modal, SubTabs, TextInput, cls } from '../ui';

const PRIORITY: Record<TicketPriority, { label: string; tone: 'gray' | 'blue' | 'amber' | 'red' }> = {
  low: { label: 'Thấp', tone: 'gray' }, normal: { label: 'Bình thường', tone: 'blue' }, high: { label: 'Cao', tone: 'amber' }, urgent: { label: 'Khẩn', tone: 'red' },
};
const RESP: Record<TicketResponsibility, string> = { undecided: 'Chưa xác định', building: 'Tòa nhà chịu chi phí', tenant: 'Khách thuê chịu chi phí' };
const STATUS = {
  open: { label: 'Chờ xử lý', tone: 'amber' as const },
  in_progress: { label: 'Đang xử lý', tone: 'blue' as const },
  done: { label: 'Đã đóng', tone: 'green' as const },
  cancelled: { label: 'Đã huỷ', tone: 'gray' as const },
};

const fmtDateTime = (s: string) => {
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function TicketCard({ tk }: { tk: BdsTicket }) {
  const { rows, calc, patch, insert, remove, setOpex, toast } = useOffice();
  const { user } = useAuth();
  const actor = user?.full_name || user?.username || null;
  const room = tk.room_id ? rows.bds_rooms.find(r => r.id === tk.room_id) : undefined;
  const asset = tk.asset_id ? rows.bds_assets.find(a => a.id === tk.asset_id) : undefined;
  const logs = rows.bds_maintenance_logs.filter(l => l.ticket_id === tk.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const [note, setNote] = useState('');
  const [resp, setResp] = useState<TicketResponsibility>(tk.responsibility === 'undecided' ? 'building' : tk.responsibility);
  const [cost, setCost] = useState<number>(Number(tk.estimated_cost) || 0);
  const [actual, setActual] = useState<number>(Number(tk.actual_cost ?? tk.estimated_cost) || 0);
  const [drive, setDrive] = useState(tk.drive_url || '');
  const [showLog, setShowLog] = useState(false);
  const cats = sortCategories(rows.bds_opex_categories);
  const [cat, setCat] = useState(() => cats.find(c => /sửa/i.test(c.name))?.id || cats[0]?.id || '');
  const next = tk.step_done + 1;
  const closed = tk.status === 'done' || tk.status === 'cancelled';
  const booked = logs.some(l => l.action.startsWith('Ghi vào chi phí vận hành'));

  const log = (step: number | null, action: string, extra: { note?: string | null; cost?: number | null } = {}) =>
    insert('bds_maintenance_logs', { ticket_id: tk.id, step, action, note: extra.note ?? null, cost: extra.cost ?? null, actor });

  const advance = async (fields: Partial<BdsTicket>, action: string, extra: { note?: string | null; cost?: number | null } = {}) => {
    patch('bds_tickets', tk.id, { ...fields, step_done: next, status: next >= 5 ? 'done' : 'in_progress' }, true);
    await log(next, action, { note: note.trim() || extra.note || null, cost: extra.cost ?? null });
    setNote('');
  };

  const doStep = async () => {
    if (next === 1) await advance({}, 'Đã kiểm tra hiện trạng');
    else if (next === 2) await advance({ responsibility: resp, estimated_cost: cost || null }, `Xác định: ${RESP[resp]}`, { cost: cost || null });
    else if (next === 3) await advance({ cost_approved_at: new Date().toISOString() }, resp === 'tenant' || tk.responsibility === 'tenant' ? 'Xác nhận khách tự chi trả' : `Duyệt chi ${fmtVND(tk.estimated_cost || 0)}`, { cost: tk.estimated_cost });
    else if (next === 4) await advance({ actual_cost: actual || null }, 'Đã sửa chữa / thay thế xong', { cost: actual || null });
    else if (next === 5) {
      if (!/^https?:\/\//i.test(drive.trim())) { toast('Cần dán link Google Drive (bắt đầu bằng https://) trước khi đóng ticket'); return; }
      await advance({ drive_url: drive.trim(), closed_at: new Date().toISOString() }, 'Nghiệm thu & đóng ticket');
    }
  };

  const bookOpex = async () => {
    const amount = Number(tk.actual_cost) || 0;
    const c = cats.find(x => x.id === cat);
    if (!c || !amount) return;
    const m = tk.closed_at ? toMonthKey(tk.closed_at.slice(0, 7)) : currentMonthKey();
    const existing = calc.opex[m]?.[c.id] || 0;
    if (!confirm(`Cộng ${fmtVND(amount)} vào "${c.name}" tháng ${monthLabel(m)} (đang ${fmtVND(existing)} → ${fmtVND(existing + amount)})?`)) return;
    setOpex(c.id, m, existing + amount);
    await log(null, `Ghi vào chi phí vận hành "${c.name}" ${monthLabel(m)}`, { cost: amount });
    toast('Đã cộng vào chi phí vận hành');
  };

  return (
    <div className={`bg-white rounded-xl border p-3 md:p-4 ${tk.priority === 'urgent' && !closed ? 'border-red-300' : 'border-[#E8E7E2]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-gray-400 font-semibold">#{ticketCode(tk.ticket_no)}</div>
          <div className="text-[13.5px] font-semibold text-[#111]">{tk.title}</div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Badge tone={PRIORITY[tk.priority].tone}>{PRIORITY[tk.priority].label}</Badge>
          <Badge tone={STATUS[tk.status].tone}>{STATUS[tk.status].label}</Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-gray-500 mt-1.5">
        <span>📍 {[room?.code, asset?.name, tk.location].filter(Boolean).join(' · ') || '—'}</span>
        {tk.reported_by && <span>👤 {tk.reported_by} báo</span>}
        <span>📅 {fmtDateTime(tk.reported_at)}</span>
        <span>💰 {tk.actual_cost ? `Thực tế ${fmtVND(tk.actual_cost)}` : tk.estimated_cost ? `Dự kiến ~${fmtVND(tk.estimated_cost)}` : 'Chưa xác định'}</span>
        {tk.responsibility !== 'undecided' && <span>⚖️ {RESP[tk.responsibility]}</span>}
      </div>
      {tk.note && <div className="text-[11.5px] text-gray-600 mt-1">💬 {tk.note}</div>}

      <ol className="mt-3 space-y-1.5">
        {TICKET_STEPS.map(s => {
          const done = tk.step_done >= s.step;
          const current = !closed && s.step === next;
          return (
            <li key={s.step} className={`flex gap-2 rounded-lg px-2 py-1.5 text-[12px] ${current ? 'bg-blue-50 border border-blue-200' : ''}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10.5px] font-bold ${done ? 'bg-emerald-500 text-white' : current ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {done ? <Check size={12} /> : s.step}
              </span>
              <div className="flex-1 min-w-0">
                <div className={done ? 'text-gray-500' : 'text-gray-800 font-medium'}>{s.title} <span className="text-gray-400 font-normal">({s.hint})</span></div>
                {current && (
                  <div className="mt-2 space-y-2">
                    {next === 2 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select className={cls.inputSm} value={resp} onChange={e => setResp(e.target.value as TicketResponsibility)}>
                          <option value="building">Hao mòn tự nhiên → Tòa nhà chịu</option>
                          <option value="tenant">Lỗi sử dụng → Khách thuê chịu</option>
                        </select>
                        <MoneyInput value={cost} onChange={setCost} placeholder="Chi phí dự kiến" />
                      </div>
                    )}
                    {next === 4 && <div className="max-w-[220px]"><MoneyInput value={actual} onChange={setActual} placeholder="Chi phí thực tế" /></div>}
                    {next === 5 && <TextInput className="w-full" value={drive} onChange={setDrive} placeholder="https://drive.google.com/… (ảnh nghiệm thu)" />}
                    <div className="flex flex-wrap gap-2">
                      <TextInput className="flex-1 min-w-[160px]" value={note} onChange={setNote} placeholder="Ghi chú (tuỳ chọn)" />
                      <button className={`${cls.btn} ${cls.primary}`} onClick={doStep}>
                        <Check size={13} /> {next === 1 ? 'Đã kiểm tra' : next === 2 ? 'Xác nhận' : next === 3 ? (tk.responsibility === 'tenant' ? 'Khách tự chi trả' : `Duyệt chi${tk.estimated_cost ? ` ${fmtVND(tk.estimated_cost)}` : ''}`) : next === 4 ? 'Đã sửa xong' : 'Đóng ticket'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-gray-100">
        {tk.drive_url && <a href={tk.drive_url} target="_blank" rel="noreferrer" className={`${cls.btn} ${cls.secondary} !py-1`}><ExternalLink size={12} /> Drive</a>}
        <button className={`${cls.btn} ${cls.ghost} !py-1`} onClick={() => setShowLog(v => !v)}><History size={12} /> Lịch sử ({logs.length})</button>
        {tk.status === 'done' && tk.responsibility === 'building' && (Number(tk.actual_cost) || 0) > 0 && !booked && cats.length > 0 && (
          <span className="flex items-center gap-1.5">
            <select className={cls.inputSm} value={cat} onChange={e => setCat(e.target.value)}>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button className={`${cls.btn} ${cls.secondary} !py-1`} onClick={bookOpex}>Ghi vào chi phí vận hành</button>
          </span>
        )}
        {booked && <Badge tone="green">Đã ghi vào CP vận hành</Badge>}
        <span className="ml-auto flex gap-1">
          {!closed && <button className={`${cls.btn} ${cls.ghost} !py-1`} onClick={async () => { if (confirm('Huỷ ticket này?')) { patch('bds_tickets', tk.id, { status: 'cancelled' }, true); await log(null, 'Huỷ ticket'); } }}><XCircle size={12} /> Huỷ</button>}
          {closed && <button className={`${cls.btn} ${cls.ghost} !py-1`} onClick={async () => { patch('bds_tickets', tk.id, { status: tk.step_done ? 'in_progress' : 'open', closed_at: null, ...(tk.step_done >= 5 ? { step_done: 4 } : {}) }, true); await log(null, 'Mở lại ticket'); }}><RotateCcw size={12} /> Mở lại</button>}
          <button className="p-1 text-gray-300 hover:text-red-500" title="Xoá ticket" onClick={() => { if (confirm(`Xoá vĩnh viễn ticket #${ticketCode(tk.ticket_no)} và ${logs.length} dòng lịch sử?`)) remove('bds_tickets', tk.id); }}><Trash2 size={13} /></button>
        </span>
      </div>
      {showLog && (
        <div className="mt-2 space-y-1 text-[11.5px] bg-gray-50 rounded-lg p-2">
          {logs.map(l => (
            <div key={l.id} className="flex flex-wrap gap-x-2">
              <span className="text-gray-400">{fmtDateTime(l.created_at)}</span>
              {l.step && <span className="text-gray-400">B{l.step}</span>}
              <span className="font-medium">{l.action}</span>
              {l.cost ? <span>· {fmtVND(l.cost)}</span> : null}
              {l.note && <span className="text-gray-500">· {l.note}</span>}
              {l.actor && <span className="text-gray-400">— {l.actor}</span>}
            </div>
          ))}
          {!logs.length && <div className="text-gray-400">Chưa có lịch sử.</div>}
        </div>
      )}
    </div>
  );
}

type NewTicket = { title: string; room_id: string; asset_id: string; location: string; reported_by: string; priority: TicketPriority; estimated_cost: number; note: string };

export default function Tickets() {
  const { rows, insert } = useOffice();
  const { user } = useAuth();
  const [tab, setTab] = useState<'open' | 'closed' | 'all'>('open');
  const [form, setForm] = useState<NewTicket | null>(null);
  const all = [...rows.bds_tickets].sort((a, b) => b.ticket_no - a.ticket_no);
  const isOpen = (t: BdsTicket) => t.status === 'open' || t.status === 'in_progress';
  const shown = all.filter(t => (tab === 'all' ? true : tab === 'open' ? isOpen(t) : !isOpen(t)));

  const create = async () => {
    if (!form?.title.trim()) return;
    const t = await insert('bds_tickets', {
      title: form.title.trim(), room_id: form.room_id || null, asset_id: form.asset_id || null, location: form.location.trim() || null,
      reported_by: form.reported_by.trim() || null, priority: form.priority, estimated_cost: form.estimated_cost || null, note: form.note.trim() || null,
    });
    if (t) {
      await insert('bds_maintenance_logs', { ticket_id: t.id, step: null, action: 'Tạo ticket', note: form.note.trim() || null, cost: null, actor: user?.full_name || user?.username || null });
      setForm(null);
      setTab('open');
    }
  };

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <SubTabs
          tabs={[
            { key: 'open', label: `Đang mở (${all.filter(isOpen).length})` },
            { key: 'closed', label: `Đã đóng / huỷ (${all.filter(t => !isOpen(t)).length})` },
            { key: 'all', label: `Tất cả (${all.length})` },
          ]}
          value={tab} onChange={setTab}
        />
        <button className={`${cls.btn} ${cls.primary}`} onClick={() => setForm({ title: '', room_id: '', asset_id: '', location: '', reported_by: '', priority: 'normal', estimated_cost: 0, note: '' })}><Plus size={13} /> Tạo ticket</button>
      </div>
      <Banner>🔧 Chi phí ticket <b>không</b> tự cộng vào Lời/Lỗ (tránh đếm trùng). Khi đóng ticket do tòa nhà chịu, bấm "Ghi vào chi phí vận hành" để cộng chi phí thực tế vào đúng tháng.</Banner>
      {shown.length ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">{shown.map(t => <TicketCard key={t.id} tk={t} />)}</div>
      ) : (
        <Card><Empty>{tab === 'open' ? 'Không có sự cố nào đang mở 🎉' : 'Chưa có ticket.'}</Empty></Card>
      )}

      <Modal
        open={!!form} onClose={() => setForm(null)} title="Tạo ticket sự cố / bảo trì"
        footer={<><button className={`${cls.btn} ${cls.secondary}`} onClick={() => setForm(null)}>Huỷ</button><button className={`${cls.btn} ${cls.primary}`} disabled={!form?.title.trim()} onClick={create}>Tạo ticket</button></>}
      >
        {form && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Mô tả sự cố *" className="sm:col-span-2"><TextInput className="w-full" value={form.title} onChange={v => setForm({ ...form, title: v })} placeholder="VD: Máy lạnh VP2 không mát" /></Field>
            <Field label="Phòng">
              <select className={`${cls.inputSm} w-full`} value={form.room_id} onChange={e => setForm({ ...form, room_id: e.target.value, asset_id: '' })}>
                <option value="">— Khu vực chung / không rõ —</option>
                {rows.bds_rooms.map(r => <option key={r.id} value={r.id}>{r.code}{r.name ? ` — ${r.name}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Thiết bị">
              <select className={`${cls.inputSm} w-full`} value={form.asset_id} onChange={e => setForm({ ...form, asset_id: e.target.value })}>
                <option value="">— Không —</option>
                {rows.bds_assets.filter(a => !form.room_id || a.room_id === form.room_id || !a.room_id).map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ''}{a.name}</option>)}
              </select>
            </Field>
            <Field label="Vị trí cụ thể"><TextInput className="w-full" value={form.location} onChange={v => setForm({ ...form, location: v })} placeholder="Hành lang tầng trệt…" /></Field>
            <Field label="Người báo"><TextInput className="w-full" value={form.reported_by} onChange={v => setForm({ ...form, reported_by: v })} placeholder="Cty Thịnh Phát / Bảo vệ…" /></Field>
            <Field label="Mức độ">
              <select className={`${cls.inputSm} w-full`} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as TicketPriority })}>
                {(Object.keys(PRIORITY) as TicketPriority[]).map(p => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
              </select>
            </Field>
            <Field label="Chi phí dự kiến (nếu biết)"><MoneyInput value={form.estimated_cost} onChange={v => setForm({ ...form, estimated_cost: v })} /></Field>
            <Field label="Ghi chú" className="sm:col-span-2"><TextInput className="w-full" value={form.note} onChange={v => setForm({ ...form, note: v })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
