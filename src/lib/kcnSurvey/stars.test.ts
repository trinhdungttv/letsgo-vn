import { describe, expect, it } from 'vitest';
import { daysLeft, dayLabel, findStar, groupByDay, photoStarRef, starKey, type SurveyStar } from './stars';
import { buildZoneReport, reportIntro } from './zoneReport';
import type { SurveyPhoto, SurveyTrip, SurveyVoiceNote } from './api';

const star = (o: Partial<SurveyStar>): SurveyStar => ({
  id: 's', company_key: '', company_name: '', client_id: null, crm_id: null, lead_id: null, zone_id: null, zone_name: '', note: '', user_id: null, user_name: '', created_at: '', ...o,
});

describe('sao công ty cần chú trọng', () => {
  it('khoá: khách hàng > pipeline > Thị trường > tên bỏ dấu theo KCN', () => {
    expect(starKey({ clientId: 'a', crmId: 'b', name: 'X' })).toBe('c:a');
    expect(starKey({ crmId: 'b', leadId: 'c', name: 'X' })).toBe('p:b');
    expect(starKey({ leadId: 'c', name: 'X' })).toBe('l:c');
    expect(starKey({ name: '  Công ty  TNHH Đại Phát ', zoneId: 'z1' })).toBe('n:cong ty tnhh dai phat@z1');
    expect(starKey({ name: 'A' })).toBe('n:a@');
  });
  it('tìm sao theo mã hoặc cùng tên (không phân biệt dấu / hoa thường)', () => {
    const stars = [star({ client_id: 'c1', company_name: 'Alpha' }), star({ company_name: 'Công ty Đại Phát' })];
    expect(findStar(stars, { clientId: 'c1', name: 'khác tên' })).toBe(stars[0]);
    expect(findStar(stars, { name: 'cong ty dai phat' })).toBe(stars[1]);
    expect(findStar(stars, { name: 'Beta', leadId: 'l9' })).toBeNull();
    expect(findStar(stars, { name: '' })).toBeNull();
    expect(photoStarRef({ client_id: null, crm_id: 'p', lead_id: null, company_name: 'X', zone_id: 'z' })).toEqual({ clientId: null, crmId: 'p', leadId: null, name: 'X', zoneId: 'z' });
  });
});

describe('Lưu trữ 30 ngày', () => {
  it('còn bao nhiêu ngày trước khi tự xoá hẳn', () => {
    const now = new Date('2026-11-04T10:00:00Z').getTime();
    expect(daysLeft('2026-11-04T09:00:00Z', now)).toBe(30);
    expect(daysLeft('2026-10-07T10:00:00Z', now)).toBe(2);
    expect(daysLeft('2026-10-05T11:00:00Z', now)).toBe(1);
    expect(daysLeft('2026-09-01T00:00:00Z', now)).toBe(0);
    expect(daysLeft('lỗi', now)).toBe(30);
  });
});

describe('nhóm chuyến theo ngày', () => {
  it('ngày mới nhất trước, giữ thứ tự trong ngày, nhãn có thứ', () => {
    const at = (d: string) => new Date(d).toISOString();
    const items = [at('2026-11-04T09:00:00'), at('2026-11-04T07:00:00'), at('2026-11-02T15:00:00'), at('2026-11-03T08:00:00')];
    const g = groupByDay(items, x => x);
    expect(g.map(x => x.items.length)).toEqual([2, 1, 1]);
    expect(g[0].items[0]).toBe(items[0]);
    expect(g[0].label).toBe('Thứ Tư, 04/11/2026');
    expect(dayLabel(new Date('2026-11-08T12:00:00'))).toBe('Chủ nhật, 08/11/2026');
  });
});

const photo = (o: Partial<SurveyPhoto>): SurveyPhoto => ({
  id: Math.random().toString(36), trip_id: null, zone_id: 'z', zone_name: 'KCN A', lat: 10.7, lng: 106.9, accuracy_m: 5, position_source: 'gps',
  taken_at: '2026-11-01T08:00:00Z', storage_path: 'p', url: 'https://x/p.jpg', thumb_url: null, width: 100, height: 100, size_bytes: 1,
  company_name: '', client_id: null, lead_id: null, crm_id: null, positions: '', headcount: null, wage_text: '', note: '', annotations: [], survey_kind: 'field', verified_at: null,
  user_id: null, user_name: 'Tony', created_at: '', ...o,
});

describe('báo cáo PDF theo KCN cho AI đọc', () => {
  it('gom theo công ty: sao lên đầu, vị trí / lương không trùng, số lượng lần chụp gần nhất', () => {
    const photos = [
      photo({ company_name: 'Alpha', positions: 'CN may, QC', headcount: 20, wage_text: '8-10tr', taken_at: '2026-11-03T08:00:00Z' }),
      photo({ company_name: 'alpha ', positions: 'qc, Kho', headcount: 5, wage_text: '8-10tr', taken_at: '2026-11-01T08:00:00Z' }),
      photo({ company_name: 'Beta', positions: 'Kỹ thuật', wage_text: '', taken_at: '2026-11-02T08:00:00Z',
        annotations: [{ t: 'text', c: '#FF3B30', s: 0.05, x: 0.1, y: 0.1, text: 'Tuyển gấp' }] }),
      photo({ company_name: '', taken_at: '2026-10-30T08:00:00Z' }),
    ];
    const trips = [{ id: 't', distance_m: 3200, passed: [{ key: 'c:1', name: 'Alpha', status: 'client', first_at: '', min_dist_m: 5 }, { key: 'o:2', name: 'Gamma', status: 'osm', first_at: '', min_dist_m: 9 }], started_at: '2026-11-03T07:00:00Z', title: 'Chuyến', zone_name: 'KCN A', road_coverage: 40, note: '', user_name: 'Tony' }] as unknown as SurveyTrip[];
    const r = buildZoneReport({
      zoneName: 'KCN A', province: 'Đồng Nai', from: new Date('2026-10-05T00:00:00'), to: new Date('2026-11-04T00:00:00'),
      trips, photos, voice: [] as SurveyVoiceNote[], stars: [star({ company_name: 'Beta' })],
    });
    expect(r.title).toBe('Khảo sát tuyển dụng — KCN A (Đồng Nai)');
    expect(r.companies.map(c => c.name)).toEqual(['Beta', 'Alpha', 'Chưa rõ công ty']);
    const alpha = r.companies[1];
    expect(alpha).toMatchObject({ photos: 2, positions: ['CN may', 'QC', 'Kho'], headcount: 20, wages: ['8-10tr'] });
    expect(r.summary).toMatchObject({ trips: 1, distanceM: 3200, photos: 4, companies: 2, starred: 1, headcount: 20, withWage: 1 });
    expect(r.photos[0].photo.company_name).toBe('Alpha');
    expect(r.photos.find(p => p.photo.company_name === 'Beta')).toMatchObject({ starred: true, markText: ['Tuyển gấp'] });
    expect(r.passed.map(g => g.label)).toEqual(['Đang hợp tác', 'Trên bản đồ']);
    expect(reportIntro(r)[0]).toContain('KCN A (Đồng Nai)');
  });
});

describe('PDF riêng 1 chuyến khảo sát', () => {
  it('tiêu đề có chuyến, thời gian là giờ đi của chuyến', () => {
    const r = buildZoneReport({
      zoneName: 'KCN A', province: null, from: new Date('2026-11-04T01:00:00Z'), to: new Date('2026-11-04T02:30:00Z'),
      trips: [], photos: [photo({ company_name: 'Alpha' })], voice: [], stars: [],
      scope: { label: 'chuyến 04/11/2026 08:00', periodText: '04/11/2026 08:00 – 09:30' },
    });
    expect(r.title).toBe('Khảo sát tuyển dụng — KCN A — chuyến 04/11/2026 08:00');
    expect(r.periodText).toBe('04/11/2026 08:00 – 09:30');
    expect(reportIntro(r)[0]).toContain('thời gian: 04/11/2026 08:00 – 09:30');
  });
});
