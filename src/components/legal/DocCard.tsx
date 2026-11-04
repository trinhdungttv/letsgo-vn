// Pháp lý — thẻ tài liệu (lưới Thư viện, kết quả tìm kiếm) và dòng tài liệu (hồ sơ pháp nhân, mốc thời gian).
import { useState } from 'react';
import { ChevronRight, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { archive, saveDoc } from '../../lib/legal/api';
import { LAW_STATUS, type LegalDoc } from '../../lib/legal/types';
import { CARD } from '../workspace/wsTheme';
import type { LegalCtx } from './ctx';
import { ColorTile, Confirm, DocKindIcon, docColor, docTypeLabel, fmtWhen, MoreMenu, Pill, soft } from './ui';

function useDocActions(ctx: LegalCtx, doc: LegalDoc) {
  const [confirm, setConfirm] = useState(false);
  const pin = async () => {
    try { ctx.store.putDoc(await saveDoc({ id: doc.id, pinned: !doc.pinned }, ctx.userName)); }
    catch (e) { ctx.toast((e as Error).message); }
  };
  const remove = async () => {
    await archive('legal_docs', [doc.id], ctx.userName);
    ctx.store.drop('doc', [doc.id]);
    ctx.toast('Đã chuyển vào Thùng rác');
  };
  const menu = ctx.canEdit ? [
    { label: 'Sửa thông tin', icon: <Pencil size={14} />, onClick: () => ctx.editDoc(doc) },
    { label: doc.pinned ? 'Bỏ ghim' : 'Ghim lên đầu', icon: doc.pinned ? <PinOff size={14} /> : <Pin size={14} />, onClick: () => void pin() },
    { label: 'Xoá (vào Thùng rác)', icon: <Trash2 size={14} />, danger: true, onClick: () => setConfirm(true) },
  ] : [];
  const dialog = confirm && (
    <Confirm title="Xoá tài liệu?" confirmLabel="Xoá" onClose={() => setConfirm(false)} onConfirm={remove}
      text={<>"{doc.title}" sẽ vào <b>Thùng rác</b> — khôi phục được. File gốc trên Google Drive không bị đụng tới.</>} />
  );
  return { menu, dialog };
}

export function DocCard({ ctx, doc, where }: { ctx: LegalCtx; doc: LegalDoc; where?: string }) {
  const { menu, dialog } = useDocActions(ctx, doc);
  const color = docColor(doc);
  const status = doc.meta.status ? LAW_STATUS[doc.meta.status] : null;
  return (
    <>
      <div role="button" tabIndex={0} onClick={() => ctx.openDoc(doc.id)} onKeyDown={e => { if (e.key === 'Enter') ctx.openDoc(doc.id); }}
        className={`${CARD} group relative overflow-hidden text-left cursor-pointer transition hover:-translate-y-0.5 hover:shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_18px_40px_-18px_rgba(0,0,0,0.25)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#0071E3]/25`}>
        <div className="h-[5px]" style={{ background: color }} />
        <div className="p-3.5 pt-3">
          <div className="flex items-start gap-2.5">
            <ColorTile color={color} size={36} radius={10}><DocKindIcon kind={doc.kind} fileType={doc.file_type} size={17} /></ColorTile>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color }}>
                {docTypeLabel(doc)}
                {doc.pinned && <Pin size={11} className="text-[#FF9500] fill-[#FF9500] ml-0.5" />}
              </div>
              <div className="text-[14px] font-semibold text-[#1D1D1F] leading-snug line-clamp-2 mt-0.5">{doc.title || 'Tài liệu'}</div>
            </div>
            <div className="-mr-1.5 -mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"><MoreMenu items={menu} /></div>
          </div>
          {(doc.meta.number || doc.meta.issuer) && (
            <div className="text-[12px] text-[#6E6E73] mt-2 truncate">{[doc.meta.number, doc.meta.issuer].filter(Boolean).join(' · ')}</div>
          )}
          {(status || doc.meta.tags?.length) ? (
            <div className="flex flex-wrap gap-1 mt-2">
              {status && <Pill tint={status.tint}>{status.label}</Pill>}
              {doc.meta.tags?.slice(0, 3).map(t => <span key={t} className="h-[22px] px-2 rounded-full text-[11px] font-medium inline-flex items-center" style={{ background: soft(color, 0.1), color }}>#{t}</span>)}
            </div>
          ) : null}
          {doc.summary && <div className="text-[12.5px] text-[#86868B] leading-relaxed mt-2 line-clamp-2">{doc.summary}</div>}
          <div className="text-[11px] text-[#AEAEB2] mt-2.5 truncate">{where ? `${where} · ` : ''}sửa {fmtWhen(doc.updated_at)}{doc.updated_by ? ` · ${doc.updated_by}` : ''}</div>
        </div>
      </div>
      {dialog}
    </>
  );
}

export function DocRow({ ctx, doc, first, extra }: { ctx: LegalCtx; doc: LegalDoc; first?: boolean; extra?: string }) {
  const { menu, dialog } = useDocActions(ctx, doc);
  const color = docColor(doc);
  return (
    <>
      <div role="button" tabIndex={0} onClick={() => ctx.openDoc(doc.id)} onKeyDown={e => { if (e.key === 'Enter') ctx.openDoc(doc.id); }}
        className="group flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-black/[0.025] focus:outline-none focus-visible:bg-[#0071E3]/[0.06] rounded-[12px]">
        <ColorTile color={color} size={32} radius={9}><DocKindIcon kind={doc.kind} fileType={doc.file_type} size={15} /></ColorTile>
        <div className={`min-w-0 flex-1 ${first ? '' : ''}`}>
          <div className="flex items-center gap-1 text-[13.5px] font-medium text-[#1D1D1F] truncate">
            {doc.pinned && <Pin size={11} className="shrink-0 text-[#FF9500] fill-[#FF9500]" />}
            <span className="truncate">{doc.title || 'Tài liệu'}</span>
          </div>
          <div className="text-[11.5px] text-[#86868B] truncate">{[docTypeLabel(doc), extra, doc.meta.number, `sửa ${fmtWhen(doc.updated_at)}`].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"><MoreMenu items={menu} /></div>
        <ChevronRight size={16} className="shrink-0 text-[#C7C7CC]" />
      </div>
      {dialog}
    </>
  );
}
