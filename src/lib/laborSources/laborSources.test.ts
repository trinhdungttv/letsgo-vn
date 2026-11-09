import { describe, expect, it } from 'vitest';
import { addYears, nextOccurrence, occurrenceMonths, occurrencesBetween, planReminders, upcomingMonths, reminderTitle } from './windows';
import { chunk, computeRoutes, decodePolyline, isFresh, routeKey } from './routing';
import { batchStats, industryIdByName, scoreMatch, type MatchCompany, type MatchContext, type MatchSource } from './match';
import type { InternWindow, LaborSource, RouteRow, SourceBatch } from './types';

const win = (o: Partial<InternWindow>): InternWindow => ({
  id: 'w1', source_id: 's1', program_ids: [], cohort: '', start_date: '2026-03-01', end_date: '2026-05-31',
  expected_count: null, repeat_yearly: true, remind_days: 30, reminder_task_id: null, reminder_for: null,
  note: '', deleted_at: null, created_at: '', ...o,
});
const src = (o: Partial<LaborSource> = {}): LaborSource => ({
  id: 's1', kind: 'cao_dang', name: 'Trường Cao đẳng Công nghệ cao Đồng Nai', short_name: 'CĐ CNC ĐN', ownership: '', status: 'partner',
  priority: null, province: 'Đồng Nai', address: '', map_link: '', lat: 10.95, lng: 106.82, website: '', fanpage: '', phone: '', email: '',
  logo_url: null, student_total: null, intern_per_year: null, has_dorm: null, requirements: [], requirements_note: '',
  mou_signed_at: null, mou_expires_at: null, mou_note: '', branch_id: null, owner_id: null, tags: [], notes: '',
  competitor_ids: [], competitor_note: '', pursuit: '', recontact_at: null, recontact_task_for: null,
  created_by: '', updated_by: '', deleted_at: null, created_at: '', updated_at: '', ...o,
});
const batch = (o: Partial<SourceBatch>): SourceBatch => ({
  id: 'b', source_id: 's1', window_id: null, program_ids: [], client_id: null, lead_id: null, company_name: '', zone_id: null,
  start_date: null, end_date: null, sent_count: 0, passed_count: 0, status: 'done', note: '', created_by: '', deleted_at: null, created_at: '', ...o,
});

describe('lịch thực tập', () => {
  it('29/02 sang năm không nhuận thành 28/02', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2026-03-01', 2)).toBe('2028-03-01');
  });

  it('mùa lặp hằng năm: đang diễn ra thì giữ, đã qua thì sang năm sau', () => {
    const w = win({ start_date: '2024-03-01', end_date: '2024-05-31' });
    expect(nextOccurrence(w, '2026-04-10')).toEqual({ start: '2026-03-01', end: '2026-05-31' });
    expect(nextOccurrence(w, '2026-06-01')).toEqual({ start: '2027-03-01', end: '2027-05-31' });
    expect(nextOccurrence(w, '2026-01-15')).toEqual({ start: '2026-03-01', end: '2026-05-31' });
  });

  it('mùa vắt qua năm mới (T12 → T2) vẫn nhận đúng lần đang diễn ra', () => {
    const w = win({ start_date: '2025-12-01', end_date: '2026-02-15' });
    expect(nextOccurrence(w, '2027-01-10')).toEqual({ start: '2026-12-01', end: '2027-02-15' });
    expect(occurrenceMonths({ start: '2026-12-01', end: '2027-02-15' })).toEqual([1, 2, 12]);
  });

  it('không lặp: giữ đúng ngày đã nhập kể cả đã qua', () => {
    expect(nextOccurrence(win({ repeat_yearly: false }), '2027-01-01')).toEqual({ start: '2026-03-01', end: '2026-05-31' });
  });

  it('các lần trong khoảng 12 tháng (lịch)', () => {
    const w = win({ start_date: '2025-09-01', end_date: '2025-10-15' });
    expect(occurrencesBetween(w, '2026-11-09', '2027-11-09')).toEqual([{ start: '2027-09-01', end: '2027-10-15' }]);
    expect(upcomingMonths([w, win({ id: 'w2', start_date: '2026-03-01', end_date: '2026-04-10' })], '2026-11-09')).toEqual([3, 4, 9, 10]);
  });

  it('nhắc việc: vào khoảng trước 30 ngày, chưa nhắc lần này, đơn vị không tạm dừng', () => {
    const w = win({ start_date: '2025-12-01', end_date: '2025-12-31' });
    const s = src();
    expect(planReminders([w], [s], '2026-10-31')).toHaveLength(0); // còn 31 ngày
    const p = planReminders([w], [s], '2026-11-09');
    expect(p).toHaveLength(1);
    expect(p[0].occurrence.start).toBe('2026-12-01');
    expect(p[0].due).toBe('2026-11-09');
    expect(p[0].title).toBe('Nguồn LĐ: Liên hệ CĐ CNC ĐN — mùa thực tập từ 01/12/2026');
    expect(planReminders([{ ...w, reminder_for: '2026-12-01' }], [s], '2026-11-09')).toHaveLength(0);
    expect(planReminders([w], [src({ status: 'paused' })], '2026-11-09')).toHaveLength(0);
    expect(planReminders([{ ...w, remind_days: 0 }], [s], '2026-11-09')).toHaveLength(0);
    expect(planReminders([w], [s], '2026-12-02')).toHaveLength(0); // đã bắt đầu
  });

  it('tên việc dùng tên đầy đủ khi không có tên viết tắt, kèm khoá', () => {
    expect(reminderTitle({ name: 'ĐH Lạc Hồng', short_name: '' }, { cohort: 'K24' }, { start: '2027-03-01', end: '2027-04-01' }))
      .toBe('Nguồn LĐ: Liên hệ ĐH Lạc Hồng — mùa thực tập K24 từ 01/03/2027');
  });
});

describe('đường xe', () => {
  it('giải polyline độ chính xác 6 (mẫu của Valhalla)', () => {
    // Mẫu chuẩn Google (precision 5) "_p~iF~ps|U_ulLnnqC_mqNvxq`@" = (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(pts).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });

  it('chia lượt và nhận biết toạ độ đã dời', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    const row = { from_lat: 10.95, from_lng: 106.82, to_lat: 10.8, to_lng: 106.7 } as RouteRow;
    expect(isFresh(row, { lat: 10.9501, lng: 106.82 }, { lat: 10.8, lng: 106.7 })).toBe(true);
    expect(isFresh(row, { lat: 10.96, lng: 106.82 }, { lat: 10.8, lng: 106.7 })).toBe(false);
    expect(isFresh(undefined, { lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(false);
  });

  it('đích gần dùng Valhalla bus; đích xa và lượt Valhalla lỗi chuyển sang OSRM × hệ số xe khách', async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      calls.push(url.split('?')[0].replace(/\/table\/v1\/driving\/.*/, '/table'));
      if (url.includes('sources_to_targets')) {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ sources_to_targets: [body.targets.map((_: unknown, i: number) => ({ to_index: i, distance: 38.88, time: 3406 }))] }));
      }
      // OSRM: 1 nguồn + n đích
      const n = url.split('?')[0].split('/').pop()!.split(';').length - 1;
      return new Response(JSON.stringify({ code: 'Ok', durations: [[0, ...Array(n).fill(2400)]], distances: [[0, ...Array(n).fill(1_188_677)]] }));
    };
    const res = await computeRoutes({ lat: 10.95, lng: 106.8 }, [
      { type: 'zone', id: 'near', lat: 10.75, lng: 106.95 },
      { type: 'zone', id: 'far', lat: 18.67, lng: 105.69 },
    ], { fetchFn, gapMs: 0 });
    expect(res.get(routeKey('zone', 'near'))).toEqual({ distanceKm: 38.88, durationMin: 56.8, engine: 'valhalla-bus' });
    expect(res.get(routeKey('zone', 'far'))).toEqual({ distanceKm: 1188.68, durationMin: 54, engine: 'osrm-car' });
    expect(calls).toEqual(['https://valhalla1.openstreetmap.de/sources_to_targets', 'https://router.project-osrm.org/table']);
  });

  it('Valhalla lỗi → cả lượt đó tính bằng OSRM; cả 2 lỗi → không có kết quả (lần sau tính lại)', async () => {
    const bad = async () => new Response('x', { status: 502 });
    const none = await computeRoutes({ lat: 10.95, lng: 106.8 }, [{ type: 'client', id: 'c', lat: 10.8, lng: 106.7 }], { fetchFn: bad, gapMs: 0 });
    expect(none.size).toBe(0);
    const osrmOnly = async (url: string) => url.includes('valhalla')
      ? new Response('x', { status: 429 })
      : new Response(JSON.stringify({ code: 'Ok', durations: [[0, 600]], distances: [[0, 10000]] }));
    const r = await computeRoutes({ lat: 10.95, lng: 106.8 }, [{ type: 'client', id: 'c', lat: 10.8, lng: 106.7 }], { fetchFn: osrmOnly, gapMs: 0 });
    expect(r.get('client:c')).toEqual({ distanceKm: 10, durationMin: 13.5, engine: 'osrm-car' });
  });
});

describe('gợi ý ghép trường ↔ công ty', () => {
  const company: MatchCompany = { type: 'client', id: 'c1', name: 'Điện tử A', industryId: 'dt', industryName: 'Điện tử', zoneId: 'z', lat: 10.8, lng: 106.7 };
  const source: MatchSource = { id: 's1', lat: 10.95, lng: 106.82, industryIds: new Set(['dt']), months: [3, 4] };
  const season = Array(12).fill(2);
  season[2] = 5; // T3 cao điểm
  const ctx = (batches: SourceBatch[] = []): MatchContext => ({
    batches, batchIndustry: b => (b.client_id === 'c2' ? 'dt' : null), seasonOf: id => (id === 'dt' ? season : null),
  });

  it('đủ 4 tiêu chí tốt → điểm cao, đủ 4 lý do', () => {
    const r = scoreMatch(source, company, { distanceKm: 25, durationMin: 40 }, ctx([batch({ client_id: 'c1', sent_count: 10, passed_count: 9 })]));
    expect(r.parts).toEqual({ industry: 35, distance: 21, history: 23, season: 15 });
    expect(r.score).toBe(94);
    expect(r.reasons.map(x => x.key)).toEqual(['industry', 'distance', 'history', 'season']);
    expect(r.estimated).toBe(false);
  });

  it('chưa có đợt ở công ty này → lấy công ty cùng ngành; không có nữa → trung tính', () => {
    const r = scoreMatch(source, company, { distanceKm: 25, durationMin: 40 }, ctx([batch({ client_id: 'c2', sent_count: 10, passed_count: 5 })]));
    expect(r.parts.history).toBe(9);
    expect(scoreMatch(source, company, null, ctx()).parts.history).toBe(10);
  });

  it('khác ngành, lệch mùa, không tìm được đường → điểm thấp', () => {
    const r = scoreMatch({ ...source, industryIds: new Set(['ck']), months: [8] }, company, { distanceKm: null, durationMin: null }, ctx());
    expect(r.parts.industry).toBe(0);
    expect(r.parts.distance).toBe(0);
    expect(r.parts.season).toBe(2);
    expect(r.reasons.find(x => x.key === 'season')?.text).toContain('ngành cao điểm T3');
  });

  it('chưa tính đường → ước từ đường thẳng và đánh dấu ước tính', () => {
    const r = scoreMatch(source, company, null, ctx());
    expect(r.estimated).toBe(true);
    expect(r.durationMin).toBeGreaterThan(30);
  });

  it('thống kê đợt bỏ đợt huỷ / đã xoá, đạt không vượt số gửi', () => {
    expect(batchStats([
      batch({ sent_count: 10, passed_count: 7 }),
      batch({ sent_count: 5, passed_count: 9 }),
      batch({ sent_count: 8, passed_count: 8, status: 'cancelled' }),
      batch({ sent_count: 8, passed_count: 8, deleted_at: 'x' }),
    ])).toEqual({ count: 2, sent: 15, passed: 12, rate: 0.8 });
  });

  it('tìm ngành theo tên bỏ dấu', () => {
    expect(industryIdByName('dien tu ', [{ id: 'dt', name: 'Điện tử' }])).toBe('dt');
    expect(industryIdByName('', [{ id: 'dt', name: 'Điện tử' }])).toBeNull();
  });
});

import { guessKind, nameKey, parseBulk } from './bulk';
import { planRecontacts } from './windows';

describe('nhập nhanh danh sách trường', () => {
  it('dán từ Excel (Tab): nhận tên, tỉnh, người, chức vụ, SĐT; bỏ dòng tiêu đề và dòng trống', () => {
    const rows = parseBulk('Tên trường\tTỉnh\tNgười phụ trách\tChức vụ\tSĐT\nTrường Cao đẳng Đồng Nai\tĐồng Nai\tNguyễn Văn A\tTrưởng phòng QHDN\t0909 123 456\n\nĐại học Lạc Hồng');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Trường Cao đẳng Đồng Nai', province: 'Đồng Nai', person: 'Nguyễn Văn A', role: 'Trưởng phòng QHDN', phone: '0909 123 456', kind: 'cao_dang' });
    expect(rows[1]).toMatchObject({ name: 'Đại học Lạc Hồng', province: '', person: '', phone: '', kind: 'dai_hoc' });
  });

  it('dấu ; và SĐT ở cột bất kỳ', () => {
    const [r] = parseBulk('Trung cấp nghề Nhơn Trạch; 0251.3560.123; Đồng Nai; Cô Lan');
    expect(r).toMatchObject({ phone: '0251.3560.123', province: 'Đồng Nai', person: 'Cô Lan', kind: 'trung_cap' });
  });

  it('đoán loại theo tên, so trùng bỏ dấu', () => {
    expect(guessKind('UBND xã Phước Thiền')).toBe('dia_phuong');
    expect(guessKind('Trung tâm GDNN Long Thành')).toBe('trung_tam');
    expect(guessKind('Trường ABC')).toBeNull();
    expect(nameKey('  Đại học  Lạc Hồng ')).toBe(nameKey('dai hoc lac hong'));
  });
});

describe('hẹn liên hệ lại', () => {
  it('tới ngày hẹn, nhãn Để liên hệ sau, chưa tạo việc cho ngày hẹn đó', () => {
    const base = src({ pursuit: 'lien_he_sau', recontact_at: '2026-11-09', recontact_task_for: null, competitor_ids: [], competitor_note: '' });
    expect(planRecontacts([base], '2026-11-08')).toHaveLength(0);
    const p = planRecontacts([base], '2026-11-09');
    expect(p[0].title).toBe('Nguồn LĐ: Liên hệ lại CĐ CNC ĐN (hẹn 09/11/2026)');
    expect(planRecontacts([{ ...base, recontact_task_for: '2026-11-09' }], '2026-11-10')).toHaveLength(0);
    expect(planRecontacts([{ ...base, pursuit: 'uu_tien' }], '2026-11-10')).toHaveLength(0);
  });
});

import { isMonthOnly, windowLabel, yearlyDates } from './windows';

describe('lịch hằng năm không cần năm', () => {
  it('chỉ tháng: đầu tháng → cuối tháng, vắt qua năm thì sang năm mốc + 1', () => {
    expect(yearlyDates(3, null, 5, null)).toEqual({ start: '2000-03-01', end: '2000-05-31' });
    expect(yearlyDates(12, null, 2, null)).toEqual({ start: '2000-12-01', end: '2001-02-28' });
    expect(yearlyDates(2, 29, 2, 29)).toEqual({ start: '2000-02-29', end: '2000-02-29' });
  });

  it('nhãn và lần tới tính đúng năm hiện tại', () => {
    const w = win({ ...yearlyDates(3, null, 5, null) && { start_date: '2000-03-01', end_date: '2000-05-31' } });
    expect(isMonthOnly(w)).toBe(true);
    expect(windowLabel(w)).toBe('T3 – T5 hằng năm');
    expect(nextOccurrence(w, '2026-11-09')).toEqual({ start: '2027-03-01', end: '2027-05-31' });
    const d = { ...w, ...(() => { const x = yearlyDates(3, 15, 5, 20); return { start_date: x.start, end_date: x.end }; })() };
    expect(windowLabel(d)).toBe('15/03 – 20/05 hằng năm');
    const cross = { ...w, start_date: '2000-12-01', end_date: '2001-02-28' };
    expect(nextOccurrence(cross, '2027-01-10')).toEqual({ start: '2026-12-01', end: '2027-02-28' });
    expect(windowLabel({ ...w, repeat_yearly: false, start_date: '2027-03-01', end_date: '2027-04-01' })).toBe('01/03/2027 – 01/04/2027');
  });
});
