# Văn phòng Orient (`office_rental`)

Module quản lý mảng **cho thuê lại văn phòng** tại Orient Apartment (331 Bến Vân Đồn, Q.4). Dùng chung đăng nhập và giao diện với Let's Go VN nhưng **dữ liệu tách hẳn** khỏi mảng cung ứng lao động: chỉ đọc/ghi các bảng `bds_*` và không có khoá ngoại sang bảng nào khác. **Chỉ tài khoản admin** được vào.

## Cài đặt (1 lần)

1. Supabase → **SQL Editor** → dán toàn bộ `supabase/migrations/20261018100000_164_bds_office_rental_core.sql` → **Run**.
2. Dán tiếp `supabase/migrations/20261018110000_165_bds_office_rental_ops.sql` → **Run**, rồi `supabase/migrations/20261019100000_166_bds_notifications.sql` → **Run**.
3. (Tuỳ chọn) dán `docs/orient-office/rls-check.sql` → Run → cột **Đạt** phải là ✓ ở mọi dòng.
4. Vào app → **Văn phòng Orient → Cài đặt & Dữ liệu → Import JSON tracker** → chọn `orient_pl_2026-08.json` → xem trước → **Xác nhận nhập**.
5. **Lời/Lỗ → Doanh thu khách hàng**: gán từng khách vào mặt bằng, rồi kiểm tra tab **Theo mặt bằng** hiện dòng đối chiếu ✓.

Cả hai migration đều chạy lại được nhiều lần mà không lỗi.

## Kiến trúc

```
src/modules/office-rental/
  pages.ts                 danh sách trang + icon (App/Sidebar import trực tiếp — rất nhỏ)
  index.tsx                điểm vào lazy (React.lazy trong App.tsx)
  lib/calc/                calc engine thuần TS: VAT, giá theo mốc tăng, P&L, theo mặt bằng, hòa vốn, CSV, tiền
  lib/import/              đọc JSON tracker v3/v4 + lập kế hoạch nhập (dry-run)
  lib/ops.ts               logic vận hành thuần: hợp đồng, hoá đơn, phòng, cảnh báo
  lib/export.ts            xuất JSON v4 (nạp lại được)
  data/api.ts              truy cập Supabase, gắn header x-letsgo-token
  data/OfficeDataProvider  nạp mọi bảng bds_*, tự lưu theo ô (debounce 400ms, Thử lại khi lỗi)
  data/importTracker.ts    ghi file tracker vào DB (khớp theo tên)
  components/              giao diện (finance/*, ops/*, Settings, OfficeShell)
```

**Bảo mật 3 lớp**: (1) menu chỉ hiện với admin (`canAccess` trong `src/lib/auth.tsx`); (2) mở thẳng URL `#/office…` khi không phải admin → về Dashboard + thông báo, và bundle module không được tải; (3) **RLS** trên mọi bảng `bds_*`: app không dùng Supabase Auth nên module gửi session token trong header `x-letsgo-token`, hàm `bds_is_admin()` kiểm tra `session_role(token) = 'admin'`.

**Trang**: `office` (Tổng quan — việc cần xử lý, lịch 90 ngày, nhận định nhanh), `office-dashboard` (KPI + 6 biểu đồ + dự báo), `office-reports` (5 báo cáo in/CSV), `office-pl` (7 tab Lời/Lỗ), `office-rooms`, `office-billing`, `office-parking`, `office-tickets`, `office-assets`, `office-settings`. Tab con nằm ở hash: `#/office-pl/hoa-von`.

## Thông báo & phần "thông minh"

- **Chuông thông báo** ở đầu mọi màn: Cần xử lý / Sắp tới / Đã ẩn. Mỗi mục có Mở · Nhắc lại sau · Đã xử lý (lưu `bds_notification_states`).
- Nguồn sự kiện (`lib/events.ts`): HĐ khách sắp hết hạn (3/2/1 tháng, đã quá hạn), khách mới sắp vào, mặt bằng tăng giá (kèm số tiền tăng/tháng), trả mặt bằng, hoá đơn quá hạn / sắp đến hạn, tháng trước chưa lập thông báo / chưa nhập doanh thu / chưa nhập vận hành, kỳ chốt điện, khoản chi dự kiến 2 tháng tới, phòng trống (thất thu theo giá chào), khách chưa gán mặt bằng, sự cố đang mở, thiết bị hỏng.
- **Dự báo** (`lib/forecast.ts`) và **nhận định** (`lib/insights.ts`) dùng chung calc engine — xem giả định trong `DECISIONS.md` mục 26–27.

## Bảng dữ liệu

| Bảng | Nội dung |
|---|---|
| `bds_settings` | 1 dòng: tỷ giá, VAT thuê / VAT điện-xe, đơn giá xe, khoảng tháng, công tắc; + đơn giá điện, hạn TT, thông tin chuyển khoản, ngưỡng cảnh báo (165) |
| `bds_head_leases` + `bds_head_lease_increases` | Chi phí thuê đầu vào MBT/TS4, mốc tăng giá %, cờ `is_parking`, `end_month` (trả mặt bằng) |
| `bds_tenants` | Khách thuê lại: tiền tệ, VAT, mặt bằng đang thuê; + phòng, hợp đồng, cọc, liên hệ (165) |
| `bds_tenant_rent` / `bds_tenant_fees` | Tiền thuê / điện + số xe theo (khách, tháng) |
| `bds_opex_categories` / `bds_opex_monthly` | Chi phí vận hành |
| `bds_forecast_expenses` | Dự đoán phát sinh |
| `bds_breakeven_scenarios` / `bds_breakeven_rooms` | Kịch bản hòa vốn (không ảnh hưởng P&L) |
| `bds_rooms`, `bds_meter_readings`, `bds_invoices`, `bds_assets`, `bds_tickets`, `bds_maintenance_logs` | Vận hành (165) |
| `bds_notification_states` | Thông báo đã xử lý / nhắc lại sau (166) |

Hoá đơn **không lưu số tiền**: luôn tính lại từ tiền thuê + phụ phí. Nút **Áp dụng** ở Chốt chỉ số điện là cầu nối duy nhất từ chỉ số điện sang P&L. Bãi xe là màn dẫn xuất từ `bds_tenant_fees`.

## Công thức (tóm tắt)

- `gross = excl ? raw × (1 + r) : raw` (dùng tính lời/lỗ); `r` = VAT thuê (mặc định 10%) hoặc VAT điện/xe (mặc định 8%) theo loại khoản.
- `priceAt(lease, m)` = 0 nếu `m < base_month` hoặc `m ≥ end_month`; ngược lại `base_price × Π(1 + %/100)` các mốc `≤ m`.
- Doanh thu khách = `gross_rent` (quy VNĐ) + `gross_util(điện + xe máy × giá + ô tô × giá)`.
- `cost = MBT + TS4 + vận hành + (bật cộng dự kiến ? dự kiến : 0)`; `profit = revenue − cost`.
- Theo mặt bằng: mỗi head lease = thuê + điện của khách gán vào; Bãi xe = phí xe của **mọi** khách − chi phí bãi; Chưa gán = cost 0. **Đối chiếu**: `Σ bucket − vận hành − (bật ? dự kiến : 0) = lợi nhuận Tổng quan`.
- Hòa vốn: `floor_i = (mục tiêu + chi phí chung) × m²_i / Σ m²`.

## Kiểm thử

- `npx vitest run src/modules/office-rental` — 51 test, gồm toàn bộ số liệu kiểm chứng mục 7 của đặc tả + engine sự kiện, dự báo, nhận định.
- SQL migration + RLS đã chạy thử trên PGlite (Postgres 16 dạng WASM) với stub `app_sessions`/`session_role` giống production.
- Giao diện đã bấm thử end-to-end trên máy với API giả lập (PGlite + RLS thật): import JSON, nhập doanh thu USD, theo mặt bằng ✓, hòa vốn, tạo phòng, đã thu + in hoá đơn, ticket, CSV có dòng lỗi, bãi xe, tài khoản nhân viên bị chặn, khổ 375px.

## Mở rộng

- **Cấp quyền hẹp** (vd kỹ thuật chỉ cập nhật ticket): bỏ chốt `role === 'admin'` trong `canAccess`, thêm `'Văn phòng Orient'` vào `MODULES` của AdminPage, và thay `bds_is_admin()` bằng hàm đọc `role_permissions` theo `session_role(token)` (có thể tách policy theo bảng).
- **Thêm tab**: thêm component vào `components/finance` hoặc `components/ops`, đăng ký trong `OfficeShell.tsx`; nếu là nhóm mới thì thêm vào `pages.ts` + kiểu `Page` trong `src/lib/types.ts`.
- **Bảng mới**: migration mới tiền tố `bds_`, thêm tên vào vòng lặp RLS, khai báo kiểu ở `lib/types.ts` + `CORE_TABLES`/`OPS_TABLES`.

Xem thêm: `DECISIONS.md` (các quyết định tự đưa ra), `PROMPT.md` (đặc tả gốc), `reference/` (tracker, JSON, demo).
