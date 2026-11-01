// Bản Markdown của báo cáo tổng quan lao động.
// Biểu đồ dùng Mermaid (xychart-beta / pie) — hiển thị sẵn trên GitHub, Obsidian, Typora, Notion, VS Code…
// Mỗi biểu đồ luôn có BẢNG số đi kèm (cột thanh ký tự █) để trình xem không hỗ trợ Mermaid
// hoặc khi đưa vào AI vẫn đọc đủ số liệu.
import { fmtDateTime, fmtN, fmtPct, fmtShare, fmtSigned, type LaborReport, type LrGroupRow, type LrPeriod } from './model';

const esc = (s: string) => s.replace(/\|/g, '／').replace(/\n/g, ' ');
const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

const SPARK = '▁▂▃▄▅▆▇█';
/** Đường xu hướng mini bằng ký tự: ▁▃▅▇. */
export function sparkline(values: (number | null)[]): string {
  const vals = values.filter((v): v is number => v != null);
  if (!vals.length) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals);
  // Cả dãy bằng nhau: toàn 0 → vạch thấp nhất, còn lại → vạch giữa (đi ngang).
  return values.map(v => (v == null ? ' ' : SPARK[hi === lo ? (hi === 0 ? 0 : 3) : Math.round(((v - lo) / (hi - lo)) * 7)])).join('');
}

const PART = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
/** Thanh ngang tỉ lệ (tối đa `width` ô). */
export function hbar(v: number, max: number, width = 20): string {
  if (max <= 0 || v <= 0) return '';
  const units = (v / max) * width;
  const full = Math.floor(units);
  return '█'.repeat(full) + PART[Math.round((units - full) * 7)];
}

const arrow = (d: number | null | undefined) => (d == null ? '' : d > 0 ? '▲ ' : d < 0 ? '▼ ' : '');
const delta = (d: number | null | undefined, p?: number | null) =>
  d == null ? '—' : `${arrow(d)}${fmtSigned(d)}${p !== undefined && p !== null && d !== 0 ? ` (${fmtPct(p)})` : ''}`;

function niceRange(vals: number[]): { lo: number; hi: number } {
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = Math.max(max - min, max * 0.05, 10);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find(s => s >= span / 5) ?? 10000;
  return { lo: Math.max(0, Math.floor((min - span * 0.15) / step) * step), hi: Math.ceil((max + span * 0.15) / step) * step };
}

function lineChart(title: string, periods: LrPeriod[]): string {
  const pts = periods.filter(p => p.total != null);
  if (pts.length < 2) return '';
  const { lo, hi } = niceRange(pts.map(p => p.total!));
  return [
    '```mermaid',
    'xychart-beta',
    `  title ${q(title)}`,
    `  x-axis [${pts.map(p => q(p.short)).join(', ')}]`,
    `  y-axis "Lao động" ${lo} --> ${hi}`,
    `  line [${pts.map(p => p.total).join(', ')}]`,
    '```',
  ].join('\n');
}

function barChart(title: string, labels: string[], values: number[], horizontal = false): string {
  if (!values.length) return '';
  const hi = Math.max(...values, 1);
  return [
    '```mermaid',
    horizontal ? 'xychart-beta horizontal' : 'xychart-beta',
    `  title ${q(title)}`,
    `  x-axis [${labels.map(q).join(', ')}]`,
    `  y-axis "Lao động" 0 --> ${Math.ceil((hi * 1.1) / 10) * 10}`,
    `  bar [${values.join(', ')}]`,
    '```',
  ].join('\n');
}

function pieChart(title: string, rows: { name: string; value: number }[]): string {
  const data = rows.filter(r => r.value > 0);
  if (data.length < 2) return '';
  return ['```mermaid', `pie showData title ${title}`, ...data.map(r => `  ${q(r.name)} : ${r.value}`), '```'].join('\n');
}

function periodTable(periods: LrPeriod[], isWeek: boolean): string {
  const max = Math.max(...periods.map(p => p.total ?? 0), 1);
  const head = isWeek
    ? '| Tuần | Ngày làm việc | Tổng LĐ | Tăng/giảm | Số thật / KH | Biểu đồ |\n|---|---|---:|---:|---:|---|'
    : '| Tháng | Tổng LĐ (chốt) | Tăng/giảm | Số thật / KH | Biểu đồ |\n|---|---:|---:|---:|---|';
  const rows = periods.map((p, i) => {
    const prev = i > 0 ? periods[i - 1].total : null;
    const d = p.total != null && prev != null ? p.total - prev : null;
    const pc = d != null && prev ? (d / prev) * 100 : null;
    const cov = p.contributingClients ? `${p.actualClients}/${p.contributingClients}${p.coverage < 0.5 ? ' ⚠' : ''}` : '—';
    return isWeek
      ? `| ${p.label} | ${p.range} | ${fmtN(p.total)} | ${delta(d, pc)} | ${cov} | ${hbar(p.total ?? 0, max)} |`
      : `| ${p.range} | ${fmtN(p.total)} | ${delta(d, pc)} | ${cov} | ${hbar(p.total ?? 0, max)} |`;
  });
  return [head, ...rows].join('\n');
}

function groupTable(rows: LrGroupRow[], label: string, r: LaborReport): string {
  const head = `| # | ${label} | LĐ tuần chốt | Tỷ trọng | ± tuần | ${r.prevMonthLabel ? `${r.prevMonthLabel}` : 'Tháng trước'} | ${r.anchorMonthLabel} | ± tháng | KH | Xu hướng ${r.weeks.length} tuần |\n|---:|---|---:|---:|---:|---:|---:|---:|---:|---|`;
  const body = rows.map((g, i) =>
    `| ${i + 1} | ${esc(g.name)} | **${fmtN(g.cur)}** | ${fmtShare(g.share)} | ${delta(g.dWeek)} | ${fmtN(g.prevMonth)} | ${fmtN(g.curMonth)} | ${delta(g.dMonth, g.dMonthPct)} | ${g.clients} | \`${sparkline(g.weekly)}\` |`);
  const t = r.kpis.total ?? 0;
  const sum = rows.reduce((a, g) => ({ prevMonth: a.prevMonth + g.prevMonth, curMonth: a.curMonth + g.curMonth, dWeek: a.dWeek + g.dWeek, clients: a.clients + g.clients }), { prevMonth: 0, curMonth: 0, dWeek: 0, clients: 0 });
  body.push(`|  | **Tổng** | **${fmtN(t)}** | 100% | ${delta(sum.dWeek)} | ${fmtN(sum.prevMonth)} | ${fmtN(sum.curMonth)} | ${delta(sum.curMonth - sum.prevMonth, sum.prevMonth ? ((sum.curMonth - sum.prevMonth) / sum.prevMonth) * 100 : null)} | ${sum.clients} |  |`);
  return [head, ...body].join('\n');
}

function matrixTable(rows: LrGroupRow[], label: string, periods: LrPeriod[], pick: (g: LrGroupRow) => number[]): string {
  const head = `| ${label} | ${periods.map(p => p.short).join(' | ')} |\n|---|${periods.map(() => '---:').join('|')}|`;
  const body = rows.map(g => {
    const vals = pick(g);
    return `| ${esc(g.name)} | ${vals.map((v, i) => {
      const prev = i > 0 ? vals[i - 1] : null;
      const mark = prev == null || prev === v ? '' : v > prev ? ' ▲' : ' ▼';
      return `${fmtN(v)}${mark}`;
    }).join(' | ')} |`;
  });
  return [head, ...body].join('\n');
}

export function buildLaborReportMarkdown(r: LaborReport): string {
  const k = r.kpis;
  const gen = fmtDateTime(r.generatedAt);
  const year = r.anchor.key.slice(0, 4);
  const out: string[] = [];
  const push = (...s: string[]) => out.push(...s.filter(x => x !== ''), '');

  push(
    `# Báo cáo tổng quan lao động — Let's Go VN`,
    `> **Phạm vi:** ${r.scopeLabel} · **Tuần chốt:** ${r.anchor.label} (${r.anchor.range}/${year}) · **Tháng chốt:** ${r.anchorMonthLabel}  \n> **Tạo lúc:** ${gen} · Nguồn: CRM Let's Go VN — lịch sử số lao động hằng tuần của khách hàng`,
  );

  // 1. Tóm tắt
  push('## 1. Tóm tắt điều hành');
  push(
    '| Chỉ số | Giá trị | So sánh |',
    '|---|---:|---|',
    `| Tổng lao động tuần chốt | **${fmtN(k.total)}** | ${delta(k.dWeek, k.dWeekPct)} so với tuần trước · ${delta(k.d4Week, k.d4WeekPct)} so với 4 tuần trước |`,
    `| Số chốt ${r.anchorMonthLabel.toLowerCase()} | **${fmtN(k.curMonth)}** | ${r.prevMonthLabel ? `${delta(k.dMonth, k.dMonthPct)} so với ${r.prevMonthLabel.toLowerCase()}` : '—'} |`,
    `| So với đầu kỳ (${r.months[0]?.range ?? '—'}) | ${fmtN(k.firstMonth)} → ${fmtN(k.curMonth)} | ${delta(k.dFirstMonth, k.dFirstMonthPct)} |`,
    `| Cao nhất / thấp nhất ${r.weeks.length} tuần | ${fmtN(k.peak?.value)} / ${fmtN(k.trough?.value)} | ${k.peak?.label ?? '—'} / ${k.trough?.label ?? '—'} |`,
    `| Khách hàng đang có lao động | ${k.activeClients} | Bình quân ${fmtN(k.avgPerClient)} LĐ/KH |`,
    `| Chi nhánh / khu vực có lao động | ${k.branchCount} / ${k.areaCount} |  |`,
    k.commitTotal ? `| Đạt cam kết tối thiểu | ${k.commitMet}/${k.commitTotal} KH | Thiếu ${fmtN(k.commitGap)} LĐ |` : '',
    `| Độ phủ số liệu tuần chốt | ${k.actualClients}/${k.contributingClients} KH | ${fmtShare(k.coverage)} có số thật${k.coverage < 0.5 ? ' ⚠ phần còn lại là số gần nhất' : ''} |`,
  );
  push('### Nhận định chính', ...r.insights.map(s => `- ${s}`));

  // 2. Theo tuần
  push(`## 2. Xu hướng theo tuần (${r.weeks.length} tuần)`);
  push(lineChart(`Tổng lao động theo tuần · ${r.scopeLabel}`, r.weeks));
  push(periodTable(r.weeks, true));
  push('> ⚠ = dưới 50% khách hàng có số thật trong tuần đó — tổng có dùng số gần nhất của KH chưa nhập.');

  // 3. Theo tháng
  push(`## 3. Xu hướng theo tháng`);
  push(barChart(`Số lao động chốt tháng · ${r.scopeLabel}`, r.months.map(m => m.short), r.months.map(m => m.total ?? 0)));
  push(periodTable(r.months, false));
  if (r.monthBridge) {
    const b = r.monthBridge;
    push(
      `### Cầu biến động: ${r.prevMonthLabel} → ${r.anchorMonthLabel}`,
      '| Khoản | Lao động |',
      '|---|---:|',
      `| ${r.prevMonthLabel} (đầu kỳ) | ${fmtN(b.start)} |`,
      `| + KH mới / chuyển đến | ${fmtSigned(b.newClients)} |`,
      `| + KH hiện hữu tăng | ${fmtSigned(b.increase)} |`,
      `| − KH hiện hữu giảm | ${fmtSigned(-b.decrease)} |`,
      `| − KH về 0 / ngưng | ${fmtSigned(-b.lost)} |`,
      `| **${r.anchorMonthLabel} (cuối kỳ)** | **${fmtN(b.end)}** |`,
    );
    if (b.newList.length) push(`**KH mới / chuyển đến:** ${b.newList.map(x => `${x.name} (${fmtN(x.value)})`).join(', ')}`);
    if (b.lostList.length) push(`**KH về 0 / ngưng:** ${b.lostList.map(x => `${x.name} (${fmtN(x.value)})`).join(', ')}`);
  }

  // 4. Chi nhánh
  const brs = r.branches;
  push(`## 4. So sánh chi nhánh`);
  push(barChart(`Lao động theo chi nhánh · tuần ${r.anchor.label}`, brs.map(b => b.name), brs.map(b => b.cur), true));
  push(groupTable(brs, 'Chi nhánh', r));
  push(`### Chi nhánh × tháng (số chốt tháng)`, matrixTable(brs, 'Chi nhánh', r.months, g => g.monthly));
  const lastW = r.weeks.slice(-8);
  push(`### Chi nhánh × 8 tuần gần nhất`, matrixTable(brs, 'Chi nhánh', lastW, g => g.weekly.slice(-8)));

  // 5. Khu vực + KCN
  push(`## 5. So sánh khu vực`);
  push(pieChart(`Tỷ trọng lao động theo khu vực · tuần ${r.anchor.label}`, r.areas.map(a => ({ name: a.name, value: a.cur }))));
  push(groupTable(r.areas, 'Khu vực', r));
  push(`### Khu vực × tháng (số chốt tháng)`, matrixTable(r.areas, 'Khu vực', r.months, g => g.monthly));
  const kcn = r.kcns.filter(x => x.cur > 0 || x.curMonth > 0 || x.prevMonth > 0);
  if (kcn.length) {
    push(`### Theo KCN (${kcn.length} KCN có lao động)`);
    push(barChart(`Top KCN theo lao động · tuần ${r.anchor.label}`, kcn.slice(0, 12).map(x => x.name), kcn.slice(0, 12).map(x => x.cur), true));
    push(groupTable(kcn, 'KCN', r));
  }

  // 6. Khách hàng
  push(`## 6. Biến động khách hàng`);
  const withD = r.clients.filter(c => c.dMonth != null && c.dMonth !== 0);
  const ups = [...withD].sort((a, b) => b.dMonth! - a.dMonth!).filter(c => c.dMonth! > 0).slice(0, 10);
  const downs = [...withD].sort((a, b) => a.dMonth! - b.dMonth!).filter(c => c.dMonth! < 0).slice(0, 10);
  const moverTable = (list: typeof ups) => [
    `| Khách hàng | Chi nhánh | ${r.prevMonthLabel ?? 'Tháng trước'} | ${r.anchorMonthLabel} | Tăng/giảm |`,
    '|---|---|---:|---:|---:|',
    ...list.map(c => `| ${esc(c.name)} | ${esc(c.branch)} | ${fmtN(c.prevMonth)} | ${fmtN(c.curMonth)} | ${delta(c.dMonth)} |`),
  ].join('\n');
  push(`### Top tăng trong tháng`, ups.length ? moverTable(ups) : '_Không có khách hàng tăng._');
  push(`### Top giảm trong tháng`, downs.length ? moverTable(downs) : '_Không có khách hàng giảm._');
  if (r.commitShortfall.length) {
    push(
      `### Khách hàng dưới mức cam kết tối thiểu`,
      '| Khách hàng | Chi nhánh | Hiện có | Cam kết | Thiếu |',
      '|---|---|---:|---:|---:|',
      ...r.commitShortfall.map(c => `| ${esc(c.name)} | ${esc(c.branch)} | ${fmtN(c.cur)} | ${fmtN(c.min)} | **${fmtN(c.gap)}** |`),
    );
  }

  // 7. Chất lượng dữ liệu
  push(`## 7. Chất lượng số liệu`);
  push(
    '| Tuần | KH có số thật | KH được tính | Độ phủ |',
    '|---|---:|---:|---:|',
    ...r.weeks.map(w => `| ${w.label} (${w.range}) | ${w.actualClients} | ${w.contributingClients} | ${fmtShare(w.coverage)}${w.coverage < 0.5 ? ' ⚠' : ''} |`),
  );
  if (r.stale.length) {
    push(
      `### Khách hàng chưa cập nhật số từ 2 tuần trở lên (${r.stale.length})`,
      '| Khách hàng | Chi nhánh | Nhập gần nhất | Số tuần chưa cập nhật | Số đang dùng |',
      '|---|---|---|---:|---:|',
      ...r.stale.map(s => `| ${esc(s.name)} | ${esc(s.branch)} | ${s.lastLabel} | ${s.weeks} | ${fmtN(s.value)} |`),
    );
  }

  // 8. Phụ lục
  const shownMonths = r.months.slice(-6);
  const offset = r.months.length - shownMonths.length;
  push(`## 8. Phụ lục — chi tiết khách hàng (${r.clients.length})`);
  push(
    `| Khách hàng | Chi nhánh | Khu vực | KCN | ${shownMonths.map(m => m.short).join(' | ')} | Tuần ${r.anchor.label} | ± tháng |`,
    `|---|---|---|---|${shownMonths.map(() => '---:').join('|')}|---:|---:|`,
    ...r.clients.map(c => `| ${esc(c.name)} | ${esc(c.branch)} | ${esc(c.area)} | ${esc(c.kcn)} | ${c.monthly.slice(offset).map(v => fmtN(v)).join(' | ')} | ${fmtN(c.cur)}${c.curEstimated ? '*' : ''} | ${delta(c.dMonth)} |`),
  );
  push('> \\* = số gần nhất (KH chưa nhập tuần chốt).');

  push('## Phương pháp tính', ...r.notes.map(n => `- ${n}`));
  push(
    '## Hướng dẫn cho AI khi đọc file này',
    '- Mọi con số đã được hệ thống tính sẵn — dùng nguyên số, KHÔNG tự cộng lại từ bảng phụ lục để thay thế.',
    '- Tuần/tháng có dấu ⚠ là độ phủ số thật thấp: khi bình luận xu hướng, nói rõ là "ước tính", không kết luận tăng/giảm mạnh từ các điểm đó.',
    '- Tên chi nhánh, khu vực, KCN giữ đúng như trong file. Đơn vị: người (lao động).',
  );
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function laborReportFileName(r: LaborReport, ext: 'pdf' | 'md'): string {
  const slug = r.scopeLabel.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const d = r.generatedAt;
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `bao-cao-lao-dong_${slug}_${r.anchor.label}_${stamp}.${ext}`;
}
