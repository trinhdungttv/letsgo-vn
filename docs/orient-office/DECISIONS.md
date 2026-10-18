# Văn phòng Orient (`office_rental`) — Khảo sát & Quyết định

## Phase 0 — Khảo sát repo (18/10/2026)

| Hạng mục | Thực tế trong repo |
|---|---|
| Stack | Vite 5 + React 18 + TS strict + Tailwind 3. Không có react-router: `App.tsx` giữ `page` (kiểu `Page`) và đồng bộ hash `#/<page>/<sub>`. |
| Layout | `Sidebar.tsx` (desktop, nhóm NAV / CRM MODULE / ADMIN) + `MobileNav.tsx` (điện thoại, registry `MOBILE_MENU`). Vùng cuộn chuẩn `flex-1 overflow-y-auto p-3 md:p-5`. |
| Đăng nhập | **Không dùng Supabase Auth.** RPC `verify_login` cấp session token (bảng `app_sessions`, hạn 7 ngày); client lưu `letsgo_user` + `letsgo_token` trong localStorage. Mọi request REST đi bằng role `anon`. |
| Phân quyền | Bảng `role_permissions(role, module, level)` + `PAGE_MODULE` / `canAccess()` trong `src/lib/auth.tsx`. Hàm SQL `session_role(token)` / `require_admin(token)` (migration 061) — chỉ gọi được từ hàm SECURITY DEFINER. |
| Supabase client | `src/lib/supabase.ts` (anon key). Data layer: hook tự viết (`useLoanData`, `useAppData`…), không có react-query. |
| Migrations | `supabase/migrations/<timestamp>_<số>_<tên>.sql`, số cuối 163. Tony chạy tay bằng SQL Editor. |
| UI | Tailwind thuần, icon `lucide-react`, chart **chart.js + react-chartjs-2** (không có recharts). `MoneyInput` có sẵn trong costplan nhưng chỉ VND → viết riêng trong module (hỗ trợ USD). |
| Lệnh kiểm tra | `npm run typecheck`, `npx vitest run`, `npx eslint <path>`, `npm run build`. Baseline trên main: **typecheck có sẵn 15 lỗi cũ** (AdminSettings, Branches, BranchFinance, market/*) và **lint toàn repo 309 lỗi cũ** → chỉ yêu cầu module không thêm lỗi nào; 567 test xanh. |

### File tham chiếu
- `reference/orient_pl_tracker.html` = bản **`orient_pl_tracker_1.html`** (state v3, 03/08, có Dự đoán phát sinh + phụ phí điện/xe). Bản `orient_pl_tracker.html` cũ hơn (v1) nên không dùng.
- Tracker v3 **chưa có** "Theo mặt bằng", "Hòa vốn", "Import CSV" và chỉ có 1 thuế suất VAT → các phần này port theo đặc tả mục 5 của PROMPT.
- `orient_pl_2026-08.json`: 4 head lease, **1 khách (XHOME, USD)**, doanh thu trống, opex T1–T7/2026, 2 khoản dự kiến, tỷ giá 25,870.

## Quyết định

1. **RLS admin-only bằng header token** — App không có `auth.uid()`, mọi request là `anon`. Client riêng của module gửi header `x-letsgo-token`; hàm `bds_is_admin()` (SECURITY DEFINER) đọc `request.headers` → `session_role(token) = 'admin'`. Policy `FOR ALL TO anon, authenticated USING/WITH CHECK ((SELECT bds_is_admin()))` — áp cho role `anon` vì đó là role duy nhất của app, nhưng không có token admin hợp lệ thì 0 dòng / bị từ chối ghi. Đã kiểm tra CORS Supabase chấp nhận header tuỳ biến (preflight OPTIONS).
2. **Client Supabase riêng cho module** (`lib/db.ts`) với `fetch` gắn token, `persistSession:false` + `storageKey` riêng → không đụng client chung, không cảnh báo "Multiple GoTrueClient".
3. **RPC `bds_access_check()`** để UI phân biệt: chưa chạy migration / phiên hết hạn / không phải admin.
4. **Quyền**: thêm module `'Văn phòng Orient'` vào `PAGE_MODULE` + dòng `role_permissions('admin', …, 'full')` trong migration (giống cách module Khoan vay làm). `canAccess()` thêm chốt cứng `role === 'admin'` cho trang `office*`. **Không** đưa vào ma trận phân quyền UI (AdminPage) → không ai cấp nhầm. *Chỗ gắn quyền hẹp sau này*: bỏ chốt cứng, thêm module vào `MODULES`, và đổi `bds_is_admin()` thành `bds_has_access('<module>')` đọc `role_permissions`.
5. **Điều hướng**: mỗi nhóm màn là một `Page` (`office`, `office-pl`, `office-rooms`, `office-billing`, `office-parking`, `office-tickets`, `office-assets`, `office-settings`), tab con theo hash `#/office-pl/<tab>`. Sidebar có nhóm "VĂN PHÒNG ORIENT" ngay dưới CRM MODULE. Tất cả cùng render một component lazy (`React.lazy`) nên dữ liệu không tải lại khi chuyển nhóm và nhân viên sales không tải bundle này.
6. **Data layer**: 1 provider nạp toàn bộ bảng `bds_*` (dữ liệu nhỏ: vài khách × 36 tháng), calc engine chạy trên bộ nhớ. Ô lưới: upsert debounce 400ms, trạng thái Đang lưu/Đã lưu/Lỗi + Thử lại; ô trống → xoá dòng.
7. **Chart**: dùng chart.js (thư viện app đang dùng), không thêm recharts.
8. **Tháng** lưu `date` ngày 1; trong engine dùng khoá `'YYYY-MM'`.
9. **Đối chiếu theo mặt bằng**: `Σ bucket − opex − (cộng dự kiến ? forecast : 0) = lợi nhuận Dashboard` (sửa lỗi tracker quên trừ forecast).
10. **Bãi xe** nhận diện khi import: tên chứa "xe" hoặc id `u_xe` → `is_parking=true`, `vat_category='util'`. Các head lease khác `vat_category='rent'`.
11. **Import JSON — Cài đặt**: mặc định **không** ghi đè cài đặt (giữ seed của đặc tả: tỷ giá 26,000, VAT 10%/8%, xe máy 150k, ô tô 1.5tr). Có ô tick "Nhập cả cài đặt từ file" (khi đó `vatRate` v3 → áp cho cả VAT thuê lẫn VAT điện/xe để giữ đúng cách tính cũ). Lý do: file có tỷ giá 25,870 và đơn giá ô tô 150,000 (giá mặc định chưa sửa của tracker).
12. **Import JSON — số 0**: ô bằng 0 trong file bị bỏ qua (không tạo dòng, không xoá dòng đang có).
13. **Acceptance mục 7**: file JSON hiện có không chứa doanh thu/8 khách như mô tả (opex T1 = 25,000,000 chứ không phải 22,388,995). Test dùng fixture dựng lại đúng các con số tổng (mbt/ts4 lấy thẳng từ file thật; doanh thu/opex dựng để khớp 651,469,711 / 22,388,995) — kiểm chứng được công thức, không phụ thuộc file.
14. **Xuất JSON** theo định dạng tracker **v4** (v3 + `vatRateRent/vatRateUtil`, `isParking`, `vatCategory`, `unitId` của khách, kịch bản hòa vốn, khối `ops` thô) → chính màn Import nạp lại được phần tài chính. Khối `ops` chỉ để lưu trữ, chưa có khôi phục tự động.
15. **Phase 7**: trạng thái phòng hiển thị = "Đã thuê" nếu có khách đang gán, ngược lại theo cột `status` (trống / giữ chỗ). Hoá đơn "Quá hạn" = chưa thu và `due_date < hôm nay` (không lưu riêng). Số tiền hoá đơn luôn tính từ rent + fees.
16. **Ticket**: 5 bước cố định, lưu `step_done` (0–5) + nhật ký `bds_maintenance_logs`. Chi phí ticket **không** tự cộng vào P&L (tránh đếm trùng với "Chi phí vận hành"); có ghi chú hướng dẫn nhập tay.
17. **Git**: làm trên nhánh `feat/office-rental`, commit từng phase, **không push** (Tony push bằng GitHub Desktop).
