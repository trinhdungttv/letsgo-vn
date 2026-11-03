import { describe, expect, it } from 'vitest';
import { overtureToScan, parseReleases, tilePointToLatLng, tilesFor } from './overtureScan';
import { mergeScan, scanArea, stripHiring, looksLikeHiringPage } from './marketScan';

const C = { lat: 10.7346634, lng: 106.9318892 };
const area = scanArea(C, null, 1500, 6000);
const props = (o: Record<string, unknown>) => ({
  confidence: 0.8, phones: '["+842513560128"]', socials: '["https://www.facebook.com/123"]', addresses: '[{"freeform":"Đường 2 KCN Nhơn Trạch 1","locality":"Huyện Nhơn Trạch"}]',
  ...o,
});
const tax = (primary: string, ...h: string[]) => JSON.stringify({ primary, hierarchy: h });

describe('Overture Maps', () => {
  it('ô zoom 14 phủ khung + đổi toạ độ trong ô ra kinh / vĩ độ', () => {
    const t = tilesFor({ minLat: 10.70, maxLat: 10.77, minLng: 106.90, maxLng: 106.965 });
    expect(t.length).toBeGreaterThanOrEqual(9);
    expect(t.length).toBeLessThanOrEqual(25);
    const { x, y } = t[0];
    const nw = tilePointToLatLng(x, y, 14, 0, 0, 4096);
    const se = tilePointToLatLng(x, y, 14, 4096, 4096, 4096);
    expect(se.lng - nw.lng).toBeCloseTo(360 / 2 ** 14, 6);
    expect(nw.lat).toBeGreaterThan(se.lat);
    expect(nw.lng).toBeLessThanOrEqual(106.90);
  });
  it('danh sách bản phát hành: mới trước', () => {
    expect(parseReleases('<Prefix>release/</Prefix><Prefix>release/2026-09-23.1/</Prefix><Prefix>release/2026-10-21.0/</Prefix><Prefix>release/2026-09-23.0/</Prefix>'))
      .toEqual(['2026-10-21.0', '2026-09-23.1', '2026-09-23.0']);
  });
  it('phân loại: nhà máy theo tên dù danh mục sai, bỏ quán xá / công đoàn / nhà thờ / chính KCN', () => {
    const at = (o: Record<string, unknown>) => overtureToScan(props(o), C.lat, C.lng, area);
    expect(at({ '@name': 'Công Ty Cổ Phần Thiết Bị Vệ Sinh Caesar Việt Nam', taxonomy: tax('party_and_event_planning') })).toMatchObject({ kind: 'company', category: 'Doanh nghiệp', phone: '+842513560128', facebook: 'https://www.facebook.com/123' });
    expect(at({ '@name': 'Chung Long Plastic Ind. Co., Ltd', taxonomy: tax('plastic_manufacturer') })).toMatchObject({ kind: 'company', category: 'Nhựa' });
    expect(at({ '@name': 'Posco VST', taxonomy: tax('metal_fabricator') })).toMatchObject({ kind: 'company' });
    expect(at({ '@name': 'Cafe Sân Vườn', taxonomy: tax('coffee_shop') })).toBeNull();
    expect(at({ '@name': 'Cửa Hàng Viettel Nhơn Trạch', taxonomy: tax('telecommunications_company') })).toBeNull();
    expect(at({ '@name': 'Công Đoàn Cơ Sở Hwaseung Vina', taxonomy: tax('labor_union') })).toBeNull();
    expect(at({ '@name': 'Nhà thờ Liên Kim Sơn', taxonomy: tax('labor_union') })).toBeNull();
    expect(at({ '@name': 'Khu công nghiệp Nhơn Trạch 3', taxonomy: tax('commercial_industrial') })).toBeNull();
    expect(at({ '@name': 'Công ty ABC', taxonomy: tax('manufacturer'), operating_status: 'permanently_closed' })).toBeNull();
    expect(at({ '@name': 'Công ty rác', taxonomy: tax('manufacturer'), confidence: 0.05, phones: '[]', socials: '[]' })).toBeNull();
  });
  it('nhà cung ứng vs trang tuyển dụng của nhà máy', () => {
    const at = (o: Record<string, unknown>, lat = C.lat, lng = C.lng) => overtureToScan(props(o), lat, lng, area);
    expect(at({ '@name': 'Công Ty TNHH DV Lao Động Thống Nhất', taxonomy: tax('employment_agency') })).toMatchObject({ kind: 'supplier', category: 'Dịch vụ việc làm' });
    expect(at({ '@name': 'Việc Làm Nhơn Trạch', taxonomy: tax('professional_service') })).toMatchObject({ kind: 'supplier' });
    expect(at({ '@name': 'Hwaseung Vina TUYỂN DỤNG', taxonomy: tax('industrial_company') })).toMatchObject({ kind: 'company', hiring: true, category: 'Trang tuyển dụng của công ty' });
    // nhà cung ứng xa hơn 6 km → bỏ; công ty ngoài KCN (> 1,5 km) → bỏ
    expect(at({ '@name': 'Cung ứng nhân lực Xa Lắm', taxonomy: tax('employment_agency') }, C.lat + 0.1)).toBeNull();
    expect(at({ '@name': 'Công ty TNHH Ngoài KCN', taxonomy: tax('manufacturer') }, C.lat + 0.03)).toBeNull();
    expect(looksLikeHiringPage('Sika Việt Nam Tuyển Dụng')).toBe(true);
    expect(looksLikeHiringPage('Tuyển dụng - Việc làm nhanh tại Nhơn Trạch')).toBe(false);
  });
  it('trang "… Tuyển dụng" gộp vào nhà máy, giữ tên nhà máy + dấu đang tuyển', () => {
    expect(stripHiring('Hyosung - HS Hyosung Tuyển Dụng')).toBe('Hyosung - HS Hyosung');
    const base = { sources: ['overture' as const], kind: 'company' as const, lat: C.lat, lng: C.lng, address: '', category: '', mapsUrl: '', phone: '', website: '', keywords: [] };
    const m = mergeScan([[{ ...base, key: 'v:1', name: 'Sika Việt Nam Tuyển Dụng', hiring: true, phone: '+84 1' }, { ...base, key: 'v:2', name: 'Sika Việt Nam', lat: C.lat + 0.001 }]]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ name: 'Sika Việt Nam', hiring: true, phone: '+84 1' });
  });
});
