import type {
  Industry, IndustryTerm, IndustryPosition, IndustryMetric, IndustryValueChainItem,
  Client, MarketLead, Competitor,
} from '../lib/types';
import { htmlToMarkdown } from '../lib/htmlText';

const MISSING = '⚠ chưa nhập';
const tr = (v: number | null | undefined) => v != null ? (v / 1_000_000).toFixed(1) + 'tr' : null;
const k = (v: number | null | undefined) => v != null ? (v / 1000).toFixed(0) + 'k' : '—';
const SEASON = ['–', 'Rất thấp', 'Thấp', 'Bình thường', 'Cao', 'Cao điểm'];
const DIFF = ['—', 'Dễ tuyển', 'Bình thường', 'Hơi khó', 'Khó', 'Rất khó'];

interface Args {
  industry: Industry;
  terms: IndustryTerm[];
  positions: IndustryPosition[];
  metrics: IndustryMetric[];
  valueChain: IndustryValueChainItem[];
  clients: Client[];
  marketLeads: MarketLead[];
  competitors: Competitor[];
}

// Tài liệu "Chuẩn bị gặp khách" — gom mọi thứ đã biết về ngành thành 1 trang đọc trước khi vào họp.
export function buildIndustryBriefMd({ industry, terms, positions, metrics, valueChain, clients, marketLeads, competitors }: Args): string {
  const name = industry.name;
  const indClients = clients.filter(c => c.industry === name);
  const indLeads = marketLeads.filter(l => l.industry === name);
  const names = new Set([...indClients.map(c => c.name), ...indLeads.map(l => l.company_name)]
    .map(n => n.trim().toLowerCase()));
  const indComps = competitors.filter(cp => (cp.supplying_for ?? []).some(n => names.has(n.trim().toLowerCase())));

  const workers = indClients.reduce((s, c) => s + (c.current_workers ?? 0), 0);
  const wages = [...indClients, ...indLeads].flatMap(x => [x.wage_min, x.wage_max]).filter((v): v is number => v != null);
  const wageRange = wages.length ? `${tr(Math.min(...wages))}–${tr(Math.max(...wages))}` : MISSING;

  const levels = industry.season_levels ?? [];
  const notes = industry.season_notes ?? [];
  const thisMonth = new Date().getMonth();

  const L: string[] = [];
  const h = (t: string) => { L.push(''); L.push('## ' + t); L.push(''); };

  L.push(`# Chuẩn bị gặp khách — ngành ${name}`);
  L.push(`_Xuất ngày ${new Date().toLocaleDateString('vi-VN')} · Let's Go VN_`);

  h('1. Số liệu nắm trong đầu');
  L.push('| Chỉ số | Giá trị |');
  L.push('|---|---|');
  L.push(`| KH đang hợp tác | ${indClients.length || MISSING} |`);
  L.push(`| Dự án đang tìm hiểu | ${indLeads.length || MISSING} |`);
  L.push(`| Tổng lao động đang cung ứng | ${workers ? workers.toLocaleString('vi-VN') : MISSING} |`);
  L.push(`| Khoảng lương ngành | ${wageRange} |`);
  L.push(`| Tỷ lệ nghỉ việc ngành | ${industry.turnover_rate != null ? industry.turnover_rate + '%/tháng' : MISSING} |`);
  L.push(`| Đối thủ đang phục vụ ngành | ${indComps.length || MISSING} |`);

  h('2. Mùa vụ — thời điểm khách cần người');
  if (levels.some(v => v > 0)) {
    L.push(`Tháng hiện tại (T${thisMonth + 1}): **${SEASON[levels[thisMonth] ?? 0]}**`);
    const peak = levels.map((v, i) => ({ v, i })).filter(x => x.v >= 4);
    if (peak.length) L.push(`Cao điểm trong năm: **${peak.map(p => 'T' + (p.i + 1)).join(', ')}**`);
    L.push('');
    for (let i = 0; i < 12; i++) {
      if (!levels[i] && !notes[i]) continue;
      L.push(`- **T${i + 1}** — ${SEASON[levels[i] ?? 0]}${notes[i] ? `: ${notes[i]}` : ''}`);
    }
  } else L.push(MISSING + ' lịch mùa vụ');

  h('3. Cơ cấu vị trí & lương');
  if (positions.length) {
    L.push('| Vị trí | Tỷ lệ | Lương | Độ khó tuyển | Yêu cầu đặc thù |');
    L.push('|---|---|---|---|---|');
    for (const p of positions) {
      const w = p.wage_min != null || p.wage_max != null ? `${tr(p.wage_min) ?? '—'}–${tr(p.wage_max) ?? '—'}` : '—';
      L.push(`| ${p.position} | ${p.ratio_pct != null ? p.ratio_pct + '%' : '—'} | ${w} | ${DIFF[p.difficulty ?? 0]} | ${p.requirements || '—'} |`);
    }
    L.push('');
    L.push('_Dùng bảng này để báo giá theo từng vị trí thay vì một mức chung._');
  } else L.push(MISSING);

  h('4. Giữ chân lao động');
  L.push(`- Tỷ lệ nghỉ việc: **${industry.turnover_rate != null ? industry.turnover_rate + '%/tháng' : MISSING}**`);
  const stages = industry.quit_stages?.length ? industry.quit_stages : (industry.quit_stage ? [industry.quit_stage] : []);
  L.push(`- Nghỉ nhiều nhất ở: **${stages.length ? stages.join(' · ') : MISSING}**`);
  const reasons = industry.quit_reasons ?? [];
  L.push(`- Lý do chính: ${reasons.length ? reasons.map((r, i) => `${i + 1}. ${r}`).join(' · ') : MISSING}`);
  const reasonNotes = industry.quit_reason_notes ?? {};
  for (const r of reasons) {
    const n = (reasonNotes[r] ?? '').trim();
    if (n) L.push(`  - **${r}:** ${n.replace(/\s*\n\s*/g, ' ')}`);
  }
  L.push('');
  L.push('**Biện pháp đã dùng và kết quả:**');
  L.push('');
  L.push(industry.retention_actions || MISSING);

  h('5. Xu hướng theo quý');
  if (metrics.length) {
    L.push('| Kỳ | Lương PT | Lương tay nghề | Phí dịch vụ | Nghỉ % | OT | Cầu LĐ |');
    L.push('|---|---|---|---|---|---|---|');
    for (const m of metrics) {
      const fee = m.service_fee_min != null || m.service_fee_max != null ? `${k(m.service_fee_min)}–${k(m.service_fee_max)}` : '—';
      L.push(`| ${m.period} | ${tr(m.avg_wage_unskilled) ?? '—'} | ${tr(m.avg_wage_skilled) ?? '—'} | ${fee} | ${m.turnover_rate ?? '—'} | ${m.ot_hours ?? '—'} | ${m.demand_headcount?.toLocaleString('vi-VN') ?? '—'} |`);
    }
    const w = metrics.filter(m => m.avg_wage_unskilled != null);
    if (w.length >= 2 && w[0].avg_wage_unskilled) {
      const pct = ((w[w.length - 1].avg_wage_unskilled! - w[0].avg_wage_unskilled!) / w[0].avg_wage_unskilled!) * 100;
      L.push('');
      L.push(`**Câu chốt giá:** lương ngành ${w[0].period} → ${w[w.length - 1].period} ${pct >= 0 ? 'tăng' : 'giảm'} **${Math.abs(pct).toFixed(1)}%**.`);
    }
  } else L.push(MISSING);

  h('6. Khách hàng & dự án trong ngành');
  if (indClients.length) {
    L.push('**Đang hợp tác:**');
    for (const c of indClients) L.push(`- ${c.name}${c.current_workers ? ` · ${c.current_workers} LĐ` : ''}`);
  } else L.push('Đang hợp tác: ' + MISSING);
  if (indLeads.length) {
    L.push('');
    L.push('**Đang tìm hiểu:**');
    for (const l of indLeads) L.push(`- ${l.company_name}${l.region ? ` · ${l.region}` : ''}${l.workers_needed ? ` · cần ${l.workers_needed} LĐ` : ''}`);
  }

  h('7. Đối thủ cần đề phòng');
  if (indComps.length) {
    L.push('| Đối thủ | Khu vực | Phí | Điểm mạnh | Điểm yếu |');
    L.push('|---|---|---|---|---|');
    for (const cp of indComps) {
      L.push(`| ${cp.company_name} | ${cp.zone_name || '—'} | ${k(cp.fee_unskilled ?? cp.fee_skilled ?? cp.fee_tech)} | ${cp.strengths || '—'} | ${cp.weaknesses || '—'} |`);
    }
  } else L.push(MISSING);

  h('8. Chuỗi giá trị — đọc trước biến động');
  const chain = (kind: string, label: string) => {
    const rows = valueChain.filter(v => v.kind === kind);
    L.push(`**${label}:** ${rows.length ? rows.map(r => htmlToMarkdown(r.name) + (r.note ? ` (${r.note})` : '')).join(' · ') : MISSING}`);
    L.push('');
  };
  chain('input', 'Đầu vào');
  chain('customer', 'Khách của khách');
  chain('market', 'Thị trường cuối');

  h('9. Thuật ngữ phải nói đúng');
  const pinned = [...terms].sort((a, b) => Number(b.pinned) - Number(a.pinned)).slice(0, 10);
  if (pinned.length) {
    for (const t of pinned) {
      const alias = (t.aliases ?? []).length ? ` (${(t.aliases ?? []).join(', ')})` : '';
      L.push(`- **${t.term}**${alias} — ${t.short_def || MISSING}`);
    }
  } else L.push(MISSING);

  h('10. Câu nói mẫu khi vào họp');
  const quotes = terms.filter(t => t.example);
  if (quotes.length) for (const t of quotes) L.push(`> ${t.example}  \n> _(${t.term})_`);
  else L.push(MISSING);

  h('11. Bối cảnh ngành');
  // 4 mục này giờ nhập qua RichTextEditor (lưu HTML) — đổi sang markdown cho file xuất sạch,
  // không lẫn thẻ HTML thô.
  const block = (title: string, v?: string | null) => { L.push(`### ${title}`); L.push(''); L.push(htmlToMarkdown(v) || MISSING); L.push(''); };
  block('Đánh giá tổng quan thị trường', industry.overview);
  block('Chính sách & FDI', industry.policy_notes);
  block('Thuế & tác động', industry.tax_notes);
  block('Xu hướng & dự báo', industry.trend_notes);

  return L.join('\n');
}
