# CSKH — Hiện trạng LetsGo & phương án mang PRM sang

> Giai đoạn 1 (khảo sát) — 19/10/2026. Giai đoạn 2–4 xong cùng ngày, giai đoạn 5 (Nhịp độ, Nhật ký, Sự kiện & Quà, việc nhắc tự động) ngày 20/10 — xem mục 9., nhánh `feat/cskh` (tách từ `main` @ 7fd8d54).
> Chưa sửa code, chưa có migration. Các quyết định đã chốt nằm ở mục 7. Số liệu đếm thật trên Supabase (chỉ đọc, không in dữ liệu cá nhân).
> Đối chiếu với prompt `tony-study/docs/LETSGO_CSKH_PROMPT.md` và code PRM gốc `tony-study/src/lib/prm`, `src/modules/prm`.

---

## 0. Tóm tắt nhanh

1. Mục **CSKH** trên menu (CRM Module) **không phải** `CSKH.tsx` mà là trang `crm-leads` → [CRMLeads.tsx](../src/pages/CRMLeads.tsx), gồm 2 tab: *Relationship Radar* (theo **công ty**) và *Danh sách liên hệ*. File [CSKH.tsx](../src/pages/CSKH.tsx) là trang mồ côi — không có route nào trỏ tới.
2. `cskh_logs` **gần như bỏ trống**: 4 dòng dữ liệu mẫu tháng 6/2026, không dòng nào có `client_id`. Nhật ký thật đang nằm ở `crm_interactions` (46 dòng, 34 là ghi chú nội bộ, chỉ 6 dòng là liên hệ thật với khách đã ký).
3. **Một người liên hệ thuộc NHIỀU công ty** (bảng nối `contact_clients`, migration 145) — prompt giả định 1 `client_id`.
4. **Người phụ trách chưa gắn được với tài khoản**: app chỉ có 3 tài khoản (2 admin, 1 kế toán). 14 người quản lý khách hàng (`clients.manager`, bảng `managers`) **không ai có tài khoản**. `client_manager_history` chỉ có 2 dòng.
5. **App chạy hoàn toàn bằng role `anon`** (đăng nhập bằng session token riêng, không dùng Supabase Auth). Quy tắc "bảng mới chỉ mở cho `authenticated`, không mở `anon`" trong prompt sẽ làm app **không đọc được** bảng mới.
6. Quà tặng đang có 2 bảng: `crm_gifts` (3 dòng, đang ghi mới từ Hồ sơ công ty) và `client_gifts` (2 dòng, chỉ còn đọc).
7. `contact_special_dates.date` là `date NOT NULL` dương lịch → muốn lưu sự kiện âm lịch phải nới `NOT NULL` (cần anh duyệt).
8. Đã có sẵn: Leaflet, Chart.js, vitest, proxy Gemini `api/gemini.ts`, popup nhắc sinh nhật toàn app, luồng tự tạo việc "Tái ký HĐ". Chưa có `vercel.json` / cron.

---

## 1. Màn hình đang có

| Nơi | File | Làm gì | Ghi chú |
|---|---|---|---|
| Menu CRM Module → **CSKH** | [Sidebar.tsx](../src/components/Sidebar.tsx), [MobileNav.tsx](../src/components/MobileNav.tsx) | trỏ tới page `crm-leads` | quyền theo module `CRM` trong `role_permissions` |
| Tab **Relationship Radar** | [RelationshipRadar.tsx](../src/components/crm/RelationshipRadar.tsx) | Mỗi **công ty** 1 thẻ; hạng A "KH chiến lược" nếu ≥100 LĐ, còn lại B; ngưỡng 7/14 ngày lưu **localStorage**; đỏ/vàng/xanh; nút gọi `tel:` số công ty; ghi nhận nhanh → `cskh_logs` (theo `client_id`); bấm thẻ → Hồ sơ công ty | Tính "ngày chưa liên hệ" bằng giờ máy (`Date.now()`), so khớp log theo `client_id` hoặc tên công ty |
| Tab **Danh sách liên hệ** | [CRMLeads.tsx](../src/pages/CRMLeads.tsx) | Bảng người liên hệ: lọc chi nhánh/công ty/trạng thái, sắp xếp cột, gắn nhiều công ty, cờ liên hệ chính, đánh dấu nghỉ, xoá vĩnh viễn (admin), chọn nhiều | Tìm kiếm **có dấu** (`toLowerCase().includes`) |
| Form người liên hệ | [ContactFormModal.tsx](../src/components/contacts/ContactFormModal.tsx) | Họ tên, SĐT, email, chức vụ (`contact_roles`), công ty phụ trách (nhiều), từ ngày, kênh tiếp cận, địa chỉ nhà, ngày sinh, FB/LinkedIn, sở thích (tag), ngày đặc biệt khác, ghi chú ngắn, ghi chú chi tiết, avatar, link Maps | dùng chung cho CSKH và hồ sơ Khách hàng |
| Xem nhanh | [ContactPreviewPopup.tsx](../src/components/contacts/ContactPreviewPopup.tsx) | popup thông tin + ngày đặc biệt | |
| Nhắc sinh nhật toàn app | [UpcomingDatesReminder.tsx](../src/components/contacts/UpcomingDatesReminder.tsx) gắn ở [App.tsx](../src/App.tsx) | tự mở mỗi ngày 1 lần nếu có sinh nhật/ngày đặc biệt trong 7 ngày (mọi người đang hoạt động) | tính bằng giờ máy, chỉ dương lịch |
| Hồ sơ công ty | [CompanyProfileModal.tsx](../src/components/crm/CompanyProfileModal.tsx) (2.233 dòng) | dùng chung cho BD Pipeline, Radar, ClientDetail; lịch sử = `crm_interactions` + `crm_pipeline_tasks` + `work_tasks`; quà = `crm_gifts` (+ `client_gifts` chỉ đọc) | khoá theo **thẻ Pipeline** (`crm_id`), không theo `clients.id` |
| Trang `CSKH.tsx` | [CSKH.tsx](../src/pages/CSKH.tsx) | bảng log + form thêm log vào `cskh_logs` | **không được route** — code chết |

Logic nghiệp vụ người liên hệ tập trung ở [contactOps.ts](../src/lib/contactOps.ts) (nguồn duy nhất, có lớp lùi về cột cũ nếu chưa chạy migration 145). Ngày đặc biệt ở [contactSpecialDates.ts](../src/lib/contactSpecialDates.ts).

---

## 2. Dữ liệu thật (đếm ngày 19/10/2026)

| Bảng | Số dòng | Ghi chú |
|---|---|---|
| `contacts` | 48 (44 đang phụ trách) | 31 có SĐT, **2** có ngày sinh, 0 có sở thích, 0 có link Maps, 1 có địa chỉ, 1 có ảnh |
| `contact_clients` | 47 | 44 người đã gắn công ty, **2 người kiêm 2 công ty** |
| `contact_roles` | 11 | Nhân Sự 18 · TP Nhân Sự 10 · GĐ Điều Hành 6 · GĐ Nhân Sự 5 · Tổng Vụ 3 · … |
| `contact_special_dates` | 4 | 2 sinh nhật **con** của khách, 1 ngày khai trương, 1 ngày thành lập → đúng kiểu "của người thân" + sự kiện doanh nghiệp của PRM |
| `contact_client_history` | 56 | |
| `cskh_logs` | **4** | dữ liệu mẫu 01–05/06/2026, loại: meeting 2 · call 1 · zalo 1, không có `client_id`, 4 follow-up chưa xong |
| `crm_interactions` | 46 | note 34 · zalo 8 · email 2 · call 1 · meeting 1; 14/06 → 15/10; **chỉ 13 dòng thuộc thẻ đã gắn khách hàng**, trong đó 6 dòng không phải ghi chú |
| `crm_gifts` | 3 | cột `value` là **text** |
| `client_gifts` | 2 | `value` numeric, `client_id NOT NULL` |
| `crm_pipeline` | 44 | 23 thẻ đã gắn `client_id` |
| `clients` | 79 | 71 `active`; 60 active chưa lưu trữ, trong đó **27 đang ngưng hợp tác**; 58 có `branch_id` |
| `branches` | 14 | |
| `managers` | 17 | 14 tên đang là `clients.manager` (31/60 KH có người quản lý) |
| `app_users` | **3** | admin 2 · ketoan 1 — không ai trùng tên người quản lý KH |
| `client_manager_history` | 2 | |
| `work_tasks` | 51 | Tái ký HĐ 35 · Khác 9 · Xử lý phát sinh 2 · Hợp đồng 2 · … |

Kết luận: **dữ liệu CSKH cũ rất ít** → mở rộng bảng không có rủi ro lớn; phần lớn giá trị sẽ đến từ dữ liệu nhập mới.

---

## 3. Hạ tầng & quy ước của LetsGo

- **Đăng nhập**: RPC `verify_login` cấp session token (bảng `app_sessions`), lưu localStorage; client Supabase chính tắt Auth → mọi request là role `anon`. `auth.uid()` luôn null. Riêng module Văn phòng Orient khoá RLS bằng header `x-letsgo-token` + hàm `bds_is_admin()` (migration 164).
- **RLS hiện hành** của mọi bảng CSKH/CRM: policy `FOR ALL TO anon USING (true)` + `TO authenticated USING (true)`.
- **Lịch sử dữ liệu**: migration mới gọi `SELECT dh_attach_triggers();` ở cuối để gắn trigger `data_history` (cỗ máy thời gian).
- **Tên migration**: `supabase/migrations/YYYYMMDDHHMMSS_NNN_ten.sql`, số kế tiếp là **168**. Anh tự chạy bằng SQL Editor.
- **Chịu được khi chưa chạy migration**: mẫu `isMissingTableError` / `isMissingColumnError` (trong `contactSpecialDates.ts`, `contactOps.ts`).
- **Người dùng / việc**: `work_tasks.user_id` = `app_users.id`; `task_type` là chữ tự do; `branch_id` suy từ khách hàng (`branchOf()`); xoá mềm `deleted_at`.
- **Chi nhánh**: `clients.branch_id` là khoá duy nhất, hiển thị `branches.name` (helper `branchOf`, `useBranchLookup`). Cột `clients.region` đã lỗi thời — ghi chú về `acceptedRegions` trong prompt **không còn áp dụng**.
- **Điều hướng**: thêm trang = thêm vào `Page` ([types.ts](../src/lib/types.ts)), `PAGES` ([App.tsx](../src/App.tsx)), `PAGE_MODULE` ([auth.tsx](../src/lib/auth.tsx)), Sidebar + MobileNav. Module lớn có thể tách bundle như `src/modules/office-rental` (lazy).
- **Giao diện**: Tailwind, nền giấy `#F5F4EF`, viền `#E8E7E2`, xanh chính `#1D4ED8`, chữ 11–13px; quy ước điện thoại `md` = 768px, `useIsMobile`, `p-3 md:p-5`, `MobileActionSheet`.
- **Thư viện có sẵn**: lucide-react, leaflet (+markercluster), chart.js, vitest (test dạng `src/lib/*.test.ts`).
- **AI**: [api/gemini.ts](../api/gemini.ts) (Edge, key ở server) + [gemini.ts](../src/lib/gemini.ts) (dev gọi thẳng bằng `VITE_GEMINI_API_KEY`).
- **Cron**: chưa có `vercel.json`, chưa có route cron nào.
- **Việc tự động sẵn có**: [AlertsTasksPanel.tsx](../src/components/AlertsTasksPanel.tsx) tự tạo `work_tasks` "Tái ký HĐ — <KH>" khi sắp hết hợp đồng, có chống trùng.

---

## 4. Chỗ prompt giả định khác thực tế

| Prompt nói | Thực tế | Ảnh hưởng |
|---|---|---|
| Trang `CSKH.tsx` "đang rất đơn giản" → thay bằng Nhật ký | Menu CSKH là `CRMLeads.tsx` (Radar + Danh sách liên hệ); `CSKH.tsx` không dùng | Cần quyết số phận Radar + Danh sách liên hệ |
| Mở rộng `cskh_logs` | Gần như trống; nhật ký đang dùng là `crm_interactions` (khoá theo thẻ Pipeline, **xoá thẻ là xoá luôn nhật ký** — FK CASCADE) | Chọn bảng nhật ký (câu hỏi A1) |
| Mở rộng `client_gifts` | Hồ sơ công ty đang ghi quà vào `crm_gifts`; `client_gifts` chỉ còn đọc | Chọn bảng quà (A2) |
| `contacts` có `client_id` (1 công ty) | Nhiều công ty qua `contact_clients` | Hàng đợi/thẻ hiện "Công ty A, Công ty B"; người phụ trách mặc định không suy được từ 1 công ty |
| Người phụ trách mặc định lấy từ `client_manager_history` | Người quản lý KH là tên chữ, không có tài khoản; lịch sử chỉ 2 dòng | Câu hỏi B1 |
| RLS chỉ `authenticated` | App luôn là `anon` | Câu hỏi B2 |
| `contacts.birthday` + `contact_special_dates` | `date NOT NULL` dương lịch, chỉ `label` | Cần thêm `day/month/year/is_lunar…` và nới `NOT NULL` (A3) |
| Lọc chi nhánh qua `acceptedRegions` | Đã chuyển hẳn sang `branch_id` | Dùng `branchOf()` |
| Sở thích là `text[]` | `contacts.hobbies` là **TEXT chứa JSON** (helper `parseHobbies`) | Giữ nguyên kiểu, map ở tầng code (không đổi kiểu cột) |
| Liên hệ "lưu trữ" (`is_archived`) | LetsGo có `is_active` = "Đang phụ trách / Đã nghỉ" + xoá vĩnh viễn (admin) | Câu hỏi C3 |

---

## 5. Ánh xạ PRM → CSKH (đã chốt theo mục 7)

Khoá enum giữ **y hệt** PRM để sau này đồng bộ (mục 8 prompt). Chỉ `ADD COLUMN` nullable/có default, `IF NOT EXISTS`.

| PRM | LetsGo | Cột thêm / cách map |
|---|---|---|
| `prm_contacts` | `contacts` | **thêm**: `tier` (default `'unclassified'`, check 7 khoá), `group_id`, `cadence_days`, `last_interaction_at` (trigger), `last_cold_alert_at`, `owner_id`, `nickname`, `zalo_phone`, `habits`, `personality`, `mbti`, `remember_notes jsonb` (5 khoá, ≤500 ký tự/mục, ≤8KB), `introduced_by`, `context` (default `'work'`), `province`, `lat`, `lng`, `geo_source`, `external_ref`. **map sẵn**: `full_name`↔`name`, `phones`↔`phone` (nhiều số ngăn phẩy), `emails`↔`email`, `organization`↔`contact_clients→clients.name`, `job_title`↔`role`, `interests`↔`hobbies` (JSON text), `map_url`↔`map_link`, `avatar_url`, `notes`↔`notes`/`rich_notes` |
| `prm_interactions` | **`cskh_logs`** (A1) | **thêm**: `contact_id`, `channel`, `initiated_by`, `followup_due`, `followup_task_id`, `created_by` (app user id), `created_by_name`, `updated_at`, `is_archived`. **map**: `type`↔`contact_type` (dòng cũ `meeting`→`meet`, `zalo`→`message` + kênh `zalo` — đọc-map ở code, không sửa dữ liệu), `occurred_at`↔`log_date`, `follow_up_action`↔`followup`, `follow_up_done`↔`followup_done`. Dòng cũ không `contact_id` hiện theo `client_name`/`contact_person`. "Kết quả nhanh" (Vui vẻ / Bình thường / Cần chú ý) ghi vào `content` như PRM, không có cột riêng |
| `prm_occasions` | `contact_special_dates` + `contacts.birthday` | **thêm**: `occasion_type`, `day`, `month`, `year`, `is_lunar`, `related_person`, `remind_days_before` (7), `last_reminded_year`, `note`, `updated_at`, `is_archived`; backfill `day/month/year` từ `date` (không xoá `date`) |
| `prm_gifts` | **`client_gifts`** (A2) | **thêm**: `direction` (`given`/`received`), `occasion_id`, `updated_at`, `is_archived`; `recipient_contact_id`↔`contact_id`, `item_name`↔`item`, `value`↔`estimated_value`, `gift_date`↔`given_at`, `notes`↔`note` |
| `prm_groups` | **`cskh_groups`** (mới) | `name`, `color` (6 màu), `base_tier`, `created_by`, `updated_at`, `is_archived` |
| `prm_settings` | **`cskh_settings`** (mới, 1 dòng chung toàn công ty) | `cadence_vvip…other`, `digest_*` |
| `exec_tasks` | `work_tasks` | `user_id` = người phụ trách, `client_id` = công ty của người liên hệ, `branch_id` suy từ công ty, `task_type = 'CSKH'`, tiêu đề "CSKH: …" |
| Google Contacts sync | bỏ | |
| `user_id = auth.uid()` | `contacts.owner_id` (→ `app_users`) + bộ lọc Chi nhánh / Người phụ trách / Người quản lý KH | B1 |

**Trigger** `last_interaction_at` = `max(log_date)` của `cskh_logs` theo `contact_id` (không tính dòng đã lưu trữ).

---

## 6. Kiến trúc đề xuất

```
src/lib/cskh/            hàm thuần + test (vitest)
  dates.ts               todayVN, diffDays, addDaysIso
  lunar.ts               port nguyên từ PRM
  cadence.ts             resolveCadence, careStatus, dueLabel
  score.ts               calcRelationshipScore, weakestPart
  todayQueue.ts          buildTodayQueue
  contactActions.ts      chuẩn hoá SĐT, tel/sms/zalo
  pendingContact.ts      ghi nhận khi quay lại app
  mappers.ts             row LetsGo ↔ domain kiểu PRM (đọc dòng cũ)
  seedTiers.ts           gợi ý hạng theo chức vụ (cho nút "Xếp gợi ý")
src/modules/cskh/        7 tab + sheet/modal; trang `crm-leads` (menu CSKH) tải bundle riêng (lazy)
supabase/migrations/     168… (giai đoạn 2)
```

Menu giữ **1 mục CSKH** trong CRM Module; trong trang có thanh tab 7 mục, tab đang mở ghi vào URL (`#/crm-leads/<tab>`) như cách `useHashTab` đang làm, F5 không bị nhảy tab.

---

## 7. Quyết định đã chốt (19/10/2026)

| # | Câu hỏi | Chốt |
|---|---|---|
| A1 | Bảng nhật ký | **`cskh_logs`** mở rộng thành nhật ký theo người. Hồ sơ công ty gộp `cskh_logs` vào dòng thời gian. `crm_interactions` giữ cho BD (chưa ký) |
| A2 | Bảng quà | **`client_gifts`**. Hồ sơ công ty của KH đã ký ghi quà vào đây; `crm_gifts` chỉ còn cho khách tiềm năng |
| A3 | Âm lịch | **Nới `NOT NULL`** của `contact_special_dates.date`; thêm `day/month/year/is_lunar` |
| B1 | Người phụ trách | **Tài khoản app** (`contacts.owner_id` → `app_users`). Ban đầu giao hết cho anh; bộ lọc có thêm "Người quản lý KH" (tên chữ `clients.manager`) |
| B2 | Bảo mật bảng mới | **Theo quy ước LetsGo**: policy `anon` + `authenticated` như các bảng CSKH/CRM hiện có |
| C1 | Danh sách ban đầu | **Tự xếp sẵn** bằng nút "Xếp gợi ý" (có xem trước, chạy 1 lần, chỉnh lại được) cho người của KH đang hợp tác |
| C2 | Nhãn hạng | **Theo vai trò**: vvip *Người quyết định* (14) · vip *Người ảnh hưởng* (30) · partner *Tác nghiệp* (45) · friend *Quan hệ rộng* (90) · family *Thân thiết* (30) · other *Khác* (180) · unclassified *Chưa chăm sóc* |
| C3 | Người "Đã nghỉ" | **Ra khỏi hàng đợi** (như lưu trữ): không nhắc, không chấm điểm, giữ hạng + lịch sử; mở lại là tự quay về |
| C4 | Phạm vi | **Mọi người liên hệ** chọn được; Ma trận mặc định hiện người của KH đang hợp tác, có lọc KH ngưng / tiềm năng |
| C6 | Cài đặt | **Chung toàn công ty**; khác biệt thì dùng nhịp riêng trên từng người |
| C8 | Tái ký HĐ | **1 dòng nhắc nhỏ** dưới hàng đợi ("N hợp đồng sắp hết — mở Workspace"), không tạo việc trùng |
| C9 | Popup sinh nhật | **Giữ, nâng cấp**: chỉ người đang chăm sóc, tính âm lịch + sự kiện người thân, có nút mở CSKH |
| D1 | Menu | **1 mục CSKH có thanh tab** 7 trang (không tách nhóm menu riêng) |
| D2/D3 | Trang cũ | **Gộp**: Radar → Dashboard CSKH + khối "Sức khỏe CSKH" theo công ty; Danh sách liên hệ → Ma trận, giữ đủ thao tác (gắn công ty, liên hệ chính, đánh dấu nghỉ, xoá) |
| D4 | Giao diện | **Tông LetsGo + bố cục PRM** (nền giấy, viền mảnh, xanh `#1D4ED8`; mượn capsule, bottom sheet, segmented control) |
| E3 | Bản đồ | **Vị trí công ty** mặc định (toạ độ `clients.lat/lng` sẵn có); ai có link nhà riêng thì chuyển được sang "Nhà riêng" |

Hệ quả của C1 + C2: "Xếp gợi ý" dựa vào **chức vụ** (`contacts.role`) — GĐ / chủ DN / người ký HĐ → *Người quyết định*; TP/GĐ Nhân sự → *Người ảnh hưởng*; Nhân sự, Tổng vụ, Tuyển dụng → *Tác nghiệp*. Bảng ánh xạ chức vụ → hạng sẽ hiện trong màn xem trước để anh sửa trước khi áp dụng.

### Còn mở — làm theo đề xuất nếu anh không đổi
- **A4.** Giữ `contacts.birthday` (dương lịch) + sinh nhật âm lịch / của người thân ở `contact_special_dates`; logic gộp cả hai.
- **A5.** Tương tác BD (`crm_interactions`) và ghi chú nội bộ **không** tính là "đã liên hệ".
- **B3.** Ai cũng thấy toàn bộ; mặc định lọc "Của tôi", có lọc chi nhánh / người phụ trách.
- **B4.** Quyền vào module giống CRM hiện tại (admin, bdh, kinhdoanh qua `role_permissions`).
- **C5.** Nhịp mặc định 14/30/45/90/30/180 ngày.
- **C7.** Giữ 4 khoá loại sự kiện PRM; sự kiện doanh nghiệp (thành lập, khai trương, ngày ký HĐ đầu tiên) dùng `anniversary` + tiêu đề gợi ý.
- **C10.** Giá trị quà hiện cho mọi người có quyền vào CSKH.
- **E1.** Digest Telegram: hỏi lại ở giai đoạn 7 (bot, gửi nhóm chung hay từng người).
- **E2.** ~~Gợi ý tin nhắn dùng Gemini~~ — **đã bỏ hẳn 20/10/2026** theo yêu cầu Tony (đừng thêm lại khi chưa được hỏi).

---

## 8. Ghi chú đồng bộ Tony Study (chưa code)

- Khoá enum giữ y hệt PRM; ngày `YYYY-MM-DD` giờ Việt Nam; sự kiện lưu `day, month, year?, is_lunar`.
- Khoá ghép người: SĐT chuẩn hoá (quy tắc `contactActions`) + email viết thường; cột `external_ref` để lưu id phía Tony Study.
- Mọi bảng CSKH có `updated_at` (trigger) + xoá mềm `is_archived` → đồng bộ tăng dần được.
- Chỉ người `context` = `work`/`both` đi qua lại; ghi chú riêng tư của Tony không sang LetsGo trừ khi đánh dấu; mỗi trường có một bên "sở hữu".

---

## 9. Tiến độ

### Giai đoạn 2 — dữ liệu + logic thuần (19/10/2026, chưa commit)

**Migration** (anh tự chạy theo thứ tự, mỗi file chạy lại nhiều lần vẫn an toàn; đã chạy thử 2 lần liên tiếp trên PGlite với 28 kiểm tra):

| Số | File | Nội dung | Mất dữ liệu? |
|---|---|---|---|
| 168 | `20261019130000_168_cskh_groups.sql` | bảng `cskh_groups` + hàm `cskh_touch_updated_at()` | Không — bảng mới |
| 169 | `20261019130100_169_cskh_contacts.sql` | 19 cột CSKH cho `contacts` + trigger `updated_at` | Không — chỉ thêm cột; 48 người nhận hạng "Chưa chăm sóc" |
| 170 | `20261019130200_170_cskh_logs.sql` | 9 cột cho `cskh_logs` + trigger `last_interaction_at` | Không — 4 dòng cũ giữ nguyên |
| 171 | `20261019130300_171_cskh_special_dates.sql` | 11 cột cho `contact_special_dates`, nới `NOT NULL` của `date`, trigger giữ `day/month` khớp `date` | Không — 4 dòng cũ được điền thêm ngày/tháng + đoán loại |
| 172 | `20261019130400_172_cskh_client_gifts.sql` | 4 cột cho `client_gifts` | Không — 2 dòng cũ = "Đã tặng" |
| 173 | `20261019130500_173_cskh_settings.sql` | bảng `cskh_settings` (1 dòng) | Không — bảng mới |

**Quy ước sự kiện sau migration 171**: sự kiện dương lịch luôn có `date` (năm trong `date` không mang nghĩa, như trước nay); năm thật (năm sinh, năm thành lập) nằm ở `year`. Sự kiện âm lịch: `date` = NULL, bắt buộc `day` + `month`. DB tự chặn sự kiện thiếu ngày.

**Logic thuần** `src/lib/cskh/` (không gọi Supabase, không đọc đồng hồ): `types`, `lunar` (port nguyên, chỉ dịch chú thích), `dates`, `cadence`, `score`, `todayQueue`, `contactActions`, `pendingContact`, `search`, `remember`, `events`, `mappers` (đọc được dòng cũ + DB chưa chạy migration), `seedTiers` ("Xếp gợi ý" theo chức vụ). Test: 85 test vitest (port toàn bộ test PRM liên quan + lịch âm đối chiếu Tết/Giỗ Tổ/Trung thu/tháng nhuận + trường hợp riêng LetsGo).

**Sửa kèm để không mất dữ liệu**: `saveSpecialDates()` ([contactSpecialDates.ts](../src/lib/contactSpecialDates.ts)) trước đây xoá hết rồi chèn lại mỗi lần bấm Lưu ở form người liên hệ → sẽ xoá mất thông tin sự kiện CSKH (loại, người thân, âm lịch…). Giờ lưu theo từng dòng và chỉ đụng dòng dương lịch form đó hiển thị.

**Để dành cho giai đoạn sau**:
- Sinh nhật trong hồ sơ (`contacts.birthday`) là sự kiện ảo, không có `last_reminded_year` → giai đoạn 5 chống tạo trùng việc "Chuẩn bị quà" bằng cách khác (VD kiểm tra `work_tasks` đã có).
- `contacts.owner_id` đang trống cho mọi người → giai đoạn 3: "Xếp gợi ý" gán người phụ trách = người bấm nếu còn trống; bộ lọc "Của tôi" của admin tính cả người chưa giao.
- `getContactUsage()` (cảnh báo trước khi xoá người liên hệ) nên đếm thêm nhật ký CSKH — giai đoạn 4.

### Giai đoạn 3 — Dashboard + hàng đợi Hôm nay + ghi nhận nhanh + việc đã hứa (19/10/2026, chưa commit)

**Vị trí**: menu CRM Module → CSKH (`#/crm-leads`) giờ có thanh tab **Dashboard** (mặc định) · Danh sách liên hệ · Relationship Radar. Hai tab cũ giữ tạm tới giai đoạn 4–5. Code module ở `src/modules/cskh/` (tải bundle riêng ~55 KB khi mở tab).

| File | Vai trò |
|---|---|
| `data/api.ts` | tải dữ liệu (phân trang > 1000 dòng), ghi nhật ký, việc đã hứa ↔ `work_tasks`, đưa người vào chăm sóc |
| `data/useCskhData.ts` | hook tải + tự tải lại khi nơi khác vừa ghi (`cskh:data-changed`) |
| `Dashboard.tsx` | trang Dashboard CSKH |
| `components/TodayQueue.tsx` | hàng đợi Hôm nay (Gọi/Zalo/SMS · Xong · Đã liên hệ) |
| `components/QuickLogHost.tsx` + `QuickLogSheet.tsx` | quay lại app sau khi gọi → "Đã liên hệ với X qua Zalo?" |
| `components/LogInteractionModal.tsx` | form Ghi tương tác (tìm không dấu, chọn công ty nếu kiêm nhiều nơi) |
| `components/ContactBriefSheet.tsx` | tóm tắt nhanh khi chạm vào dòng |
| `components/CarePickerModal.tsx` | Chọn người chăm sóc + "Xếp gợi ý" theo chức vụ |

**Quy tắc đã cài**:
- Việc đã hứa → `work_tasks` (`task_type = 'CSKH'`, ưu tiên cao, tiêu đề "CSKH: <việc> — <người>", giao cho người phụ trách của người liên hệ, chưa có thì người đang ghi; chi nhánh suy từ công ty). Lưu dòng nhật ký thất bại thì xoá luôn việc vừa tạo (không để việc mồ côi).
- Bấm "Xong" ở hàng đợi / khối Việc đã hứa / tóm tắt → đóng cả việc trong Workspace. Ngược lại, việc đã xong bên Workspace thì CSKH cũng coi là xong (khi tải dữ liệu).
- Lọc "Của tôi" của admin tính cả người chưa giao người phụ trách. "Chọn người chăm sóc" gán người phụ trách = người bấm cho ai còn trống.
- "Sắp hết HĐ" chỉ là 1 dòng nhắc dưới hàng đợi (cùng mốc ≤ 30 ngày như Workspace), không tạo việc.
- Hàng đợi > 7 người: "+N người khác đang chờ — hiện tất cả" mở rộng tại chỗ (trang Nhịp độ chưa có — giai đoạn 5).
- Ô chỉ số chưa bấm sang trang khác được (Ma trận / Nhật ký / Sự kiện chưa có — nối ở giai đoạn 4–5).

### Giai đoạn 4 — Ma trận + Hồ sơ + Nhóm tự tạo + Chọn người chăm sóc (19/10/2026, chưa commit)

**Thanh tab CSKH**: Dashboard · **Ma trận Khách hàng** · Relationship Radar. Ma trận thay hẳn tab "Danh sách liên hệ" (đường dẫn cũ `#/crm-leads/contacts` tự mở Ma trận). `CRMLeads.tsx` chỉ còn là khung tab.

| File | Vai trò |
|---|---|
| `Matrix.tsx` | Ma trận: bảng nhiệt Nhóm × Trạng thái (bấm ô để lọc), tìm không dấu, phạm vi Đang chăm sóc / Chưa chăm sóc / Đã nghỉ / Tất cả, bộ lọc viên (Nhóm, Trạng thái, Chi nhánh, Người phụ trách, Loại khách, Công ty, Tỉnh) + chip bộ lọc, bảng sắp xếp được, "Hiện thêm" 60 dòng/lần, chọn nhiều |
| `components/ContactProfileModal.tsx` | Hồ sơ người liên hệ (mở từ Ma trận, tóm tắt nhanh, khối "Cần đầu tư thêm") |
| `components/GroupSelect.tsx` | Ô "Nhóm" hợp nhất + chip đổi nhóm nhanh trên dòng (select trong suốt phủ lên chip) |
| `components/GroupManagerModal.tsx` | Tạo / sửa / xoá nhóm tự tạo (tên, 6 màu, "nhắc liên hệ như" 1 hạng) |
| `components/CarePickerModal.tsx` | Chọn người chăm sóc: gợi ý theo chức vụ + người khác, tìm không dấu, chọn nhiều, "Gán chung" 1 nhóm cho cả lô |

**Giữ đủ thao tác của Danh sách liên hệ cũ**: Thêm liên hệ (form cũ, có cảnh báo trùng SĐT) → mở luôn hồ sơ CSKH; gắn / gỡ công ty và ★ liên hệ chính (trong hồ sơ); gắn thêm công ty hàng loạt; đánh dấu nghỉ / mở lại; xoá vĩnh viễn (admin). "Form đầy đủ" trong hồ sơ mở form cũ cho ngày đặc biệt, ghi chú chi tiết, Facebook/LinkedIn.

**Quy tắc đã cài**:
- Hồ sơ lưu 2 phần: phần chung (tên, SĐT, email, công ty, chức vụ, địa chỉ, ngày sinh, sở thích, ảnh, ghi chú ngắn…) qua `contactOps.saveContact` → giữ nguyên lịch sử chuyển công ty + liên hệ chính; phần CSKH (nhóm, nhịp riêng, người phụ trách, tên thân mật, Zalo riêng, Điều cần nhớ, thói quen, tính cách, MBTI, người giới thiệu, ngữ cảnh, tỉnh) ghi thẳng cột migration 169. Toạ độ nhà riêng: lấy từ link Google Maps, không có thì tra địa chỉ (Nominatim) khi địa chỉ đổi.
- Xếp nhóm tự tạo = `group_id` + `tier` = hạng gốc của nhóm. Đổi hạng gốc của nhóm → mọi thành viên đổi hạng theo. Xoá nhóm = lưu trữ (`is_archived`), thành viên về nhóm mặc định đúng hạng đang có.
- "Bỏ chăm sóc" nhiều người có hỏi xác nhận; người vừa vào danh sách chăm sóc mà chưa có người phụ trách → giao cho người bấm.
- Loại khách mặc định "Đang hợp tác" (chip có ×). Đang tìm mà người cần tìm ở phạm vi / loại khách khác → gợi ý "tìm trong tất cả".
- Hộp xoá người liên hệ (`ContactDeleteDialog`) giờ đếm thêm dòng nhật ký CSKH (giữ lại) và **cảnh báo đỏ** số ngày đặc biệt / sự kiện sẽ bị xoá theo (CASCADE). Xoá hàng loạt ở Ma trận cũng nói rõ điều này.

### Giai đoạn 5 — Nhịp độ + Nhật ký + Sự kiện & Quà + việc nhắc tự động (20/10/2026, chưa commit)

**Thanh tab CSKH**: Dashboard · Ma trận Khách hàng · **Nhịp độ Chăm sóc** · **Nhật ký CSKH** · **Sự kiện & Quà tặng**. Relationship Radar đã bỏ (link cũ `#/crm-leads/radar` mở Dashboard). Đã xoá 2 file chết: `src/pages/CSKH.tsx` (không route nào trỏ tới) và `src/components/crm/RelationshipRadar.tsx`. Không có migration mới.

**Kiến trúc**: `src/modules/cskh/index.tsx` là khung module (CRMLeads nạp lazy): tải dữ liệu 1 lần cho mọi tab, giữ hộp thoại dùng chung (Hồ sơ, Ghi tương tác, Chọn người chăm sóc, Nhóm — qua `context.ts`), gắn bottom sheet ghi nhận nhanh, chạy việc nhắc tự động. Bộ lọc Chi nhánh / Người phụ trách / Người quản lý KH dùng chung (`useCareScope.ts` + `CareScopeBar`), nhớ giữa các tab.

| File | Vai trò |
|---|---|
| `Cadence.tsx` | Nhịp độ: 3 khu Quá hạn / Sắp đến hạn / Ổn định, xếp theo hạn gấp nhất, "Tương tác cuối dd/mm/yyyy · chu kỳ N ngày", nút + ghi tương tác |
| `InteractionLog.tsx` | Nhật ký: mới nhất trước, loại / kênh / ai chủ động / nội dung / việc tiếp theo + chip "Trễ hạn"; lọc người, loại, chi nhánh, người ghi, "Có việc đang mở"; tick xong / mở lại tại dòng; xoá có xác nhận (xoá mềm). 4 dòng cũ hiện đủ theo tên công ty / người liên hệ dạng chữ |
| `Events.tsx` + `components/OccasionForm.tsx`, `GiftForm.tsx` | Sự kiện sắp tới (âm lịch đã quy đổi, đếm ngược, nút Google Calendar, mặc định chỉ người đang chăm sóc) + Lịch sử quà (Đã tặng / Đã nhận, giá trị VND, gắn sự kiện, "đã ghi trước đây" để tránh tặng trùng) |
| `ClientCareBlock.tsx` | Khối "Sức khỏe CSKH" ở hồ sơ Khách hàng (tab Hồ sơ chăm sóc): điểm TB, người quá hạn, việc đã hứa đang mở (Xong tại chỗ), quà 12 tháng, nhật ký gần đây, danh sách người liên hệ → hồ sơ / ghi tương tác |
| `lib/cskh/automation.ts` | Chọn việc nhắc cần tạo (hàm thuần, có test); `runCareAutomation` trong `data/api.ts` ghi Supabase |

**Quy tắc đã cài**:
- **Việc nhắc tự động** (1 lần mỗi phiên khi mở CSKH, sau khi dữ liệu tải xong; giao cho người phụ trách):
  - *Chuẩn bị quà*: sự kiện của người đang chăm sóc còn ≤ "nhắc trước N ngày" → "CSKH: Chuẩn bị quà <sự kiện> — <người> (dd/mm)", hạn = ngày sự kiện. Chống trùng bằng `last_reminded_year` + kiểm việc cùng tên cùng hạn (sinh nhật trong hồ sơ không có cột đánh dấu).
  - *Kết nối lại*: chỉ người **đã từng liên hệ** mà quá nhịp, chưa được nhắc sau lần liên hệ cuối (`last_cold_alert_at`); quá hạn nhiều nhất trước, **tối đa 10 việc/lần**. Khác PRM: người chưa từng liên hệ không sinh việc (họ đã ở hàng đợi Hôm nay) — tránh vừa "Xếp gợi ý" xong là Workspace bị dội ~40 việc.
- Sự kiện dương lịch lưu cả cột `date` (năm thật nếu biết, không thì 2000); âm lịch `date` = NULL. Đổi ngày → xoá dấu "đã nhắc năm nay".
- Quà bắt buộc gắn công ty (`client_gifts.client_id` NOT NULL) — người chưa gắn công ty phải gắn trong hồ sơ trước.
- Xoá nhật ký / sự kiện / quà = xoá mềm (`is_archived`). Xoá dòng nhật ký có việc đã hứa chưa xong → việc đó trong Workspace cũng bị xoá mềm.
- Form người liên hệ cũ (`saveSpecialDates`, `fetchSpecialDates`) bỏ qua sự kiện đã xoá mềm — không hiện lại, không xoá cứng.
- **Popup nhắc sinh nhật** (chốt C9): chỉ người đang chăm sóc, tính âm lịch + sự kiện người thân, có nút "Mở Sự kiện & Quà tặng". DB chưa chạy migration thì giữ cách cũ.
- Ô chỉ số trên Dashboard bấm sang tab tương ứng; "+N người khác đang chờ" mở Nhịp độ.

**Còn để sau**:
- Hồ sơ công ty (`CompanyProfileModal`) vẫn ghi quà vào `crm_gifts` và dòng thời gian chỉ có `crm_interactions` — chưa gộp `cskh_logs` / `client_gifts` vào đó (A1/A2). Khối "Sức khỏe CSKH" đặt ngay trên hồ sơ công ty đã hiện nhật ký + quà CSKH.
- Bản đồ (giai đoạn 6), Digest Telegram + Cài đặt nhịp (giai đoạn 7).

### Giai đoạn 6 — Bản đồ (20/10/2026, chưa commit)

- Tab **Bản đồ Khách hàng** (`MapView.tsx`): mặc định đặt người tại vị trí công ty, chuyển "Nhà riêng"; ghim màu theo nhóm, lọc nhóm có đếm, popup "Mở hồ sơ"; định vị hàng loạt nhà riêng (link Maps → tức thì, địa chỉ → Nominatim ~1 yêu cầu/giây).
- ~~Gợi ý tin nhắn AI~~: đã làm rồi **gỡ hẳn 20/10/2026** theo yêu cầu Tony — xoá `lib/cskh/messagePrompt.ts` (+ test), `components/MessageSuggestions.tsx`, hàm `generateGeminiRaw` trong `lib/gemini.ts`; nút ✨ ở hàng đợi, khối gợi ý trong tóm tắt nhanh và hồ sơ cũng bỏ. Proxy `api/gemini.ts` có từ trước vẫn giữ nguyên.

### Dashboard kiểu Apple (20/10/2026, chưa commit)

Tony yêu cầu "gọn, chuyên nghiệp, phong cách giống Apple". Dữ liệu và luồng bấm giữ nguyên, chỉ đổi cách bày:
- Đầu trang: ngày (chữ nhỏ in hoa) · tiêu đề lớn **Tổng quan** · câu tóm tắt · 2 nút bo tròn (Chọn người chăm sóc / Ghi tương tác).
- Bộ lọc dạng pill xám nhạt (`CareScopeBar variant="pill"`; các tab khác vẫn kiểu cũ).
- 4 chỉ số gom vào **1 thẻ**, chia bằng đường kẻ mảnh (vòng điểm kiểu Apple Fitness, cột tuần nhỏ). Điện thoại 2×2.
- Còn 3 thẻ thay vì 6: **Hôm nay cần liên hệ** (trái) · **Sắp tới** (phân đoạn Việc đã hứa / Sự kiện / Gần đây — tự mở đoạn có việc) · **Sức khỏe quan hệ** (Theo nhóm / Cần đầu tư; bấm ô Sức khỏe thì nhảy tới đoạn Cần đầu tư).
- Chưa ai được chăm sóc thì chỉ hiện thẻ hướng dẫn, ẩn dải chỉ số + các thẻ (trước đây hiện toàn số 0).
- `TodayQueue` kiểu danh sách iOS: nút tròn xám, pill "Đã liên hệ"; điện thoại: nút xuống hàng, "Xong" chỉ còn icon, không tràn thẻ ở 375px.
- Thanh tab CSKH (CRMLeads.tsx) đổi sang điều khiển phân đoạn kiểu iOS.
- Đã xem thử bằng trang tạm với dữ liệu giả (máy tính + 375px), trang tạm đã xoá. Chưa xem với dữ liệu thật vì khung preview chưa đăng nhập.

### Toàn module kiểu Apple (21/10/2026, chưa commit)

Tony yêu cầu cả 6 tab CSKH "giống Workspace (kiểu Apple) hoặc đẹp hơn". Chỉ đổi giao diện, dữ liệu và luồng bấm giữ nguyên:
- **Một bộ khối dùng chung** `src/modules/cskh/components/apple.tsx` (tiêu đề lớn `PageTitle`, thẻ `Panel`, điều khiển phân đoạn `Segmented`, dòng iOS `Row`, `PillSelect`, ô tìm iOS `SearchField`, công tắc `Switch`, `FilterChip`, `MoreButton`) + lớp nút viên / nút tròn trong `ui.ts` (dựa trên token `src/components/workspace/wsTheme.ts`). Dashboard bỏ bản sao riêng, dùng chung bộ này.
- **Màu**: nhấn `#0071E3` như Workspace (thay `#1D4ED8`); màu trạng thái/hạng = bản đậm của màu hệ thống Apple (đỏ `#D70015`, cam `#B25000`, xanh lá `#248A3D`…) để chữ trên capsule đủ tương phản.
- **Khung trang** (`CRMLeads.tsx`): thanh trên mờ kiểu macOS, tab có icon; < 1280px dùng nhãn ngắn (Tổng quan · Ma trận · Bản đồ · Nhịp độ · Nhật ký · Sự kiện & Quà). Nền `#F5F5F7`.
- **Ma trận**: ô nhiệt bo tròn, thanh chọn nhiều nổi (mờ, có bóng), bảng không viền. **Nhật ký**: gom theo ngày (Hôm nay / Hôm qua / Thứ…), ô icon màu theo hình thức. **Sự kiện**: ô lịch kiểu ứng dụng Lịch. **Hồ sơ**: đầu hồ sơ kiểu Danh bạ (Gọi / Zalo / SMS / Ghi lại), nhóm trường kiểu iOS, ô tải ảnh chuyển xuống mục Liên lạc; chân sheet dính sát đáy (trước đây hở 16px).
- **Điện thoại**: thanh lọc Chi nhánh/Phụ trách/Quản lý KH cuộn ngang 1 hàng; Nhịp độ và Sự kiện đưa chip xuống dòng dưới tên.
- Kiểm tra: `tsc` không thêm lỗi, eslint sạch, 98 test vitest đạt; xem bằng trang giả lập dữ liệu mẫu (Supabase giả, không ghi DB) ở 1024px và 375px.

### Việc nhắc chạy hằng ngày + sửa nhật ký (21/10/2026, chưa commit)

- **Việc nhắc tự động không còn phụ thuộc có ai mở trang CSKH.** `src/modules/cskh/CareAutomationRunner.tsx` gắn ở `App.tsx`: mở app ở bất kỳ trang nào → chờ ~2,5 giây rồi chạy "Chuẩn bị quà" + "Kết nối lại", **mỗi ngày 1 lần mỗi trình duyệt** (localStorage `lgvn_cskh_automation_<user>`), chỉ tài khoản có quyền vào CSKH. Trang CSKH vẫn chạy 1 lần mỗi phiên như trước. Cả hai đi qua `automationRunner.ts`: dùng chung 1 lượt đang chạy nên mở app rồi vào ngay CSKH không tạo việc trùng; nơi gọi sau không báo lại. Code chạy thật nạp động (`import()`), bundle chính không kéo theo dữ liệu CSKH. Test: `automationRunner.test.ts` (8).
- **Sửa dòng nhật ký** (nút bút chì ở tab Nhật ký): sửa hình thức, ngày, ai chủ động, nội dung, công ty (người kiêm nhiều nơi), việc đã hứa + hạn. Người liên hệ khoá (ghi nhầm người → xoá rồi ghi lại). `updateInteraction` trong `data/api.ts` đồng bộ việc trong Workspace: trước chưa hứa nay thêm → tạo việc mới; đổi chữ/hạn → đổi tên + hạn việc; xoá trắng → xoá mềm việc chưa xong. Giữ hình thức thì giữ kênh cũ (Zalo…); dòng cũ chưa gắn người giữ nguyên công ty dạng chữ; lưu lỗi thì xoá việc vừa tạo. Đổi ngày → trigger migration 170 tự tính lại ngày tương tác cuối. Có ghi audit (cũ/mới). Test: `data/updateInteraction.test.ts` (8).

---

## 10. Nâng cấp 24/10/2026 — mang các tính năng PRM mới của Tony Study sang

> Theo `tony-study/docs/LETSGO_CSKH_UPGRADE_2026-10-24.md`. Tony chốt: làm hết A→E một lượt; quê quán thêm cột `origin_province`; nới CHECK `geo_source` thêm `'manual'`, `'address_url'`; quà ghi nhóm vào `client_gifts`; sửa / xoá đợt: người tạo đợt + admin. Không làm E2 (sao lưu ảnh): đếm thật 24/10 chỉ 1/49 người có ảnh và ảnh đã nằm trong bucket `avatars` của app.

### 10.1 Khảo sát — đã có / một phần / chưa có (trước khi build)

| Tính năng | Trước 24/10 | Ánh xạ |
|---|---|---|
| A1 Giới tính + đoán theo tên | chưa có | cột mới `contacts.gender` (174). Dữ liệu thật: 39/49 tên bắt đầu "Ms"/"Mr", 3 tên đệm "Thị" → gợi ý dùng được ngay |
| A2 Tuổi âm, mệnh, hợp/kỵ | chưa có | `lib/cskh/canChi.ts` dùng lại `lunar.ts` |
| A3 Ngày quan trọng trong hồ sơ + nhắc 2 lần | một phần: `contact_special_dates.remind_days_before` đã có (171) nhưng popup chỉ nhắc "trong 7 ngày, mỗi ngày 1 lần", không theo số ngày từng sự kiện; sinh nhật hồ sơ cố định 7 ngày | sinh nhật chính chủ (dương lịch, có năm) giữ ở `contacts.birthday` (dùng chung hồ sơ Khách hàng) + cột mới `birthday_remind_days`; còn lại ở `contact_special_dates` |
| A4 Gia đình có cấu trúc | chưa có (hàm làm sạch bỏ khoá lạ) | `remember_notes.members`, không cần cột |
| A5 Chuyên sâu thu gọn | chưa có | giữ bố cục hồ sơ hiện tại (Tony đã ưng), thêm khối "Thông tin chuyên sâu" thu gọn |
| B1 Thẻ dùng chung | một phần: chip mẫu bật/tắt, không đếm người, không gợi ý thẻ người khác | giữ cột cũ (`hobbies` JSON, chữ nối ", ") |
| B2 Học vấn | chưa có | cột mới `contacts.education` jsonb (174) |
| B3 Lọc & tìm | tìm không dấu đã có; chưa lọc giới tính / đặc điểm | mở rộng `search.ts` |
| C1 Địa chỉ + link Maps + ghim | một phần: có địa chỉ + link + iframe Google; link rút gọn `maps.app.goo.gl` (cách dán phổ biến nhất từ điện thoại) KHÔNG đọc được toạ độ; tra chữ không lùi dần | `api/resolve-map.ts` + ghim Leaflet chấm tay; `province` = nơi ở, `origin_province` = quê |
| C2 Chính xác / Tương đối | chưa có | tự suy: có link hoặc chấm tay = chính xác |
| C3 Bản đồ nâng cấp | một phần: 2 chế độ công ty / nhà riêng | 3 lớp + đo khoảng cách + vị trí của tôi + định vị hàng loạt |
| D1/D2 Ghi nhóm + đợt | chưa có | dấu đợt `created_at` (tương thích Tony Study) |
| D3 Số đang chăm sóc | Dashboard "6 / 8", Ma trận "Chưa chăm sóc · Tất cả" | bỏ so với danh bạ |
| E1 Vùng miền (AI) | chưa có | `api/gemini.ts` sẵn có + responseSchema |

### 10.2 Migration (Tony tự chạy)

| Số | File | Nội dung | Mất dữ liệu? | Rollback |
|---|---|---|---|---|
| 174 | `20261024100000_174_cskh_contact_profile_upgrade.sql` | `contacts.gender`, `education`, `origin_province`, `birthday_remind_days`; nới CHECK `geo_source` (+`manual`, `address_url`) | **Không** — chỉ ADD COLUMN có DEFAULT/NULL; nới CHECK không sửa dòng nào | Có — cuối file (chấm tay đổi nguồn về `address`, giữ toạ độ) |

Đã chạy thử 2 lần liên tiếp trên PGlite: dữ liệu cũ giữ nguyên, CHECK chặn đúng giá trị lạ, rollback chạy được. **App chạy được khi chưa chạy 174**: cột mới chỉ gửi khi đổi; lỗi thiếu cột / CHECK hẹp → ghi lại không kèm cột mới và báo "cần chạy migration 174".

### 10.3 Đã làm

- **Hồ sơ** (`ContactProfileModal`): Giới tính Nam | Nữ + "Gợi ý: Nữ" (tooltip lý do); mục **Ngày sinh & ngày quan trọng** (`OccasionEditor`: loại, tên, ngày/tháng/năm, Âm lịch, Nhắc trước 1/3/7 ngày hoặc chỉ đúng ngày, "Lần tới … còn N ngày · tròn X tuổi", tuổi âm + mệnh + Hợp/kỵ); **Địa chỉ nhà hiện tại** (ô tự cao, link Maps, bản đồ ghim Leaflet chạm/kéo để chấm tay, huy hiệu Chính xác / ~ Tương đối) + Tỉnh nơi ở + **Quê quán (63 tỉnh)** + **Tìm hiểu vùng miền**; **Học vấn** (gợi ý trường người khác đã nhập, "Cùng trường với N người"); **Thông tin chuyên sâu** thu gọn ("đã nhập N mục"): Gia đình (Vợ/Chồng, Con 1–3 + năm sinh → tuổi), Điều cần nhớ (Món ăn / Kiêng kỵ dạng thẻ), Thấu hiểu (Sở thích / Thói quen / Tính cách dạng thẻ dùng chung, MBTI). Iframe Google cũ thay bằng ghim Leaflet.
- **Nhắc khi mở app** (`UpcomingDatesReminder`, mọi trang): mỗi sự kiện nhắc TRƯỚC N ngày (theo từng sự kiện) + ĐÚNG NGÀY, mỗi mốc 1 lần/trình duyệt (`lgvn_occ_alert_seen_<user>`, tự dọn mốc cũ), kiểm lại khi quay lại app sang ngày mới, chỉ người đang chăm sóc. Chưa chạy migration → cách cũ.
- **Ma trận**: lọc Giới tính (cả "Gợi ý Nữ/Nam theo tên"), lọc Đặc điểm ("Golf (5)"), tỉnh khớp cả quê; tìm khớp sở thích / thói quen / tính cách / trường / quê; chọn nhiều → **Ghi tương tác** (mở Ghi cho nhóm chọn sẵn) + **Giới tính…**; phạm vi "Đang chăm sóc · Danh bạ khác · Cả danh bạ · Đã nghỉ"; dòng phụ "6 người đang chăm sóc — chọn từ danh bạ 8 người".
- **Ghi cho nhóm** (`GroupLogModal`, nút ở Dashboard / Nhật ký / thanh chọn nhiều): hành động + dịp (tự gợi ý 20/10, 8/3; thêm "Tri ân khách hàng", "Kỷ niệm hợp tác"), nội dung tự ghép, ngày ≤ hôm nay, quà (tên + giá trị/người); lọc Tất cả/Nữ/Nam (Nữ gồm người đoán "Nữ?", nút lưu xác nhận), Đang chăm sóc / Cả danh bạ, nhóm, **chi nhánh, công ty, chức vụ**, tìm; "Chọn tất cả N người đang lọc". Mỗi người 1 dòng `cskh_logs` + 1 dòng `client_gifts` (người chưa gắn công ty chỉ có nhật ký — báo rõ). Ghi theo lô 200, chung 1 dấu đợt.
- **Đợt ghi nhóm** (`BatchEditModal`): Nhật ký + Dashboard "Gần đây" gom đợt thành 1 dòng; sửa hình thức / nội dung / ngày cả đợt, bỏ người (Hoàn tác trước khi Lưu), thêm người (cùng dấu đợt), xoá cả đợt — **xoá mềm** nhật ký + quà; chỉ người tạo đợt / admin. Dòng lẻ giữ màn sửa cũ (có việc đã hứa ↔ Workspace). Đổi ngày → trigger 170 tính lại ngày tương tác cuối (đã có `UPDATE OF log_date`).
- **Bản đồ** (`MapView`): lớp Công ty / Nơi ở hiện tại / Quê quán (tâm tỉnh, nhớ trong máy); ghim ✓ / ~; popup Mở hồ sơ / Chỉ đường; **Đo khoảng cách** (người, **chi nhánh**, vị trí của tôi; OSRM xanh + chim bay đỏ); **Vị trí của tôi** + "Gần bạn"; **Định vị N** (link Maps trước, rồi tra chữ ~1 người/giây, bấm để dừng; quê: mỗi tỉnh 1 lần).
- **Dashboard**: nút Ghi cho nhóm; "Đang chăm sóc 6 người" (bỏ "/ danh bạ").
- **Server**: `api/resolve-map.ts` (Edge) mở link rút gọn Google Maps — kiểm phiên đăng nhập qua RPC `bds_access_check` (header `x-letsgo-token`, chấp nhận `ok`/`not_admin`), chỉ đi theo chuyển hướng trong tên miền Google, tối đa 5 bước. Dev: `vite.config.ts` phục vụ `/api/resolve-map` như `/api/check-link`. Dùng biến `SUPABASE_URL`/`SUPABASE_ANON_KEY` hoặc `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` trên Vercel.
- **Logic thuần + test** (`src/lib/cskh`): `gender`, `canChi`, `occasions`, `remember` (gia đình), `traits`, `education`, `search` (mở rộng), `nearby`, `mapPoints` (+ `planGeo`: chấm tay > link > tra chữ), `groupLog`, `regionInsight` (Gemini), `provinces`. Test tầng ghi DB: `data/saveProfile.test.ts`, `data/groupLogSave.test.ts`.

### 10.4 Lỗi logic đã sửa kèm

1. Popup nhắc sinh nhật bỏ qua "nhắc trước N ngày" của từng sự kiện và hiện lại mỗi ngày trong 7 ngày → nay 2 mốc (trước N ngày + đúng ngày), mỗi mốc 1 lần.
2. Link Google Maps rút gọn (dán từ điện thoại) không đọc được toạ độ → hồ sơ tra theo chữ và ghi nguồn "address" dù đã có link → nay mở qua server.
3. Tra địa chỉ chỉ thử 1 lần cả chuỗi → nay lùi dần (bỏ số nhà → bỏ phường → từ quận trở đi), không bỏ tên đường.
4. Việc "Chuẩn bị quà" của sinh nhật trong hồ sơ bị **tạo lại hôm sau** nếu người dùng xoá việc đó (kiểm trùng bỏ qua việc đã xoá) → nay tính cả việc đã xoá.
5. Form người liên hệ đầy đủ **xoá cứng** ngày đặc biệt bị bỏ khỏi form (mất loại, người thân, liên kết quà) trong khi mọi nơi khác của CSKH xoá mềm → nay xoá mềm (DB chưa có cột thì xoá như cũ); nhận diện thêm lỗi thiếu cột `PGRST204`.
6. Dashboard / Ma trận so số đang chăm sóc với tổng danh bạ (D3).
7. `pruneSeenKeys` của PRM lấy ngày ở vị trí cố định → sai với id sinh nhật hồ sơ dạng `birthday:<uuid>` → sửa đọc ngày ở áp chót.

### 10.5 Thay đổi hành vi cần biết

- Sự kiện MỚI mặc định nhắc trước **3 ngày** (Tony chốt); sự kiện cũ giữ 7. Sinh nhật trong hồ sơ chưa đặt → 3 ngày (trước đây cố định 7) — đổi được trong hồ sơ sau khi chạy 174.
- Nhãn "Điều cần nhớ → Sở thích, món ăn" đổi thành "Món ăn, đồ uống" (sở thích đã có ô riêng).

### 10.6 Chưa kiểm được / để sau

- Xem bằng trang giả lập (Supabase giả, không ghi DB) ở 1280px và 375px: Dashboard, Ma trận, Ghi cho nhóm, Sửa đợt, Hồ sơ, Bản đồ (đo khoảng cách qua OSRM chạy thật). **Chưa xem được ảnh nền bản đồ và tra Nominatim** vì mạng máy làm việc không vào được `nominatim.openstreetmap.org` / `tile.openstreetmap.org` lúc kiểm; chưa thử `api/resolve-map` trên Vercel thật và "Tìm hiểu vùng miền" với Gemini thật.
- `ContactFormModal` (form chung với hồ sơ Khách hàng) vẫn nhập sở thích kiểu cũ — cùng cách lưu nên thẻ vẫn dùng chung.
- ~~Proxy `api/gemini.ts` không kiểm phiên đăng nhập~~ — **đã sửa 25/10**: hàm dùng chung `api/_letsgoSession.ts` (RPC `bds_access_check`, chấp nhận `ok`/`not_admin`) cho cả `api/gemini.ts` lẫn `api/resolve-map.ts`; `lib/gemini.ts` gửi kèm header `x-letsgo-token` (token đọc qua `lib/sessionToken.ts`); hết phiên → "Phiên đăng nhập đã hết hạn — đăng xuất rồi đăng nhập lại". Test: `src/lib/apiSession.test.ts`. Môi trường dev gọi thẳng Google như cũ nên không bị ảnh hưởng.

## 11. 25–26/10/2026 — nhiều việc tiếp theo + quà ghi từ Nhật ký

### 11.1 Nhiều việc tiếp theo trong 1 dòng nhật ký (migration 175, đã chạy)

- Việc đầu vẫn là `cskh_logs.followup*` / `followup_task_id`; các việc THÊM nằm ở `cskh_logs.extra_task_ids uuid[]` (mỗi id là 1 dòng `work_tasks`). Ghi tương tác và Sửa nhật ký đều thêm / sửa / bỏ được việc (việc đã xong luôn giữ, việc chưa xong bị bỏ thì xoá mềm).
- Tên việc trong Workspace: `[Công ty] CSKH: <việc> — <người>` (`cskhTaskTitle` / `taskActionOf`). Tóm tắt, Nhật ký, hồ sơ, Nhịp độ hiện đủ mọi việc (kể cả đã xong); `expandOpenExtras` đổi việc thêm thành dòng việc `<logId>#<taskId>` chỉ để hiển thị.

### 11.2 Quà tặng ghi từ Ghi tương tác → Lịch sử quà

Trước đây chọn hình thức "Quà tặng" chỉ tạo dòng `cskh_logs`, không có dòng `client_gifts` nên Sự kiện & Quà tặng → Lịch sử quà luôn trống. Nay hình thức "Quà tặng" là **ghi cả 2 thứ cùng lúc**:

- **Form** (`LogGiftFields`, dùng ở `LogInteractionModal` và `QuickLogSheet` khi ghi thủ công): Mình tặng / Họ tặng mình · món quà (bắt buộc) · giá trị VND (tuỳ chọn) · gắn sự kiện (nếu người đó có) · "Đã ghi trước đây" để tránh tặng trùng. Ngày tặng = ngày tương tác, ghi chú quà = nội dung nhật ký.
- **Liên kết dòng nhật ký ↔ món quà: KHÔNG thêm cột / migration.** Cùng cách nhận diện đợt ghi nhóm: cùng `recipient_contact_id` = `contact_id` + CÙNG `created_at` (`giftOfLog` ở `lib/cskh/logGift.ts`, so tới mili-giây). Ghi mới: client tạo 1 dấu thời gian, ghi quà trước rồi ghi nhật ký với `created_at` đó; nhật ký lỗi thì quà vừa ghi + việc đi kèm bị gỡ (quà `is_archived`).
- **Cần công ty**: `client_gifts.client_id` NOT NULL → người chưa gắn công ty không ghi được quà (form báo rõ, nhật ký thường vẫn ghi được ở hình thức khác).
- **Sửa nhật ký** (`updateInteraction(..., gifts)`): đổi ngày / nội dung / món → quà đổi theo; dòng cũ chưa có quà mà điền món → tạo quà mang đúng dấu `created_at` của dòng; đổi sang hình thức khác (có hỏi xác nhận) → quà bị xoá mềm; để trống món của dòng đã có quà → báo lỗi (tránh mất quà lỡ tay). Không truyền `gift` = không đụng quà (dòng thuộc đợt đã đổi hình thức vẫn giữ quà như BatchEditModal đã nói).
- **Xoá nhật ký** (`archiveInteraction(..., gifts)`): xoá mềm luôn món quà kèm (hộp xác nhận nói rõ); khôi phục được ở trang Lịch sử.
- **Hiển thị**: dòng Nhật ký "Quà tặng" có khung "món quà · giá trị · Đã tặng/Đã nhận · có trong Lịch sử quà"; dòng chưa có quà hiện nút "Chưa ghi món quà — bấm để ghi". Đầu trang Sự kiện & Quà tặng có khung "N dòng nhật ký 'Quà tặng' chưa có món quà" (`logsMissingGift`: chỉ dòng lẻ, bỏ dòng thuộc đợt ghi nhóm và quà đã bị xoá có chủ ý) + nút **Ghi món quà** mở Sửa nhật ký — cách bổ sung cho dữ liệu cũ, không ghi hàng loạt vào DB.
- **Chiều ngược — "Ghi quà" riêng ở Sự kiện & Quà tặng (26/10, `saveGift(input, existing, ctx, interactions)` / `archiveGift(g, user, interactions)`)**: ghi mới = ghi quà trước rồi ghi 1 dòng nhật ký `contact_type = 'gift'` cùng dấu `created_at` (Họ tặng mình → `initiated_by = 'them'`, ghi chú quà = nội dung nhật ký; nhật ký lỗi thì quà vừa ghi bị gỡ). Sửa quà → dòng nhật ký đi kèm (nếu có) đổi theo người / công ty / ngày / ghi chú. Xoá quà → xoá mềm cả dòng nhật ký "Quà tặng" kèm (và việc đã hứa chưa xong của dòng đó); hộp xác nhận nói rõ. Tìm dòng đi kèm bằng `logOfGift` — chỉ hình thức "Quà tặng", dòng cùng dấu nhưng đã đổi hình thức khác (đợt ghi nhóm) là lần liên hệ riêng nên không đụng.
- **Hệ quả cần biết**: (1) ngày tặng giờ **không được ở tương lai** (form có `max`, API chặn; quà cũ có ngày tương lai vẫn sửa được món / ghi chú nếu không đổi ngày) — vì dòng nhật ký tính là "đã liên hệ", ngày tương lai làm ngày liên hệ lần cuối nhảy sang tương lai; (2) quà ghi TRƯỚC 26/10 chưa có dòng nhật ký và **không tự bổ sung** — sửa / xoá chúng chỉ đụng quà; (3) sửa 1 món quà trong đợt ghi nhóm sẽ sửa luôn nhật ký của người đó nên người này tách khỏi dòng đợt nếu đổi ngày / ghi chú.
- Test: `lib/cskh/logGift.test.ts`, `modules/cskh/data/logGiftSave.test.ts` (nhật ký → quà), `modules/cskh/data/giftLogSync.test.ts` (quà → nhật ký).
