# PROMPT CHO CLAUDE CODE — Xây module "Quản lý Văn phòng Orient" vào webapp Let's Go VN

> Dán toàn bộ nội dung bên dưới vào Claude Code (chạy ở thư mục gốc của repo Let's Go VN).
> Trước khi chạy: copy 3 file tham chiếu vào `docs/orient-office/reference/` (xem mục 2).

---

## 0. VAI TRÒ & CÁCH LÀM VIỆC

Bạn là senior full-stack engineer (React + TypeScript + Supabase). Hãy xây TRỌN VẸN module mới **"Văn phòng Orient"** (`office_rental`) vào webapp đã có, **tự chạy từ đầu đến cuối không dừng giữa chừng**.

Quy tắc tự chủ:
- Không hỏi lại những thứ có thể tự quyết. Gặp điểm mơ hồ → chọn phương án hợp lý nhất, ghi 1 dòng vào `docs/orient-office/DECISIONS.md` (quyết định gì, vì sao), rồi làm tiếp.
- Chỉ được dừng để hỏi Tony khi: (a) thiếu file tham chiếu ở mục 2, (b) cần thao tác phá hủy/không thể hoàn tác trên dữ liệu thật, (c) thiếu quyền/credential bắt buộc mà không có cách vòng.
- Làm trên nhánh `feat/office-rental`. Commit sau mỗi phase (message rõ ràng). KHÔNG push thẳng lên `main`.
- Sau mỗi phase phải chạy `tsc --noEmit`, lint, test, build — xanh mới sang phase tiếp. Lỗi thì sửa tại chỗ.
- Tony là người KHÔNG phải lập trình viên: mọi hướng dẫn bàn giao phải là từng bước bấm/dán cụ thể, tiếng Việt.

## 1. BỐI CẢNH KINH DOANH

TTV HR Group đi thuê nguyên khu thương mại tại Orient Apartment (331 Bến Vân Đồn, Q.4, TP.HCM) rồi **cho thuê lại** từng văn phòng nhỏ. Admin duy nhất: Tony.

Đầu vào (chi phí thuê gốc — gọi là "head lease"):
- **Minh Bảo Tín (MBT)**: Mặt bằng 1.05 (Trệt) + Mặt bằng 2.01 (Tầng 1) — 2 hóa đơn trả chung.
- **Thủy Sản 4 (TS4)**: Mặt tiền phía trước + Bãi giữ xe (hầm).
- Mỗi khoản có giá gốc, tháng áp dụng, VAT, và các **mốc tăng giá cộng dồn theo %** (vd từ 03/2027 tăng 10% → giá × 1.10; nhiều mốc thì nhân liên tiếp).

Đầu ra: cho khách thuê lại (tenant), thu thêm **điện** (nhập số tiền mỗi tháng) và **phí gửi xe máy / ô tô** (nhập số lượng × đơn giá). Bãi xe mua từ TS4 rồi bán lại cho khách → cần biết **riêng phần bãi xe lời/lỗ bao nhiêu**.

Mục tiêu của Tony:
1. Lời/lỗ theo tháng toàn hệ thống.
2. **Lời/lỗ riêng từng mặt bằng** (1.05, 2.01, TS4-Mặt tiền) và riêng **Bãi xe**.
3. Công cụ **hòa vốn khi chia nhỏ mặt bằng** (vd XHOME 778m² chia 200/286/229m²): gõ thử giá từng phòng → thấy dư/thiếu và **giá sàn tối thiểu** để deal.
4. Dự đoán chi phí phát sinh sắp tới (tùy chọn cộng vào tổng chi phí).
5. Nhập nhanh điện + số xe bằng file CSV (Tony sẽ nhờ AI trích từ đề nghị thanh toán của khách rồi import).
6. Về sau (phase vận hành): phòng, hợp đồng, hóa đơn, sự cố/bảo trì, tài sản.

## 2. TÀI LIỆU THAM CHIẾU (ĐỌC KỸ TRƯỚC KHI CODE)

Đặt trong `docs/orient-office/reference/`:
| File | Vai trò |
|---|---|
| `orient_pl_tracker.html` | **Nguồn chân lý về logic tài chính + UI các tab P&L** (VAT, mốc tăng giá, theo mặt bằng, hòa vốn, CSV, dự đoán). Đọc toàn bộ phần `<script>` và port logic chính xác. |
| `orient_pl_2026-08.json` | **Dữ liệu thật** (state v3 của tracker) dùng làm seed + dữ liệu kiểm thử. |
| `orient_office_demo.html` | Demo UI 8 màn hình (Dashboard, Rooms, Leases, Billing, Parking, Tickets, Assets, Settings) — tham chiếu bố cục/luồng cho **Phase 7 (vận hành)**. Số liệu trong demo chỉ là minh họa, KHÔNG dùng làm dữ liệu thật. |

Nếu thiếu file nào → dừng và báo Tony.
Lưu ý: tracker lưu state dạng 1 blob JSON trong localStorage; trong module này phải **chuẩn hóa thành bảng Postgres** (mục 6) và đọc/ghi qua Supabase.

## 3. NGUYÊN TẮC BẤT DI BẤT DỊCH

1. **Module riêng biệt, gộp app – tách data**: dùng chung auth/session, UI kit, Supabase client; nhưng **mọi bảng có tiền tố `bds_`**, **không có foreign key nào tới bảng của module bán hàng/lao động**. (Quyết định đã chốt: dùng prefix `bds_`, KHÔNG tạo schema Postgres riêng vì PostgREST phải cấu hình expose schema.)
2. **Chỉ admin được truy cập** — 3 lớp: (a) ẩn menu, (b) route guard, (c) **RLS trên mọi bảng `bds_*`**. Tuyệt đối không có policy cho anon hoặc role khác.
3. **Migration chỉ thêm mới, idempotent** (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` trước khi tạo). KHÔNG `ALTER`/`DROP` bất kỳ bảng/policy/function hiện có. **KHÔNG tự apply migration lên Supabase production** (project `bawtzxcnzcpzqsgmdcma` chứa dữ liệu thật) — chỉ tạo file + hướng dẫn Tony chạy (mục 8). Nếu có môi trường local/branch DB thì được apply ở đó để test.
4. **Code tách module & lazy-load**: `src/modules/office-rental/`, route load bằng `React.lazy` để nhân viên sales không tải bundle BĐS.
5. **Tiền tệ**: lưu `numeric(18,2)`; VND nhập số nguyên, USD tối đa 2 số thập phân. Tính bằng số, **chỉ làm tròn ở lớp hiển thị**. Mọi ô nhập tiền dùng component `MoneyInput`: gõ `5997000` → hiện `5,997,000` tức thì; **không** dùng đơn vị "triệu" khi nhập. Đã có 2 loại tiền VND/USD, quy đổi bằng tỷ giá trong settings.
6. **UI tiếng Việt**, dùng đúng UI kit/Tailwind/design tokens của app hiện có (khảo sát ở Phase 0). Responsive, dùng được trên điện thoại.
7. Không thêm dependency nặng. Chart dùng thư viện app đang dùng; nếu chưa có thì thêm `recharts`. Test dùng `vitest` (thêm nếu chưa có, chỉ devDependency).
8. Không đụng/refactor code ngoài phạm vi module, ngoại trừ các điểm tích hợp bắt buộc (đăng ký route, menu, permission key).

## 4. CÁC PHASE (làm tuần tự)

### Phase 0 — Khảo sát (không sửa code)
Đọc repo và ghi kết quả vào `docs/orient-office/DECISIONS.md`:
- Cấu trúc thư mục, router, layout/sidebar, cách app đăng ký module + **hệ thống phân quyền hiện có** (module permissions / roles — tìm cách kiểm tra "admin" ở cả frontend và trong RLS hiện tại, vd function `is_admin()`/bảng `profiles`).
- Supabase client, thư mục migrations (`supabase/migrations`?), quy ước đặt tên, cách gọi data (react-query? hook tự viết?).
- UI kit, chart lib, form/table components, tiện ích format tiền hiện có (tái sử dụng nếu có).
- Cách chạy test/lint/build.
- Đọc 3 file reference, liệt kê mọi công thức + màn hình cần port.

### Phase 1 — Database (file migration, chưa apply production)
Tạo `supabase/migrations/<timestamp>_bds_office_rental_core.sql` theo mục 6: bảng, constraint, index, trigger `updated_at`, RLS + policy admin-only, và **seed settings singleton**. Nếu app chưa có hàm kiểm tra admin dùng được trong RLS → tạo `bds_is_admin()` (`SECURITY DEFINER`, `SET search_path = public`) đọc từ nguồn role hiện có; không sửa thứ hiện có.
Viết thêm `docs/orient-office/rls-check.sql`: các câu lệnh Tony/dev chạy để xác nhận user không phải admin KHÔNG đọc được `bds_*`.

### Phase 2 — Calc engine thuần (pure TypeScript, có test)
`src/modules/office-rental/lib/calc/` — không phụ thuộc React/Supabase. Port chính xác từ tracker (mục 5) + unit test bằng số liệu ở mục 7. Mọi hàm nhận dữ liệu qua tham số.

### Phase 3 — Types + data layer
Type sinh theo schema, service/hook CRUD cho từng bảng; lưới nhập theo ô dùng **upsert + debounce ~400ms**, hiển thị trạng thái "Đang lưu / Đã lưu / Lỗi" (không mất dữ liệu khi lỗi mạng: giữ giá trị trong ô và cho thử lại). Ô trống → xóa dòng tương ứng.

### Phase 4 — UI Tài chính (8 màn, bám tracker)
Nhóm trong menu "Văn phòng Orient" với các tab:
1. **Tổng quan Lời/Lỗ**: chọn tháng xem KPI (5 thẻ: Doanh thu, Thuê MBT+TS4, Chi phí vận hành, Lợi nhuận+biên, Dự kiến phát sinh); biểu đồ cột lợi nhuận (xanh lời/đỏ lỗ) + đường doanh thu & tổng chi phí; ghi chú mốc tăng giá; bảng chi tiết nhiều tháng (đơn vị triệu VNĐ, có dòng TỔNG và lũy kế); công tắc "Chỉ hiện tháng đã nhập doanh thu"; trạng thái tháng Thực tế / Dự kiến / Thiếu DT.
2. **Theo mặt bằng**: thẻ cho 1.05, 2.01, TS4-Mặt tiền, **Bãi giữ xe**, "Chưa gán mặt bằng" (kèm cảnh báo + danh sách khách chưa gán); bảng nhiều tháng; dòng đối chiếu (mục 5.5).
3. **Hòa vốn tách phòng**: lưu được nhiều kịch bản (bảng `bds_breakeven_*`); chọn mặt bằng gốc + tháng tham khảo → tự điền chi phí mục tiêu (cho sửa tay) + chi phí chung phân bổ thêm; danh sách phòng (tên, m², VNĐ/USD, giá đề xuất, VAT) → giá/m², doanh thu gộp, dư/thiếu, **giá sàn mỗi phòng**. Kịch bản mặc định "XHOME 778m²" gồm 3 phòng 200/286/229 m². Hiện cảnh báo mềm nếu có nhập diện tích mặt bằng gốc và tổng m² các phòng ≠ diện tích gốc (vd 715 vs 778). Công cụ thử số, KHÔNG ảnh hưởng P&L thực.
4. **Chi phí thuê (đầu vào)**: CRUD head lease nhóm MBT/TS4, giá gốc, tháng áp dụng, VAT mode, loại thuế, tiền tệ, mốc tăng giá (thêm/sửa/xóa), dòng "Giá tháng này (trước VAT / VAT)".
5. **Doanh thu khách hàng**: bảng cấu hình khách (tiền tệ, **mặt bằng đang thuê**, VAT mode) + lưới tiền thuê theo tháng + **khối Phụ phí Điện & Bãi xe — ẩn mặc định, bấm tiêu đề để hiện** (trạng thái mở/đóng ghi nhớ): đơn giá xe máy/ô tô, lưới (Điện đ | SL xe máy | SL ô tô) theo khách × tháng, tổng phụ phí; nút **Tải mẫu CSV** và **Nhập CSV** (mục 5.7).
6. **Chi phí vận hành**: hạng mục (VAT mode + loại thuế) + lưới theo tháng.
7. **Dự đoán phát sinh**: thêm/xóa khoản (tên, tháng, số tiền, ghi chú), đánh dấu "Đã qua", tổng; công tắc trong Cài đặt cho phép cộng vào Tổng chi phí hay chỉ tham khảo.
8. **Cài đặt**: tỷ giá USD→VNĐ, VAT thuê mặt bằng (%), VAT Điện & Bãi xe (%), số tháng theo dõi (12/18/24/36 từ T1/2026), công tắc forecast, nhập/xuất dữ liệu (Phase 5).

### Phase 5 — Import / Export
- **Import JSON từ tracker** (`orient_pl_*.json`, version 3 hoặc 4): màn hình có bước **xem trước (dry-run)** hiển thị số bản ghi sẽ tạo/cập nhật; upsert theo tên (khách, hạng mục, head lease) nên chạy lại nhiều lần không nhân đôi; mặc định KHÔNG xóa dữ liệu hiện có (tùy chọn "thay thế toàn bộ" phải có xác nhận 2 bước). Map: `payables→bds_head_leases(+increases)`, `customers→bds_tenants`, `revenue→bds_tenant_rent`, `custFees→bds_tenant_fees`, `opexCats/opex→bds_opex_*`, `forecastExpenses→bds_forecast_expenses`, settings (vatRate cũ nếu có → tách rent/util).
- **Import CSV phí điện/xe** (mục 5.7) + tải file mẫu.
- **Export**: JSON toàn bộ dữ liệu `bds_*` (sao lưu) và CSV báo cáo P&L theo tháng (BOM UTF-8 để Excel đọc tiếng Việt).
- Script/trang seed: sau khi Tony chạy migration, dùng chính màn Import JSON để nạp `orient_pl_2026-08.json` (không cần script riêng cho dev).

### Phase 6 — Phân quyền, route, menu
- Đăng ký permission key `office_rental` vào hệ thống phân quyền hiện có; chỉ role admin được cấp mặc định.
- Menu "Văn phòng Orient" chỉ hiện khi có quyền; route guard chặn truy cập trực tiếp bằng URL (redirect về trang chính + toast); toàn bộ route module lazy-load.
- Kiến trúc để sau này có thể cấp quyền hẹp (vd nhân viên kỹ thuật chỉ cập nhật ticket) bằng hệ thống permission hiện có — chỉ thiết kế chỗ gắn, chưa làm.

### Phase 7 — Vận hành (bám `orient_office_demo.html`, dữ liệu thật từ DB)
Làm sau khi Phase 1–6 xanh và đã commit. Bổ sung migration thứ 2 `<timestamp>_bds_office_rental_ops.sql`:
- **Phòng** (`bds_rooms`: mã, tên, m², head_lease_id, trạng thái trống/đã thuê/giữ chỗ; `bds_tenants.room_id` tùy chọn).
- **Hợp đồng khách thuê**: ngày bắt đầu/kết thúc, đặt cọc (cột trên `bds_tenants` hoặc bảng riêng); **cảnh báo HĐ sắp hết hạn 30/60 ngày**, phòng trống (kèm "tiềm năng thu" nếu có giá tham khảo).
- **Hóa đơn/đề nghị thanh toán** theo khách × tháng: tiền thuê + điện + xe, tách VAT, trạng thái chưa thu/đã thu/quá hạn (`bds_invoices` chỉ lưu `status, due_date, paid_at, paid_amount` — **số tiền luôn tính từ rent + fees**, không lưu bản sao để tránh lệch); xem trước + in (CSS print), không cần thư viện PDF.
- **Chỉ số điện** (`bds_meter_readings`: tenant, tháng, chỉ số cũ/mới, đơn giá) → nút "Áp dụng vào phí điện tháng" ghi vào `bds_tenant_fees.electricity_amount` (đây là cầu nối duy nhất tới P&L).
- **Bãi xe (màn tổng hợp)**: *view dẫn xuất* từ `bds_tenant_fees` — số xe máy/ô tô, doanh thu, chi phí trả TS4, lời/lỗ; không tạo bảng dữ liệu trùng.
- **Sự cố/bảo trì (tickets)**: quy trình 5 bước như demo (kiểm tra 15–30 phút → gán chi phí → duyệt chi → sửa chữa → đóng ticket kèm **link Google Drive**), lịch sử `bds_maintenance_logs`.
- **Tài sản** (`bds_assets`) gắn phòng/khu vực.
- **Thanh cảnh báo** ở tổng quan: HĐ sắp hết hạn, hóa đơn quá hạn, phòng trống, khách chưa gán mặt bằng.
- Mọi bảng mới cũng `bds_` + RLS admin-only + không FK sang module khác.

### Phase 8 — QA & bàn giao
Checklist: `tsc`, lint, test, `build` đều xanh; không còn `console.error`; kiểm tra thủ công (nếu chạy được dev server) từng tab với dữ liệu seed; đối chiếu số liệu mục 7 khớp từng đồng; xác nhận bundle module nằm trong chunk riêng; xác nhận user không phải admin không thấy menu và không vào được URL. Viết `docs/orient-office/README.md` (kiến trúc, bảng, công thức, cách mở rộng) và báo cáo bàn giao (mục 8).

## 5. ĐẶC TẢ NGHIỆP VỤ & CÔNG THỨC (port chính xác)

**5.1 VAT.** Mỗi khoản có `vat_mode ∈ {none, incl, excl}` và `vat_category ∈ {rent, util}`. Thuế suất: `rent` = `vat_rate_rent` (mặc định 10%), `util` = `vat_rate_util` (mặc định 8%).
- `gross(raw)` = `excl ? raw × (1+rate) : raw` → **đây là số tiền thực trả/thu, dùng để tính lời/lỗ**.
- `net(raw)` = `incl ? raw/(1+rate) : raw`; `vatAmount(raw)` = `none→0; excl→raw×rate; incl→raw − raw/(1+rate)` (chỉ để hiển thị).
- Chế độ `none` và `incl` đều giữ nguyên số nhập khi tính lời/lỗ.

**5.2 Giá head lease theo tháng.** `priceAt(lease, month)`: nếu `month < base_month` → 0; ngược lại bắt đầu từ `base_price`, duyệt các mốc tăng sắp xếp theo `effective_month`, mỗi mốc có `effective_month <= month` thì `price *= (1 + percent/100)` (cộng dồn/nhân liên tiếp). Giá quy VNĐ: `USD × exchange_rate`.

**5.3 Tính tháng `compute(month)`.**
- `mbt` = Σ gross(priceAt) các head lease nhóm MBT; `ts4` tương tự (gồm cả bãi xe) — quy VNĐ.
- Doanh thu mỗi khách = `gross_rent(rent, tenant.vat_mode, category rent)` quy VNĐ theo tiền tệ khách **+** `gross_util(điện + xeMáy×đơnGiáXeMáy + ôTô×đơnGiáÔTô, tenant.vat_mode, category util)` (phụ phí luôn tính bằng VNĐ).
- `opex` = Σ gross(opex hạng mục, vat_mode, vat_category của hạng mục).
- `forecast` = Σ khoản dự kiến trong tháng.
- `cost = mbt + ts4 + opex + (include_forecast_in_cost ? forecast : 0)`; `profit = revenue − cost`; `margin = revenue>0 ? profit/revenue : 0`.
- Tháng "có doanh thu" = có ít nhất 1 khách `rent > 0`. Trạng thái: có DT → Thực tế; không có và tháng > tháng hiện tại → Dự kiến; còn lại → Thiếu DT.

**5.4 Lời/lỗ theo mặt bằng `unitPL(month)`.**
- Với mỗi head lease **không phải bãi xe**: `cost = gross(priceAt)`; `revenue` = Σ (tiền thuê + **điện**) của các khách gán vào head lease đó (có VAT như 5.3); `profit = revenue − cost`.
- **Bãi xe**: `cost` = gross(priceAt) của head lease `is_parking`; `revenue` = Σ phí xe (máy + ô tô, gross util) của **tất cả khách** (dùng chung, không gán theo mặt bằng).
- **Chưa gán**: khách `head_lease_id IS NULL` → gom doanh thu (thuê + điện) riêng, `cost = 0`, hiện cảnh báo để Tony gán.
- Chi phí vận hành là chi phí chung, **không phân bổ** cho mặt bằng nào.

**5.5 Dòng đối chiếu (LƯU Ý — tracker có lỗi nhỏ, hãy làm đúng).** `Σ lợi nhuận các bucket − opex − (include_forecast_in_cost ? forecast : 0) = lợi nhuận Dashboard`. Hiển thị ✓ nếu lệch < 1đ, ⚠️ nếu lệch. (Bản tracker quên trừ forecast nên sẽ báo ⚠️ sai khi bật cộng dự kiến.) Phải có unit test cho cả hai trạng thái công tắc.

**5.6 Hòa vốn tách phòng.** `target = target_cost + extra_cost`; `totalArea = Σ area các phòng`; `floor_i = target × area_i / totalArea` (tổng các `floor_i` = `target`); doanh thu phòng = quy VNĐ của gross(giá, vat_mode, category rent); `diff = Σ doanh thu − target` (dương = dư/lời, âm = thiếu/lỗ); giá/m² = giá ÷ m². Hiển thị floor kèm quy USD (÷ tỷ giá) khi phòng chọn USD. Chi phí mục tiêu mặc định tự lấy từ `gross(priceAt(head lease chọn, tháng tham khảo))` nhưng luôn cho sửa tay. Chia 0 phải được xử lý (totalArea = 0 → không hiển thị floor).

**5.7 CSV phí điện/xe.** Header đúng: `Thang,Khach_hang,Dien,Xe_may,O_to`. `Thang` dạng `YYYY-MM`; `Khach_hang` khớp **không phân biệt hoa thường** với `bds_tenants.name`; hỗ trợ dấu ngoặc kép/dấu phẩy trong tên, BOM UTF-8, nhiều tháng × nhiều khách trong 1 file. Tải mẫu: điền sẵn danh sách khách của tháng được chọn. Kết quả import: số dòng thành công + **danh sách dòng lỗi có số dòng và lý do** (sai định dạng tháng, không tìm thấy khách…). Upsert theo (tenant, month). Không nhận số âm.

**5.8 Định dạng.** `fmtVND` = số nguyên có dấu phẩy + `đ`; `fmtUSD` = `$` + tối đa 2 số lẻ; bảng tổng quan dùng đơn vị triệu (1 số lẻ) chỉ ở lớp hiển thị.

## 6. SCHEMA ĐỀ XUẤT (Phase 1; Claude Code viết SQL đầy đủ)

Mọi bảng: `id uuid pk default gen_random_uuid()` (trừ bảng khóa ghép/singleton), `created_at`, `updated_at` (trigger), RLS bật, policy `FOR ALL USING/WITH CHECK (bds_is_admin())`. Cột tháng: `date` ngày 1 (`CHECK (extract(day from month)=1)`). Check constraint cho các enum.

- `bds_settings` (singleton `id smallint pk default 1 check (id=1)`): `exchange_rate numeric(12,2) default 26000`, `vat_rate_rent numeric(5,2) default 10`, `vat_rate_util numeric(5,2) default 8`, `parking_price_moto numeric(18,2) default 150000`, `parking_price_car numeric(18,2) default 1500000`, `start_month date default '2026-01-01'`, `range_months int default 24`, `include_forecast_in_cost boolean default false`, `hide_empty_months boolean default true`, `show_fee_panel boolean default false`.
- `bds_head_leases`: `landlord text check in ('mbt','ts4')`, `name`, `currency check in ('VND','USD')`, `base_price numeric(18,2)`, `base_month date`, `vat_mode check in ('none','incl','excl')`, `vat_category check in ('rent','util')`, `is_parking boolean default false`, `sort_order int`, `active boolean default true`, `note`.
- `bds_head_lease_increases`: `head_lease_id fk → bds_head_leases on delete cascade`, `effective_month date`, `percent numeric(6,3)`.
- `bds_tenants`: `name text unique`, `currency`, `vat_mode`, `head_lease_id fk → bds_head_leases on delete set null`, `area_m2 numeric(10,2) null`, `active boolean default true`, `note`.
- `bds_tenant_rent`: pk `(tenant_id, month)`, `amount numeric(18,2)`; fk cascade.
- `bds_tenant_fees`: pk `(tenant_id, month)`, `electricity_amount numeric(18,2) default 0`, `motorbike_count int default 0`, `car_count int default 0` (check ≥ 0); fk cascade.
- `bds_opex_categories`: `name`, `vat_mode`, `vat_category default 'rent'`, `sort_order`, `active`.
- `bds_opex_monthly`: pk `(category_id, month)`, `amount numeric(18,2)`.
- `bds_forecast_expenses`: `name`, `month`, `amount numeric(18,2)`, `note`.
- `bds_breakeven_scenarios`: `name`, `head_lease_id fk null on delete set null`, `reference_month date`, `target_cost numeric(18,2)`, `extra_cost numeric(18,2) default 0`, `parent_area_m2 numeric(10,2) null`.
- `bds_breakeven_rooms`: `scenario_id fk cascade`, `name`, `area_m2 numeric(10,2)`, `currency`, `price numeric(18,2)`, `vat_mode`, `sort_order`.
- Index: theo `month` và theo khóa ngoại trên các bảng dữ liệu tháng.
- Phase 7 (migration riêng): `bds_rooms`, `bds_meter_readings`, `bds_invoices`, `bds_assets`, `bds_tickets`, `bds_maintenance_logs` (+ cột hợp đồng cho `bds_tenants`).

**Seed mặc định (trong app, qua màn Import):** dữ liệu từ `orient_pl_2026-08.json` — 4 head lease (1.05, 2.01, Mặt tiền = `rent`; Bãi giữ xe = `util`, `is_parking = true`), 8 khách, doanh thu/opex T1/2026→T2/2027, 2 khoản dự kiến mẫu. Khách chưa gán mặt bằng (Tony tự gán sau). Tỷ giá 26,000; VAT thuê 10%; VAT điện/xe 8%.

## 7. ACCEPTANCE TESTS (số liệu kiểm chứng — phải khớp từng đồng)

Với `orient_pl_2026-08.json` (đơn vị VNĐ, tỷ giá 26,000, mọi khoản đang `incl`, phí điện/xe trống):
- **T1/2026**: `mbt = 363,527,000`; `ts4 = 128,306,795`; `opex = 22,388,995`; `revenue = 651,469,711`; `cost = 514,222,790`; `profit = 137,246,921`.
- **Mốc tăng giá**: 1.05 tại 2027-03 = `57,971,000 × 1.10 = 63,768,100`; 2.01 tại 2027-01 = `305,556,000 × 1.05 = 320,833,800`; 2.01 tại 2026-12 vẫn `305,556,000`; trước `base_month` (2025-03) giá = 0.
- **VAT**: `gross(57,971,000, excl, rent) = 63,768,100`; `gross(27,000,000, excl, util) = 29,160,000`; `gross(5,997,000, excl, 8%)` = `6,476,760`; `net(5,997,000, incl, 8%) ≈ 5,552,777.78`; `none`/`incl` giữ nguyên số nhập.
- **Theo mặt bằng**: khi gán XHOME vào 2.01 ở T1/2026 → bucket 2.01 có `revenue = 383,756,504` (phí điện trống), `cost = 305,556,000`, `profit = 78,200,504`; **tổng bucket − opex = profit Dashboard** (kiểm tra cả khi bật/tắt cộng forecast).
- **Hòa vốn**: `target = 305,556,000`, phòng 200/286/229 m² → floor `85,470,210 / 122,222,400 / 97,863,390` (làm tròn đồng), tổng = target (sai số ≤ 1đ); với giá đề xuất 50,000,000 / 75,000,000 / 55,000,000 → `diff = −125,556,000`.
- **Phụ phí**: tenant có `điện = 2,000,000`, `xe máy = 5`, `ô tô = 1`, đơn giá 150,000 / 1,500,000 → phụ phí thô `= 2,000,000 + 750,000 + 1,500,000 = 4,250,000`; ở `excl` util 8% → `4,590,000`.
- **MoneyInput**: gõ `5997000` → `5,997,000`, raw = 5997000; gõ lại trên chuỗi đã format giữ nguyên; USD `3680.5` → `3,680.5`.
- **CSV**: file có dòng sai tháng + dòng khách không tồn tại → báo đúng số dòng, các dòng hợp lệ vẫn được nhập.
- **RLS/UI**: tài khoản không phải admin không thấy menu, vào URL trực tiếp bị chặn, và (theo `rls-check.sql`) `select` trên `bds_*` trả về 0 dòng/bị từ chối.

## 8. BÁO CÁO BÀN GIAO (cuối cùng, tiếng Việt, ≤ 25 dòng)

Gồm: (1) đã làm xong những gì, phase nào xanh; (2) danh sách file migration + **hướng dẫn từng bước cho Tony**:
   1. Mở Supabase → SQL Editor → dán nội dung file migration core → Run (rồi file ops, nếu có);
   2. Chạy `rls-check.sql` xem kết quả mong đợi;
   3. Merge nhánh `feat/office-rental` (hoặc mở PR) → Vercel tự deploy;
   4. Vào app → Văn phòng Orient → Cài đặt → Import JSON `orient_pl_2026-08.json` (xem trước → xác nhận);
   5. Vào "Doanh thu khách hàng" gán từng khách vào mặt bằng; kiểm tra tab "Theo mặt bằng" hiện dòng đối chiếu ✓;
(3) các quyết định tự đưa ra (trỏ tới `DECISIONS.md`); (4) hạn chế/việc còn lại; (5) kết quả `tsc`/lint/test/build.

BẮT ĐẦU NGAY từ Phase 0. Không hỏi xác nhận kế hoạch.
