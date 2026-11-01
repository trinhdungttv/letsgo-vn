// Khung bên phải của sơ đồ tư duy (như khung "Format" của XMind): Định dạng chủ đề · Bản đồ · Biểu tượng · Ghi chú.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Bold, Italic, Minus, Plus, Strikethrough, Trash2, X } from 'lucide-react';
import type { NotePalette } from '../../../lib/quickNotes/colors';
import {
  collapseToLevel, removeRelations, setBoundaryText, setStyle, toggleBoundary, toggleMarker, updateRelation, updateTopics,
} from '../../../lib/quickNotes/mindmap/model';
import { getTheme, MARKER_GROUPS, THEME_IDS, type MindTheme } from '../../../lib/quickNotes/mindmap/themes';
import {
  STRUCTURES, TOPIC_SHAPES, type MindLineStyle, type MindMapDoc, type MindStructure, type MindTopic, type TopicShape,
} from '../../../lib/quickNotes/mindmap/types';
import { MarkerIcon } from './MarkerIcon';

export type PanelTab = 'style' | 'map' | 'marker' | 'note';

const SWATCHES = [
  '#1D1D1F', '#5B6B83', '#8E8E93', '#FFFFFF', '#E5484D', '#F76B15', '#F5B400', '#30A46C', '#12A594', '#0090FF', '#3E63DD', '#8E4EC6',
  '#D6409F', '#A0522D', '#FFE5E5', '#FFF1DB', '#FFF8C5', '#E1F7EA', '#DDF0FF', '#EFE5FF',
];

const STRUCTURE_LABEL: Record<MindStructure, string> = {
  map: 'Toả 2 bên', right: 'Logic phải', left: 'Logic trái', org: 'Tổ chức', tree: 'Cây', timeline: 'Dòng thời gian',
};
const SHAPE_LABEL: Record<TopicShape, string> = {
  rounded: 'Bo góc', rect: 'Vuông', pill: 'Viên thuốc', ellipse: 'Elip', underline: 'Gạch chân', none: 'Không viền',
};

function StructureGlyph({ s }: { s: MindStructure }) {
  const c = 'currentColor';
  const box = (x: number, y: number, w = 8, h = 4, k = 0) => <rect key={k} x={x} y={y} width={w} height={h} rx={1.2} fill={c} />;
  switch (s) {
    case 'map':
      return <g>{box(16, 13)}<path d="M24 15h4M28 15v-6h3M28 15v6h3M16 15h-4M12 15v-6H9M12 15v6H9" stroke={c} fill="none" strokeWidth={1.2} />{box(31, 7, 6, 4, 1)}{box(31, 19, 6, 4, 2)}{box(3, 7, 6, 4, 3)}{box(3, 19, 6, 4, 4)}</g>;
    case 'right':
      return <g>{box(4, 13)}<path d="M12 15h5M17 15V7h4M17 15v8h4M17 15h4" stroke={c} fill="none" strokeWidth={1.2} />{box(21, 5, 9, 4, 1)}{box(21, 13, 9, 4, 2)}{box(21, 21, 9, 4, 3)}</g>;
    case 'left':
      return <g>{box(28, 13)}<path d="M28 15h-5M23 15V7h-4M23 15v8h-4M23 15h-4" stroke={c} fill="none" strokeWidth={1.2} />{box(10, 5, 9, 4, 1)}{box(10, 13, 9, 4, 2)}{box(10, 21, 9, 4, 3)}</g>;
    case 'org':
      return <g>{box(16, 4)}<path d="M20 8v5M8 13h24M8 13v4M20 13v4M32 13v4" stroke={c} fill="none" strokeWidth={1.2} />{box(4, 17, 8, 4, 1)}{box(16, 17, 8, 4, 2)}{box(28, 17, 8, 4, 3)}</g>;
    case 'tree':
      return <g>{box(16, 3)}<path d="M20 7v3M10 10h20M10 10v3M30 10v3M12 17v8h3M12 21h3M32 17v4h3" stroke={c} fill="none" strokeWidth={1.2} />{box(6, 13, 8, 4, 1)}{box(26, 13, 8, 4, 2)}{box(15, 19, 6, 3, 3)}{box(15, 23, 6, 3, 4)}{box(35, 19, 3, 3, 5)}</g>;
    default:
      return <g>{box(2, 13, 6, 4)}<path d="M8 15h30" stroke={c} strokeWidth={1.6} /><path d="M14 15v-6M24 15v6M33 15v-6" stroke={c} strokeWidth={1} />{box(11, 5, 7, 4, 1)}{box(21, 21, 7, 4, 2)}{box(30, 5, 7, 4, 3)}</g>;
  }
}

function ShapeGlyph({ s }: { s: TopicShape }) {
  const c = 'currentColor';
  if (s === 'ellipse') return <ellipse cx={14} cy={9} rx={11} ry={6.5} fill="none" stroke={c} strokeWidth={1.5} />;
  if (s === 'underline') return <path d="M3 14h22" stroke={c} strokeWidth={1.8} strokeLinecap="round" />;
  if (s === 'none') return <path d="M7 9h14" stroke={c} strokeWidth={1.4} strokeDasharray="2 2.5" />;
  const rx = s === 'pill' ? 6.5 : s === 'rect' ? 0.5 : 3;
  return <rect x={3} y={2.5} width={22} height={13} rx={rx} fill="none" stroke={c} strokeWidth={1.5} />;
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="px-3 py-2.5 border-b border-black/[0.06]">
      <div className="flex items-center mb-2">
        <div className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-[#86868B]">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Swatches({ value, onPick, allowNone }: { value?: string; onPick: (c: string | undefined) => void; allowNone?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" title="Theo chủ đề màu" onClick={() => onPick(undefined)}
        className={`h-6 px-1.5 rounded-md text-[11px] font-medium border ${!value ? 'border-[#2C7BF6] text-[#2C7BF6] bg-[#2C7BF6]/5' : 'border-black/10 text-[#6E6E73] hover:bg-black/[0.04]'}`}>Mặc định</button>
      {allowNone && (
        <button type="button" title="Không màu" onClick={() => onPick('transparent')}
          className={`w-6 h-6 rounded-md border relative overflow-hidden ${value === 'transparent' ? 'ring-2 ring-[#2C7BF6] ring-offset-1' : 'border-black/15'}`}>
          <span className="absolute left-1/2 top-[-2px] h-[30px] w-[1.5px] bg-[#E5484D] rotate-45" />
        </button>
      )}
      {SWATCHES.map(c => (
        <button key={c} type="button" title={c} onClick={() => onPick(c)}
          className={`w-6 h-6 rounded-md border border-black/10 transition hover:scale-110 ${value?.toUpperCase() === c ? 'ring-2 ring-[#2C7BF6] ring-offset-1' : ''}`}
          style={{ background: c }} />
      ))}
      <label title="Chọn màu khác" className="w-6 h-6 rounded-md border border-black/15 cursor-pointer overflow-hidden relative"
        style={{ background: 'conic-gradient(#E5484D, #F5B400, #30A46C, #0090FF, #8E4EC6, #E5484D)' }}>
        <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={value && value.startsWith('#') && value.length === 7 ? value : '#2C7BF6'}
          onChange={e => onPick(e.target.value.toUpperCase())} />
      </label>
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex p-0.5 rounded-lg bg-black/[0.05]">
      {options.map(o => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)}
          className={`flex-1 h-7 rounded-md text-[12px] font-medium transition ${value === o.key ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] text-[#1D1D1F]' : 'text-[#6E6E73] hover:text-[#1D1D1F]'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="w-full flex items-center justify-between text-[13px] text-[#1D1D1F] py-0.5">
      <span>{label}</span>
      <span className={`w-9 h-5 rounded-full p-0.5 transition ${on ? 'bg-[#30A46C]' : 'bg-black/15'}`}>
        <span className={`block w-4 h-4 rounded-full bg-white shadow transition ${on ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

export interface FormatPanelProps {
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  onClose: () => void;
  doc: MindMapDoc;
  getDoc: () => MindMapDoc;
  theme: MindTheme;
  palette: NotePalette;
  selIds: string[];
  selTopics: MindTopic[];
  selRelationId: string | null;
  selBoundaryId: string | null;
  commit: (next: MindMapDoc, merge?: string) => void;
  onDeselectRelation: () => void;
}

export default function FormatPanel(p: FormatPanelProps) {
  const { doc, selTopics, tab } = p;
  const primary = selTopics[0] ?? null;
  const st = primary?.style ?? {};
  const ids = selTopics.map(t => t.id);
  const relation = p.selRelationId ? doc.relations.find(r => r.id === p.selRelationId) ?? null : null;
  const boundaryTopic = p.selBoundaryId ? selTopics.find(t => t.id === p.selBoundaryId) ?? null : null;
  const [noteDraft, setNoteDraft] = useState(primary?.note ?? '');
  const [labelDraft, setLabelDraft] = useState('');
  const [linkDraft, setLinkDraft] = useState(primary?.link ?? '');

  useEffect(() => {
    setNoteDraft(primary?.note ?? '');
    setLinkDraft(primary?.link ?? '');
    setLabelDraft('');
    // chỉ khi đổi chủ đề đang chọn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary?.id]);

  const style = (patch: Parameters<typeof setStyle>[2]) => p.commit(setStyle(p.getDoc(), ids, patch));
  const mapSet = (patch: Partial<MindMapDoc>) => p.commit({ ...p.getDoc(), ...patch });

  const tabs: { key: PanelTab; label: string }[] = [
    { key: 'style', label: 'Định dạng' }, { key: 'map', label: 'Bản đồ' }, { key: 'marker', label: 'Biểu tượng' }, { key: 'note', label: 'Ghi chú' },
  ];

  const noTopic = <div className="px-4 py-8 text-center text-[12.5px] text-[#86868B]">Chọn 1 chủ đề trên sơ đồ để {tab === 'note' ? 'viết ghi chú' : tab === 'marker' ? 'gắn biểu tượng' : 'định dạng'}.</div>;

  const addLabel = () => {
    const v = labelDraft.trim();
    if (!v || !ids.length) return;
    p.commit(updateTopics(p.getDoc(), ids, t => { t.labels = [...new Set([...(t.labels ?? []), v])].slice(0, 10); }));
    setLabelDraft('');
  };

  return (
    <aside className="w-[288px] shrink-0 h-full flex flex-col bg-white/95 backdrop-blur border-l border-black/[0.08] text-[#1D1D1F]"
      onKeyDown={e => e.stopPropagation()}
      onMouseDown={e => {
        // Bấm nút trong khung vẫn giữ phím tắt trên sơ đồ (trừ ô nhập chữ / chọn màu)
        const t = e.target as HTMLElement;
        if (!t.closest('input, textarea, label, select')) e.preventDefault();
      }}>
      <div className="flex items-center gap-1 px-2 h-11 shrink-0 border-b border-black/[0.06]">
        <div className="flex-1 flex p-0.5 rounded-lg bg-black/[0.05] min-w-0">
          {tabs.map(t => (
            <button key={t.key} type="button" onClick={() => p.onTab(t.key)}
              className={`flex-1 h-7 px-0.5 rounded-md text-[11px] font-medium whitespace-nowrap transition ${tab === t.key ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-[#6E6E73] hover:text-[#1D1D1F]'}`}>{t.label}</button>
          ))}
        </div>
        <button type="button" onClick={p.onClose} title="Đóng khung" className="w-7 h-7 rounded-md flex items-center justify-center text-[#86868B] hover:bg-black/[0.05]"><X size={15} /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'style' && (relation ? (
          <Section title="Đường liên kết">
            <input value={relation.text} placeholder="Chữ trên đường liên kết" autoFocus
              onChange={e => p.commit(updateRelation(p.getDoc(), relation.id, { text: e.target.value }), `rel:${relation.id}`)}
              className="w-full h-8 px-2.5 rounded-lg bg-black/[0.04] text-[13px] outline-none focus:ring-2 focus:ring-[#2C7BF6]/40" />
            <button type="button" onClick={() => { p.commit(removeRelations(p.getDoc(), [relation.id])); p.onDeselectRelation(); }}
              className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium text-[#D70015] hover:bg-[#FF3B30]/10">
              <Trash2 size={13} /> Xoá đường liên kết
            </button>
          </Section>
        ) : !primary ? noTopic : (
          <>
            {boundaryTopic?.boundary && (
              <Section title="Vùng bao">
                <input value={boundaryTopic.boundary.text} placeholder="Tên vùng (không bắt buộc)"
                  onChange={e => p.commit(setBoundaryText(p.getDoc(), boundaryTopic.id, e.target.value), `bd:${boundaryTopic.id}`)}
                  className="w-full h-8 px-2.5 rounded-lg bg-black/[0.04] text-[13px] outline-none focus:ring-2 focus:ring-[#2C7BF6]/40" />
                <button type="button" onClick={() => p.commit(toggleBoundary(p.getDoc(), [boundaryTopic.id]))}
                  className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium text-[#D70015] hover:bg-[#FF3B30]/10">
                  <Trash2 size={13} /> Bỏ vùng bao
                </button>
              </Section>
            )}
            <Section title="Hình dạng">
              <div className="grid grid-cols-3 gap-1.5">
                {TOPIC_SHAPES.map(s => (
                  <button key={s} type="button" title={SHAPE_LABEL[s]} onClick={() => style({ shape: st.shape === s ? undefined : s })}
                    className={`h-10 rounded-lg flex flex-col items-center justify-center gap-0.5 border text-[10px] ${st.shape === s ? 'border-[#2C7BF6] text-[#2C7BF6] bg-[#2C7BF6]/5' : 'border-black/[0.08] text-[#3A3A3C] hover:bg-black/[0.03]'}`}>
                    <svg width={28} height={18} viewBox="0 0 28 18"><ShapeGlyph s={s} /></svg>
                    {SHAPE_LABEL[s]}
                  </button>
                ))}
              </div>
            </Section>
            <Section title="Chữ">
              <div className="flex items-center gap-1.5">
                <div className="flex items-center rounded-lg bg-black/[0.05]">
                  <button type="button" title="Chữ nhỏ hơn" onClick={() => style({ size: Math.max(10, (st.size ?? 15) - 1) })} className="w-7 h-7 flex items-center justify-center hover:bg-black/[0.05] rounded-l-lg"><Minus size={13} /></button>
                  <span className="w-8 text-center text-[12.5px] tabular-nums">{st.size ?? '—'}</span>
                  <button type="button" title="Chữ to hơn" onClick={() => style({ size: Math.min(48, (st.size ?? 15) + 1) })} className="w-7 h-7 flex items-center justify-center hover:bg-black/[0.05] rounded-r-lg"><Plus size={13} /></button>
                </div>
                {([['bold', Bold, 'Đậm (⌘B)'], ['italic', Italic, 'Nghiêng (⌘I)'], ['strike', Strikethrough, 'Gạch ngang']] as const).map(([k, Icon, label]) => (
                  <button key={k} type="button" title={label} onClick={() => style({ [k]: st[k] ? undefined : true })}
                    className={`w-8 h-7 rounded-lg flex items-center justify-center ${st[k] ? 'bg-[#2C7BF6]/12 text-[#2C7BF6]' : 'hover:bg-black/[0.05]'}`}>
                    <Icon size={14} />
                  </button>
                ))}
                {st.size && <button type="button" onClick={() => style({ size: undefined })} className="ml-auto text-[11.5px] text-[#2C7BF6]">Mặc định</button>}
              </div>
            </Section>
            <Section title="Màu chữ"><Swatches value={st.color} onPick={c => style({ color: c })} /></Section>
            <Section title="Màu nền"><Swatches value={st.fill} onPick={c => style({ fill: c })} allowNone /></Section>
            <Section title="Màu nhánh & viền"><Swatches value={st.branch} onPick={c => style({ branch: c })} /></Section>
            <Section title="Nhãn">
              <div className="flex flex-wrap gap-1 mb-1.5">
                {(primary.labels ?? []).map(l => (
                  <span key={l} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full bg-black/[0.06] text-[12px]">
                    {l}
                    <button type="button" aria-label={`Bỏ nhãn ${l}`} onClick={() => p.commit(updateTopics(p.getDoc(), ids, t => {
                      t.labels = (t.labels ?? []).filter(x => x !== l);
                      if (!t.labels.length) delete t.labels;
                    }))} className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-black/10"><X size={10} /></button>
                  </span>
                ))}
              </div>
              <input value={labelDraft} onChange={e => setLabelDraft(e.target.value)} placeholder="Thêm nhãn rồi Enter"
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addLabel(); } }}
                className="w-full h-8 px-2.5 rounded-lg bg-black/[0.04] text-[13px] outline-none focus:ring-2 focus:ring-[#2C7BF6]/40" />
            </Section>
            <Section title="Liên kết web">
              <input value={linkDraft} onChange={e => setLinkDraft(e.target.value)} placeholder="https://…"
                onBlur={() => p.commit(updateTopics(p.getDoc(), ids, t => { const v = linkDraft.trim(); if (v) t.link = /^[a-z]+:\/\//i.test(v) ? v : `https://${v}`; else delete t.link; }))}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-full h-8 px-2.5 rounded-lg bg-black/[0.04] text-[13px] outline-none focus:ring-2 focus:ring-[#2C7BF6]/40" />
            </Section>
            <div className="px-3 py-3">
              <button type="button" onClick={() => p.commit(updateTopics(p.getDoc(), ids, t => { delete t.style; }))}
                className="w-full h-8 rounded-lg text-[12.5px] font-medium text-[#3A3A3C] bg-black/[0.05] hover:bg-black/[0.08]">Xoá định dạng riêng</button>
            </div>
          </>
        ))}

        {tab === 'map' && (
          <>
            <Section title="Cấu trúc">
              <div className="grid grid-cols-3 gap-1.5">
                {STRUCTURES.map(s => (
                  <button key={s} type="button" onClick={() => mapSet({ structure: s })}
                    className={`h-[58px] rounded-lg flex flex-col items-center justify-center gap-1 border text-[10.5px] ${doc.structure === s ? 'border-[#2C7BF6] text-[#2C7BF6] bg-[#2C7BF6]/5' : 'border-black/[0.08] text-[#3A3A3C] hover:bg-black/[0.03]'}`}>
                    <svg width={40} height={28} viewBox="0 0 40 28"><StructureGlyph s={s} /></svg>
                    {STRUCTURE_LABEL[s]}
                  </button>
                ))}
              </div>
            </Section>
            <Section title="Chủ đề màu">
              <div className="grid grid-cols-2 gap-1.5">
                {THEME_IDS.map(id => {
                  const t = getTheme(id, p.palette);
                  const rootFill = t.root.fill === 'none' ? t.bg : t.root.fill;
                  return (
                    <button key={id} type="button" onClick={() => mapSet({ theme: id })}
                      className={`rounded-lg overflow-hidden border text-left ${doc.theme === id ? 'border-[#2C7BF6] ring-2 ring-[#2C7BF6]/30' : 'border-black/[0.08] hover:border-black/20'}`}>
                      <div className="h-11 flex items-center justify-center gap-1.5 relative" style={{ background: t.bg }}>
                        <span className="h-4 w-9 rounded" style={{ background: rootFill, border: t.root.border !== 'none' ? `1.5px solid ${t.root.border}` : undefined }} />
                        <span className="flex flex-col gap-1">
                          {(t.rainbow ? t.branch.slice(0, 3) : [t.mono, t.mono, t.mono]).map((c, i) => <span key={i} className="block h-1.5 w-6 rounded-full" style={{ background: c }} />)}
                        </span>
                      </div>
                      <div className="px-2 py-1 text-[11.5px] font-medium bg-white">{t.label}</div>
                    </button>
                  );
                })}
              </div>
            </Section>
            <Section title="Đường nhánh">
              <Seg<MindLineStyle | 'auto'> value={doc.line ?? 'auto'} onChange={v => mapSet({ line: v === 'auto' ? undefined : v })}
                options={[{ key: 'auto', label: 'Mặc định' }, { key: 'curve', label: 'Cong' }, { key: 'elbow', label: 'Gấp' }, { key: 'straight', label: 'Thẳng' }]} />
              <div className="mt-2.5 space-y-2">
                <Toggle label="Nhánh nhiều màu (cầu vồng)" on={doc.rainbow ?? p.theme.rainbow} onChange={v => mapSet({ rainbow: v })} />
                <Toggle label="Sơ đồ gọn" on={!!doc.compact} onChange={v => mapSet({ compact: v || undefined })} />
              </div>
            </Section>
            <Section title="Phông chữ">
              <Seg value={doc.font ?? 'sans'} onChange={v => mapSet({ font: v === 'sans' ? undefined : v })}
                options={[{ key: 'sans', label: 'Thường' }, { key: 'serif', label: 'Có chân' }, { key: 'mono', label: 'Đều' }]} />
            </Section>
            <Section title="Mở / thu gọn nhánh">
              <div className="grid grid-cols-4 gap-1.5">
                {[[Infinity, 'Mở hết'], [1, 'Cấp 1'], [2, 'Cấp 2'], [3, 'Cấp 3']].map(([lv, label]) => (
                  <button key={String(label)} type="button" onClick={() => p.commit(collapseToLevel(p.getDoc(), lv as number))}
                    className="h-8 rounded-lg text-[12px] font-medium bg-black/[0.05] hover:bg-black/[0.09]">{label}</button>
                ))}
              </div>
            </Section>
          </>
        )}

        {tab === 'marker' && (!primary ? noTopic : MARKER_GROUPS.map(g => (
          <Section key={g.id} title={g.label}>
            <div className="flex flex-wrap gap-1">
              {g.items.map(it => {
                const on = selTopics.every(t => t.markers?.includes(it.id));
                return (
                  <button key={it.id} type="button" title={it.label} onClick={() => p.commit(toggleMarker(p.getDoc(), ids, it.id))}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${on ? 'bg-[#2C7BF6]/12 ring-2 ring-[#2C7BF6]' : 'hover:bg-black/[0.05]'}`}>
                    <MarkerIcon id={it.id} size={20} />
                  </button>
                );
              })}
            </div>
          </Section>
        )))}

        {tab === 'note' && (!primary ? noTopic : (
          <div className="p-3 flex flex-col h-full min-h-[300px]">
            <div className="text-[12px] text-[#86868B] mb-1.5 truncate">Ghi chú cho “{primary.text.replace(/\n/g, ' ') || 'chủ đề'}”</div>
            <textarea value={noteDraft} autoFocus placeholder="Viết thêm chi tiết, số điện thoại, việc cần làm…"
              onChange={e => { setNoteDraft(e.target.value); p.commit(updateTopics(p.getDoc(), [primary.id], t => { if (e.target.value.trim()) t.note = e.target.value; else delete t.note; }), `note:${primary.id}`); }}
              className="flex-1 min-h-[240px] w-full resize-none rounded-lg bg-[#FFFBEA] border border-[#F0E3A8] p-2.5 text-[13.5px] leading-[1.5] outline-none focus:ring-2 focus:ring-[#2C7BF6]/30" />
          </div>
        ))}
      </div>
    </aside>
  );
}
