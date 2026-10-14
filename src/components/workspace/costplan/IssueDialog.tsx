// Ghi nhận ĐÃ BAN HÀNH (đã gửi khách): ngày gửi, người nhận, kênh, ghi chú. Bấm xác nhận là lưu phương án luôn, kèm dấu vân tay
// nội dung báo giá lúc gửi — sau này sửa khác đi sẽ hiện "Đã sửa sau khi gửi khách".
import { useState } from 'react';
import { Send, X } from 'lucide-react';
import { ISSUE_CHANNEL_LABEL, type IssueChannel, type PlanIssue } from '../../../lib/costPlan/issue';
import { dateShort } from '../../../lib/costPlan/quoteDoc';
import { FONT, Seg, btnGhost, btnPrimary, field, labelCls } from './ui';

export type IssueInput = Pick<PlanIssue, 'date' | 'number' | 'to' | 'channel' | 'note'>;

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function IssueDialog({ reissue, docNumber, docDate, defaultTo, previous, dirty, onConfirm, onClose }: {
  /** Ban hành lại (đã gửi trước đó, nay gửi bản đã sửa) */
  reissue?: boolean;
  docNumber?: string;
  /** Ngày ghi trên báo giá */
  docDate?: string;
  defaultTo?: string;
  /** Các lần gửi trước */
  previous: PlanIssue[];
  /** Còn thay đổi chưa lưu — sẽ được lưu cùng */
  dirty?: boolean;
  onConfirm: (v: IssueInput) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [to, setTo] = useState(defaultTo ?? previous[previous.length - 1]?.to ?? '');
  const [channel, setChannel] = useState<IssueChannel>(previous[previous.length - 1]?.channel ?? 'zalo');
  const [note, setNote] = useState('');
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-3" style={{ fontFamily: FONT }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)] w-full max-w-[480px] text-[#1d1d1f] overflow-hidden">
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-black/[0.06]">
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold tracking-tight">{reissue ? 'Ban hành lại bản đã sửa' : 'Đánh dấu đã ban hành'}</div>
            <div className="text-[12px] text-[#86868b] leading-snug">Ghi nhận báo giá này ĐÃ GỬI KHÁCH — phân biệt với các bản nháp. Sửa sau khi gửi, hệ thống sẽ nhắc.</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[#6e6e73] hover:bg-[#f5f5f7] shrink-0"><X size={17} /></button>
        </div>
        <div className="px-5 py-4 space-y-3.5">
          {(docNumber || docDate) && (
            <div className="rounded-xl bg-[#f5f5f7] px-3.5 py-2.5 text-[12.5px] text-[#6e6e73]">
              Báo giá {docNumber ? <b className="text-[#1d1d1f]">{docNumber}</b> : ''}{docDate ? <> · ngày ghi trên báo giá <b className="text-[#1d1d1f]">{dateShort(docDate)}</b></> : ''}
              {docDate && docDate !== date && <button type="button" onClick={() => setDate(docDate)} className="ml-2 font-medium text-[#0071e3] hover:underline">Dùng ngày này</button>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={labelCls}>Ngày gửi khách</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${field} w-full`} /></label>
            <label className="block"><span className={labelCls}>Gửi cho</span>
              <input value={to} onChange={e => setTo(e.target.value)} placeholder="Anh/chị … (phòng mua hàng)" className={`${field} w-full`} /></label>
          </div>
          <div><span className={labelCls}>Kênh gửi</span>
            <Seg value={channel} onChange={setChannel} options={(Object.keys(ISSUE_CHANNEL_LABEL) as IssueChannel[]).map(k => ({ value: k, label: ISSUE_CHANNEL_LABEL[k] }))} /></div>
          <label className="block"><span className={labelCls}>Ghi chú (tuỳ chọn)</span>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="vd: gửi kèm hồ sơ năng lực, khách hẹn phản hồi thứ 6" className={`${field} w-full`} /></label>
          {previous.length > 0 && (
            <div className="text-[12px] text-[#86868b]">
              Đã gửi trước: {previous.slice(-3).map(p => `${dateShort(p.date)}${p.channel ? ` (${ISSUE_CHANNEL_LABEL[p.channel]})` : ''}`).join(' · ')}{previous.length > 3 ? ` · và ${previous.length - 3} lần khác` : ''}
            </div>
          )}
          {dirty && <div className="text-[12px] text-[#b25e00]">Các thay đổi chưa lưu sẽ được lưu cùng lúc — bản lưu này là bản đã gửi khách.</div>}
        </div>
        <div className="px-5 py-3 border-t border-black/[0.06] flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`${btnGhost} !h-9`}>Huỷ</button>
          <button type="button" disabled={!ok} onClick={() => onConfirm({ date, ...(docNumber ? { number: docNumber } : {}), ...(to.trim() ? { to: to.trim() } : {}), channel, ...(note.trim() ? { note: note.trim() } : {}) })}
            className={`${btnPrimary} !h-9 !px-5`}><Send size={14} />{reissue ? 'Lưu & ban hành lại' : 'Lưu & đánh dấu đã gửi'}</button>
        </div>
      </div>
    </div>
  );
}
