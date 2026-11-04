// Pháp lý — DÒNG THỜI GIAN 1 pháp nhân: dải tổng quan theo năm (chấm màu theo loại mốc) + danh sách mốc theo năm,
// mỗi mốc là 1 thẻ: loại, lần thay đổi, nội dung TRƯỚC → SAU, file đính kèm (mở xem ngay), trạng thái.
import { useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarClock, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';
import { archive } from '../../lib/legal/api';
import { aspectLabel, MILESTONE_KIND_IDS, MILESTONE_KINDS, MILESTONE_STATUS, type LegalEntity, type LegalMilestone, type MilestoneKind } from '../../lib/legal/types';
import { fmtDate, groupByYear, sortMilestones, todayIso } from '../../lib/legal/timeline';
import { BTN_PRIMARY, CARD } from '../workspace/wsTheme';
import type { LegalCtx } from './ctx';
import MilestoneForm from './MilestoneForm';
import { Confirm, DocKindIcon, Empty, MoreMenu, Pill, soft } from './ui';

export default function EntityTimeline({ ctx, entity }: { ctx: LegalCtx; entity: LegalEntity }) {
  const { store, canEdit, userName, toast } = ctx;
  const [form, setForm] = useState<{ initial: LegalMilestone | null } | null>(null);
  const [del, setDel] = useState<LegalMilestone | null>(null);
  const [kinds, setKinds] = useState<Set<MilestoneKind>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());

  const all = useMemo(() => sortMilestones(store.milestones.filter(m => m.entity_id === entity.id)), [store.milestones, entity.id]);
  const shown = kinds.size ? all.filter(m => kinds.has(m.kind)) : all;
  const groups = groupByYear(shown);
  const today = todayIso();

  // dải tổng quan: từ năm thành lập (hoặc mốc sớm nhất) tới năm nay / mốc dự kiến xa nhất
  const strip = useMemo(() => {
    const years = all.map(m => Number(m.event_date.slice(0, 4))).filter(Boolean);
    const founded = entity.founded_date ? Number(entity.founded_date.slice(0, 4)) : null;
    const from = Math.min(...years, founded ?? Infinity, Number(today.slice(0, 4)));
    const to = Math.max(...years, Number(today.slice(0, 4)));
    const toDay = (iso: string) => new Date(iso.slice(0, 10)).getTime();
    const start = new Date(`${from}-01-01`).getTime();
    const end = new Date(`${to}-12-31`).getTime();
    const span = Math.max(1, end - start);
    return {
      from, to,
      pos: (iso: string) => Math.min(100, Math.max(0, ((toDay(iso) - start) / span) * 100)),
      years: Array.from({ length: to - from + 1 }, (_, i) => from + i),
    };
  }, [all, entity.founded_date, today]);

  const jump = (id: string) => {
    refs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(id);
    setTimeout(() => setFlash(f => (f === id ? null : f)), 1600);
  };

  const remove = async (m: LegalMilestone) => {
    await archive('legal_milestones', [m.id], userName);
    store.drop('milestone', [m.id]);
    toast('Đã chuyển mốc vào Thùng rác (file đính kèm vẫn còn ở Hồ sơ giấy tờ)');
  };

  const counts = useMemo(() => {
    const c = new Map<MilestoneKind, number>();
    all.forEach(m => c.set(m.kind, (c.get(m.kind) ?? 0) + 1));
    return c;
  }, [all]);

  return (
    <div>
      {/* ── dải tổng quan ── */}
      {all.length > 0 && (
        <div className={`${CARD} px-4 md:px-6 pt-4 pb-3 mb-4`}>
          <div className="relative h-12">
            <div className="absolute left-0 right-0 top-[22px] h-[3px] rounded-full" style={{ background: `linear-gradient(90deg, ${soft(entity.color, 0.25)}, ${entity.color})` }} />
            <div className="absolute top-[18px] w-[11px] h-[11px] rounded-full bg-white ring-2 ring-[#1D1D1F] -translate-x-1/2" style={{ left: `${strip.pos(today)}%` }} title="Hôm nay" />
            {all.map(m => {
              const k = MILESTONE_KINDS[m.kind];
              return (
                <button key={m.id} type="button" onClick={() => jump(m.id)} title={`${fmtDate(m.event_date)} · ${m.title}`}
                  className={`absolute top-[14px] w-[19px] h-[19px] -translate-x-1/2 rounded-full border-[3px] border-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] hover:scale-125 transition ${m.status !== 'done' ? 'opacity-60' : ''}`}
                  style={{ left: `${strip.pos(m.event_date)}%`, background: k.color }} />
              );
            })}
          </div>
          <div className="relative h-4 text-[10.5px] text-[#86868B] tabular-nums">
            {strip.years.filter((_y, i, arr) => arr.length <= 12 || i % Math.ceil(arr.length / 12) === 0 || i === arr.length - 1).map(y => (
              <span key={y} className="absolute -translate-x-1/2" style={{ left: `${strip.pos(`${y}-07-01`)}%` }}>{y}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── lọc + thêm ── */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1 min-w-0">
          <button type="button" onClick={() => setKinds(new Set())} className={`shrink-0 h-8 px-3 rounded-full text-[12.5px] font-medium ${!kinds.size ? 'bg-[#1D1D1F] text-white' : 'bg-black/[0.05] text-[#1D1D1F]'}`}>Tất cả {all.length}</button>
          {MILESTONE_KIND_IDS.filter(k => counts.get(k)).map(k => {
            const on = kinds.has(k);
            return (
              <button key={k} type="button" onClick={() => setKinds(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                className={`shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-medium transition ${on ? 'text-white' : 'bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]'}`}
                style={on ? { background: MILESTONE_KINDS[k].color } : undefined}>
                {!on && <span className="w-2 h-2 rounded-full" style={{ background: MILESTONE_KINDS[k].color }} />}{MILESTONE_KINDS[k].label} {counts.get(k)}
              </button>
            );
          })}
        </div>
        {canEdit && <button type="button" onClick={() => setForm({ initial: null })} className={`${BTN_PRIMARY} shrink-0 h-9 px-4 text-[13px]`}><Plus size={15} /> <span className="hidden sm:inline">Thêm mốc</span></button>}
      </div>

      {!all.length && (
        <Empty icon={<CalendarClock size={26} />} title="Chưa có mốc nào"
          text="Ghi lại ngày thành lập, từng lần đăng ký thay đổi (lần 1, 2, 3…), giấy phép, con dấu… kèm file Giấy chứng nhận trên Google Drive."
          action={canEdit && <button type="button" onClick={() => setForm({ initial: null })} className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}><Plus size={15} /> Thêm mốc đầu tiên</button>} />
      )}

      {/* ── các mốc theo năm ── */}
      <div className="relative">
        {groups.map(g => (
          <section key={g.year} className="relative mb-2">
            <div className="sticky top-0 z-10 py-2 bg-[#F5F5F7]/90 backdrop-blur-xl">
              <span className="text-[22px] md:text-[26px] font-semibold tracking-[-0.03em] tabular-nums" style={{ color: entity.color }}>{g.year}</span>
              <span className="ml-2 text-[12px] text-[#86868B]">{g.items.length} mốc</span>
            </div>
            <ol className="relative ml-[54px] md:ml-[78px] border-l-2 border-black/[0.08] pl-5 md:pl-7 space-y-3 pb-3">
              {g.items.map(m => {
                const k = MILESTONE_KINDS[m.kind];
                const st = MILESTONE_STATUS[m.status];
                const docs = store.docs.filter(d => d.milestone_id === m.id);
                return (
                  <li key={m.id} className="relative">
                    <span className="absolute -left-[54px] md:-left-[78px] -ml-5 md:-ml-7 top-3 w-[40px] md:w-[62px] text-right">
                      <span className="block text-[13px] md:text-[14px] font-semibold text-[#1D1D1F] tabular-nums leading-none">{m.event_date.slice(8, 10)}/{m.event_date.slice(5, 7)}</span>
                    </span>
                    <span className={`absolute -left-[31px] md:-left-[39px] top-3 w-[20px] h-[20px] rounded-full border-[3px] border-[#F5F5F7]`}
                      style={{ background: m.status === 'done' ? k.color : '#fff', boxShadow: m.status !== 'done' ? `inset 0 0 0 2px ${k.color}` : undefined }} />
                    <div ref={el => { if (el) refs.current.set(m.id, el); else refs.current.delete(m.id); }}
                      className={`${CARD} overflow-hidden transition ${flash === m.id ? 'ring-4' : ''}`} style={flash === m.id ? { boxShadow: `0 0 0 3px ${k.color}` } : undefined}>
                      <div className="flex">
                        <span className="w-1.5 shrink-0" style={{ background: k.color }} />
                        <div className="flex-1 min-w-0 p-3.5 md:p-4">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                <span className="h-[22px] px-2 rounded-full text-[11.5px] font-semibold inline-flex items-center" style={{ background: soft(k.color, 0.12), color: k.color }}>{k.label}</span>
                                {m.change_no != null && <span className="h-[22px] px-2 rounded-full text-[11.5px] font-semibold inline-flex items-center bg-[#1D1D1F] text-white">Lần {m.change_no}</span>}
                                {m.status !== 'done' && <Pill tint={st.tint}>{st.label}</Pill>}
                              </div>
                              <div className="text-[15px] font-semibold text-[#1D1D1F] leading-snug">{m.title}</div>
                              <div className="text-[11.5px] text-[#86868B] mt-0.5">{fmtDate(m.event_date)}{m.updated_by ? ` · ${m.updated_by}` : ''}</div>
                            </div>
                            {canEdit && <MoreMenu items={[
                              { label: 'Sửa mốc', icon: <Pencil size={14} />, onClick: () => setForm({ initial: m }) },
                              { label: 'Xoá mốc', icon: <Trash2 size={14} />, danger: true, onClick: () => setDel(m) },
                            ]} />}
                          </div>
                          {m.changes.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                              {m.changes.map(c => (
                                <div key={c.id} className="rounded-[12px] bg-black/[0.025] px-3 py-2">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#86868B] mb-1">{aspectLabel(c.aspect)}</div>
                                  <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2 text-[13px]">
                                    {c.from && <span className="text-[#86868B] line-through decoration-[#FF3B30]/50 whitespace-pre-wrap">{c.from}</span>}
                                    {c.from && c.to && <ArrowRight size={14} className="shrink-0 text-[#AEAEB2] hidden md:block" />}
                                    {c.to && <span className="font-semibold text-[#1E7B34] whitespace-pre-wrap">{c.to}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {m.description && <p className="mt-2.5 text-[13px] text-[#3A3A3C] leading-relaxed whitespace-pre-wrap">{m.description}</p>}
                          {docs.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {docs.map(d => (
                                <button key={d.id} type="button" onClick={() => ctx.openDoc(d.id)}
                                  className="inline-flex items-center gap-1.5 h-8 pl-2 pr-3 rounded-full bg-[#0071E3]/[0.08] text-[#0066CC] text-[12.5px] font-medium hover:bg-[#0071E3]/[0.14] max-w-full">
                                  <DocKindIcon kind={d.kind} fileType={d.file_type} size={13} /><span className="truncate">{d.title}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {!docs.length && canEdit && (
                            <button type="button" onClick={() => setForm({ initial: m })} className="mt-2.5 inline-flex items-center gap-1 text-[12px] text-[#86868B] hover:text-[#0066CC]"><Paperclip size={12} /> Đính kèm file</button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      {form && (
        <MilestoneForm store={store} entity={store.entities.find(e => e.id === entity.id) ?? entity} initial={form.initial} userName={userName} toast={toast}
          onClose={() => setForm(null)} onSaved={m => { store.putMilestone(m); setForm(null); setTimeout(() => jump(m.id), 80); }} />
      )}
      {del && (
        <Confirm title="Xoá mốc này?" confirmLabel="Xoá" onClose={() => setDel(null)} onConfirm={() => remove(del)}
          text={<>"{del.title}" ({fmtDate(del.event_date)}) vào <b>Thùng rác</b> — khôi phục được. Thông tin hiện tại của pháp nhân không đổi.</>} />
      )}
    </div>
  );
}
