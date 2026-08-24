// ============================================================================
// ContactPreviewPopup — bấm vào TÊN trong bảng liên hệ để xem nhanh thông tin,
// không cần mở form Sửa (vốn nặng và cho phép chỉnh sửa). Hiển thị đầy đủ mọi
// trường ĐÃ CÓ DỮ LIỆU — trường trống thì ẩn hẳn, đỡ rối mắt.
// Chỉ đọc — có nút "Sửa" để chuyển sang ContactFormModal khi cần thay đổi.
// ============================================================================
import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  Building2, Cake, CalendarHeart, Edit2, ExternalLink, FileText, Gift,
  Link2, Mail, MapPin, Phone, Radio, Share2, Star, X,
} from 'lucide-react';
import { AvatarCircle } from './AvatarUpload';
import { parseHobbies, linksOf, primaryClientIdsOf } from '../../lib/contactOps';
import { fetchSpecialDates, type SpecialDate } from '../../lib/contactSpecialDates';
import type { Contact } from '../../lib/types';

interface Props {
  contact: Contact;
  /** Chi nhánh suy ra qua các công ty đang gắn — đã tính sẵn ở trang cha. */
  branches: { id: string; name: string }[];
  onClose: () => void;
  onEdit: () => void;
}

const Row = ({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) => (
  <div className="flex items-start gap-2.5 text-[13px]">
    <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
    <div className="min-w-0 flex-1">
      <div className="text-[11px] text-gray-400 leading-tight">{label}</div>
      <div className="text-gray-800 break-words">{children}</div>
    </div>
  </div>
);

/** contentEditable rỗng vẫn để lại thẻ rỗng kiểu "<p><br></p>" — cần lọc ra
 * chứ không phải cứ có chuỗi là có nội dung thật để hiển thị. */
function hasVisibleText(html: string): boolean {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent!.trim().length > 0;
}

export default function ContactPreviewPopup({ contact: c, branches, onClose, onEdit }: Props) {
  const hobbies = parseHobbies(c.hobbies);
  const companies = linksOf(c);
  const isPrimaryAnywhere = primaryClientIdsOf(c).length > 0;
  const richNotesHtml = c.rich_notes && hasVisibleText(c.rich_notes) ? DOMPurify.sanitize(c.rich_notes) : '';

  const [specialDates, setSpecialDates] = useState<SpecialDate[]>([]);
  useEffect(() => { fetchSpecialDates(c.id).then(setSpecialDates); }, [c.id]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-start gap-3 sticky top-0 bg-white z-10">
          <AvatarCircle url={c.avatar_url} name={c.name} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-[15px] font-semibold text-gray-900">{c.name}</h3>
              {isPrimaryAnywhere && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />}
            </div>
            <div className="text-[12.5px] text-gray-500 mt-0.5">{c.role || 'Chưa rõ chức vụ'}</div>
            <div className="mt-1.5">
              {c.is_active ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">Đang phụ trách</span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">
                  Đã nghỉ{c.end_date ? ` · ${new Date(c.end_date).toLocaleDateString('vi-VN')}` : ''}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md shrink-0"><X className="w-4 h-4 text-gray-500" /></button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3.5">
          <Row icon={Building2} label="Công ty gắn">
            {companies.length ? (
              <div className="flex flex-wrap gap-1">
                {companies.map(l => (
                  <span key={l.client_id} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-gray-50 border border-gray-200 text-xs">
                    {l.clients?.name || 'Công ty'}
                    {l.is_primary && <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />}
                  </span>
                ))}
              </div>
            ) : <span className="text-gray-400">Chưa gắn công ty</span>}
          </Row>

          {branches.length > 0 && (
            <Row icon={MapPin} label="Chi nhánh">
              <div className="flex flex-wrap gap-1">
                {branches.map(b => (
                  <span key={b.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700">{b.name}</span>
                ))}
              </div>
            </Row>
          )}

          {c.phone && <Row icon={Phone} label="Số điện thoại">{c.phone}</Row>}
          {c.email && <Row icon={Mail} label="Email">{c.email}</Row>}
          {c.start_date && (
            <Row icon={Link2} label="Phụ trách từ ngày">{new Date(c.start_date).toLocaleDateString('vi-VN')}</Row>
          )}
          {c.channel && <Row icon={Radio} label="Kênh tiếp cận">{c.channel}</Row>}

          {c.address && (
            <Row icon={MapPin} label="Địa chỉ nhà">
              <div className="flex items-center gap-2 flex-wrap">
                <span>{c.address}</span>
                <a
                  href={c.map_link || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline shrink-0">
                  <ExternalLink className="w-3 h-3" /> Xem bản đồ
                </a>
              </div>
            </Row>
          )}

          {c.birthday && <Row icon={Cake} label="Ngày sinh">{new Date(c.birthday).toLocaleDateString('vi-VN')}</Row>}

          {c.social_link && (
            <Row icon={Share2} label="Facebook / LinkedIn">
              <a href={c.social_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">
                {c.social_link}
              </a>
            </Row>
          )}

          {hobbies.length > 0 && (
            <Row icon={Gift} label="Sở thích">
              <div className="flex flex-wrap gap-1">
                {hobbies.map(h => (
                  <span key={h} className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[11px]">{h}</span>
                ))}
              </div>
            </Row>
          )}

          {specialDates.length > 0 && (
            <Row icon={CalendarHeart} label="Ngày đặc biệt khác">
              <div className="space-y-0.5">
                {specialDates.map(d => (
                  <div key={d.id}>{d.label} — {new Date(d.date).toLocaleDateString('vi-VN')}</div>
                ))}
              </div>
            </Row>
          )}

          {c.notes && (
            <Row icon={FileText} label="Ghi chú ngắn">
              <span className="whitespace-pre-wrap">{c.notes}</span>
            </Row>
          )}

          {richNotesHtml && (
            <div className="text-[13px] pt-2 border-t border-gray-100">
              <div className="text-[11px] text-gray-400 mb-1">Ghi chú chi tiết</div>
              <div
                className="text-gray-700 prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                dangerouslySetInnerHTML={{ __html: richNotesHtml }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-3 py-1.5 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50">Đóng</button>
          <button onClick={onEdit} className="px-3 py-1.5 bg-[#1D4ED8] text-white rounded-lg text-[13px] font-medium hover:bg-[#1E40AF] flex items-center gap-1.5">
            <Edit2 className="w-3.5 h-3.5" /> Sửa
          </button>
        </div>
      </div>
    </div>
  );
}
