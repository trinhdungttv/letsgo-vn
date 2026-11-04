// Pháp lý — mẫu SƠ ĐỒ TƯ DUY dựng sẵn (thủ tục hành chính, văn bản luật, so sánh, dòng thời gian, cơ cấu sở hữu)
// và sơ đồ TỰ DỰNG từ hồ sơ pháp nhân. Dữ liệu = đúng định dạng Sơ đồ tư duy của Ghi chú nhanh (MindMapDoc)
// → mở bằng nguyên trình vẽ MindMapEditor. Thuần, có test (maps.test.ts).
import { newTopic } from '../quickNotes/mindmap/model';
import { uid } from '../quickNotes/mindmap/parse';
import type { MindMapDoc, MindStructure, MindTopic } from '../quickNotes/mindmap/types';
import { changesSummary, fmtDate, fmtMoney, ownerShares, sortMilestones } from './timeline';
import { MILESTONE_KINDS, type LegalEntity, type LegalMilestone } from './types';

export type MapTemplate = 'blank' | 'procedure' | 'law' | 'compare' | 'timeline' | 'ownership';

export const MAP_TEMPLATES: { id: MapTemplate; label: string; hint: string; entityOnly?: boolean }[] = [
  { id: 'procedure', label: 'Thủ tục hành chính', hint: 'Căn cứ · Hồ sơ · Nơi nộp · Thời hạn · Lệ phí · Xử phạt' },
  { id: 'law', label: 'Văn bản pháp luật', hint: 'Phạm vi · Đối tượng · Điều kiện · Quyền & nghĩa vụ · Hiệu lực' },
  { id: 'compare', label: 'So sánh phương án', hint: 'Hai phương án, mỗi bên Ưu điểm / Nhược điểm' },
  { id: 'timeline', label: 'Dòng thời gian', hint: 'Các mốc nối tiếp từ trái sang phải' },
  { id: 'ownership', label: 'Cơ cấu sở hữu', hint: 'Thành viên góp vốn + tỉ lệ', entityOnly: true },
  { id: 'blank', label: 'Sơ đồ trống', hint: 'Chỉ có chủ đề trung tâm' },
];

const t = (text: string, children: MindTopic[] = [], extra: Partial<MindTopic> = {}): MindTopic => ({ ...newTopic(text, extra), children });

function doc(root: MindTopic, structure: MindStructure, theme = 'rainbow'): MindMapDoc {
  return { v: 1, root, floating: [], relations: [], structure, theme, rainbow: true };
}

export function templateMap(kind: MapTemplate, title: string, entity?: LegalEntity | null): MindMapDoc {
  const name = title.trim() || 'Chủ đề';
  switch (kind) {
    case 'procedure':
      return doc(t(name, [
        t('Căn cứ pháp lý', [t('Luật / Nghị định / Thông tư')], { markers: ['sym-info'] }),
        t('Hồ sơ cần có', [t('Giấy tờ 1'), t('Giấy tờ 2')], { markers: ['task-0'] }),
        t('Nơi nộp', [t('Cơ quan tiếp nhận'), t('Nộp online / trực tiếp')]),
        t('Thời hạn giải quyết', [t('… ngày làm việc')], { markers: ['sym-exclaim'] }),
        t('Lệ phí', [t('… đồng')]),
        t('Xử phạt nếu vi phạm', [t('Mức phạt'), t('Điều khoản')], { markers: ['flag-red'] }),
        t('Lưu ý', [t('Mẹo / kinh nghiệm thực tế')], { markers: ['sym-idea'] }),
      ]), 'map');
    case 'law':
      return doc(t(name, [
        t('Phạm vi điều chỉnh'),
        t('Đối tượng áp dụng'),
        t('Điều kiện', [t('Điều kiện 1'), t('Điều kiện 2')]),
        t('Quyền & nghĩa vụ', [t('Quyền'), t('Nghĩa vụ')]),
        t('Thủ tục'),
        t('Xử phạt', [], { markers: ['flag-red'] }),
        t('Hiệu lực', [t('Ngày có hiệu lực'), t('Văn bản thay thế')], { markers: ['sym-info'] }),
      ]), 'right');
    case 'compare':
      return doc(t(name, [
        t('Phương án A', [t('Ưu điểm', [t('…')], { markers: ['sym-check'] }), t('Nhược điểm', [t('…')], { markers: ['sym-cross'] })]),
        t('Phương án B', [t('Ưu điểm', [t('…')], { markers: ['sym-check'] }), t('Nhược điểm', [t('…')], { markers: ['sym-cross'] })]),
      ]), 'org');
    case 'timeline':
      return doc(t(name, [t('Mốc 1'), t('Mốc 2'), t('Mốc 3')]), 'timeline');
    case 'ownership':
      return ownershipMap(entity ?? null, name);
    default:
      return doc(t(name), 'map');
  }
}

/** Cơ cấu sở hữu: công ty ở trên, các thành viên góp vốn xổ xuống (kèm %, số vốn). */
export function ownershipMap(entity: LegalEntity | null, title: string): MindMapDoc {
  if (!entity) return doc(t(title, [t('Thành viên 1'), t('Thành viên 2')]), 'org');
  const shares = ownerShares(entity.info.owners, entity.charter_capital);
  const owners = entity.info.owners.map((o, i) => {
    const pct = shares[i]?.pct;
    const parts = [o.name || 'Thành viên', pct ? `${pct}%` : ''].filter(Boolean).join(' · ');
    return t(parts, [
      ...(o.capital != null ? [t(fmtMoney(o.capital))] : []),
      ...(o.note.trim() ? [t(o.note.trim())] : []),
    ]);
  });
  const root = t(entity.short_name || entity.name, owners.length ? owners : [t('Chưa nhập thành viên góp vốn')]);
  if (entity.charter_capital != null) root.note = `Vốn điều lệ: ${fmtMoney(entity.charter_capital)}`;
  return doc(root, 'org', 'business');
}

/**
 * Sơ đồ tổng quan 1 pháp nhân, dựng từ hồ sơ + dòng thời gian: Thông tin chung · Vốn & thành viên · Người đại diện ·
 * Ngành nghề · Giấy phép · Lịch sử thay đổi (mỗi mốc 1 nhánh, màu theo loại mốc).
 */
export function entityOverviewMap(entity: LegalEntity, milestones: LegalMilestone[]): MindMapDoc {
  const leaf = (label: string, value: string | null | undefined) => (value && value.trim() ? [t(`${label}: ${value.trim()}`)] : []);
  const general = t('Thông tin chung', [
    ...leaf('MST', entity.tax_code),
    ...leaf('Loại hình', entity.business_type),
    ...leaf('Thành lập', fmtDate(entity.founded_date)),
    ...leaf('Nơi cấp', entity.registry_office),
    ...leaf('Trụ sở', entity.address),
  ], { markers: ['sym-info'] });
  const shares = ownerShares(entity.info.owners, entity.charter_capital);
  const capital = t('Vốn & thành viên', [
    ...leaf('Vốn điều lệ', fmtMoney(entity.charter_capital)),
    ...entity.info.owners.map((o, i) => t([o.name, shares[i]?.pct ? `${shares[i].pct}%` : ''].filter(Boolean).join(' · '))),
  ]);
  const rep = t('Người đại diện', entity.legal_rep ? [t([entity.legal_rep, entity.legal_rep_title].filter(Boolean).join(' – '))] : []);
  const inds = t('Ngành nghề', entity.info.industries.slice(0, 12).map(i => t([i.code, i.name].filter(Boolean).join(' '), [], i.main ? { markers: ['star-yellow'] } : {})));
  const lic = t('Giấy phép', entity.info.licenses.map(l => t(l.name || 'Giấy phép', [
    ...leaf('Số', l.number), ...leaf('Hết hạn', fmtDate(l.expires)),
  ])));
  const history = t('Lịch sử thay đổi', sortMilestones(milestones.filter(m => !m.deleted_at), 'asc').map(m => {
    const kind = MILESTONE_KINDS[m.kind] ?? MILESTONE_KINDS.khac;
    const sub = m.changes.length ? [t(changesSummary(m.changes))] : [];
    return t(`${fmtDate(m.event_date)} · ${m.title || kind.label}`, sub, { style: { branch: kind.color } });
  }), { markers: ['flag-blue'] });
  const branches = [general, capital, rep, inds, lic, history].filter(b => b.children.length);
  return { v: 1, root: { id: uid(), text: entity.short_name || entity.name, children: branches.length ? branches : [general] }, floating: [], relations: [], structure: 'map', theme: 'rainbow', rainbow: true };
}
