// Ô chọn người liên hệ: tìm không dấu (tên, công ty, SĐT…), người đang chăm sóc lên trước.
// Đã chọn thì hiện thẻ người đó + nút "Đổi".
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { compareVnName } from '../../../lib/vnName';
import { contactSearchHaystack, matchesQuery } from '../../../lib/cskh/search';
import type { CskhContact } from '../../../lib/cskh/types';
import { TIER_LABEL } from '../../../lib/cskh/types';
import { inputCls } from '../ui';
import { ContactAvatar } from './ContactAvatar';

export function ContactPicker({ contacts, value, onChange, autoFocus = true }: {
  contacts: readonly CskhContact[];
  value: string;
  onChange: (contact: CskhContact | null) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const contact = contacts.find(c => c.id === value) ?? null;

  // Người đã nghỉ không ghi nhận được; người đang chăm sóc lên trước, rồi theo vần tên gọi
  const matches = useMemo(() => contacts
    .filter(c => !c.isArchived && matchesQuery(contactSearchHaystack(c), query))
    .sort((a, b) => Number(a.tier === 'unclassified') - Number(b.tier === 'unclassified') || compareVnName(a.fullName, b.fullName))
    .slice(0, 8), [contacts, query]);

  if (contact) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-[12px] bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.12)]">
        <ContactAvatar name={contact.fullName} url={contact.avatarUrl} tier={contact.tier} size={30} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#1D1D1F] truncate">{contact.fullName}</div>
          <div className="text-[11.5px] text-[#86868B] truncate">
            {[contact.jobTitle, contact.organization].filter(Boolean).join(' · ') || TIER_LABEL[contact.tier]}
          </div>
        </div>
        <button type="button" onClick={() => onChange(null)} className="text-[13px] font-medium text-[#0066CC] hover:opacity-70 px-1.5 min-h-[36px] transition">Đổi</button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#AEAEB2]" />
        <input autoFocus={autoFocus} value={query} onChange={e => setQuery(e.target.value)} className={`${inputCls} pl-8`}
          placeholder="Tìm tên, công ty, số điện thoại… (gõ không dấu được)" aria-label="Tìm người liên hệ" />
      </div>
      <div className="mt-1.5 rounded-[12px] bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_4px_12px_-4px_rgba(0,0,0,0.08)] divide-y divide-black/[0.06] max-h-[260px] overflow-y-auto">
        {matches.length === 0 && <div className="px-3 py-3 text-[13px] text-[#86868B]">Không tìm thấy ai</div>}
        {matches.map(c => (
          <button key={c.id} type="button" onClick={() => { onChange(c); setQuery(''); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#FAFAFC] min-h-[44px] transition-colors">
            <ContactAvatar name={c.fullName} url={c.avatarUrl} tier={c.tier} size={26} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-[#1D1D1F] truncate">{c.fullName}</span>
              <span className="block text-[11px] text-[#86868B] truncate">{c.organization || 'Chưa gắn công ty'}</span>
            </span>
            <span className="text-[11.5px] text-[#86868B] shrink-0">{TIER_LABEL[c.tier]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
