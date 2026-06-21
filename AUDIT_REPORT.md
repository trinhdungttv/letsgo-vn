# AUDIT REPORT — Letsgo VN Web App

> Người thực hiện: Security Engineer + Tech Lead review (read-only)
> Ngày: 2026-06-21
> Phạm vi: toàn bộ `src/`, `supabase/migrations/`, config, `.env`, git history
> Trạng thái: **CHỈ PHÂN TÍCH — chưa sửa code, chưa chạy migration, chưa xóa file.**

Stack xác nhận: Vite + React 18 + TypeScript + Tailwind + Supabase (KHÔNG Next.js, KHÔNG Edge Functions). Auth tự quản lý qua bảng `app_users` (không dùng Supabase Auth) → mọi request chạy dưới role `anon`.

**Kết luận tổng quát (đọc trước):** Ứng dụng đang ở **trạng thái không an toàn để chạy production**. Toàn bộ cơ sở dữ liệu (bao gồm tài khoản, mật khẩu, tài chính, khoản vay) **mở công khai cho bất kỳ ai có anon key** — vốn được nhúng trong bundle client. Hệ thống phân quyền granular hiện chỉ là lớp trang trí ở giao diện. Đây là nhóm lỗi phải xử lý trước tiên.

Điểm làm đúng: không có `service_role` key trong source/bundle; `.env` đã được `.gitignore` và **chưa từng** bị commit; truy vấn dùng Supabase client (tham số hóa) nên **không có SQL injection** kiểu nối chuỗi.

---

## A. BẢO MẬT

### [CRITICAL] A1 — Bảng `app_users` cho `anon` toàn quyền: lộ toàn bộ tài khoản + mật khẩu, tạo admin tùy ý
- **File:** `supabase/migrations/20260609013230_001_create_all_tables.sql:182-184`
- **Mô tả:** Policy `appusers_all_anon ON app_users FOR ALL TO anon USING (true) WITH CHECK (true)`. Bất kỳ ai có anon key (công khai trong bundle, xem A4) đều có thể:
  - `supabase.from('app_users').select('*')` → dump **toàn bộ** username, mật khẩu, full_name, role của mọi nhân viên.
  - `insert` một user role `admin` mới, hoặc `update` mật khẩu/role của bất kỳ ai.
- **Vì sao nguy hiểm:** Đây là **account takeover + auth bypass hoàn chỉnh**, không cần đăng nhập. Một người chỉ cần mở DevTools là lấy được anon key rồi gọi thẳng PostgREST. Kết hợp với A2 (mật khẩu plaintext) là thảm họa.
- **Cách sửa đề xuất:**
  - Không bao giờ để bảng chứa credential mở cho `anon`. Chuyển xác thực sang **Supabase Edge Function** (hoặc backend riêng) dùng `service_role` ở phía server; client chỉ gọi function `login(username, password)` trả về token/session, không truy cập trực tiếp `app_users`.
  - Tối thiểu (giải pháp tạm): thu hồi mọi policy `anon` trên `app_users`, chỉ để lại một RPC `SECURITY DEFINER` `verify_login(username, password)` trả về `id, full_name, role` (không trả password), kiểm tra mật khẩu đã hash trong hàm.

### [CRITICAL] A2 — Mật khẩu lưu plaintext, so khớp bằng query trực tiếp
- **File:** `src/lib/auth.tsx:44-50` (`.eq('password', password)`), schema `..._001_create_all_tables.sql:177` (`password TEXT NOT NULL`), seed `..._023_normalize_demo_admin_user.sql`, `AdminPage.tsx:220` (insert plaintext).
- **Mô tả:** Mật khẩu lưu nguyên văn trong cột `password`, và đăng nhập bằng cách `WHERE username=? AND password=?`.
- **Vì sao nguy hiểm:** Khi DB lộ (xem A1) toàn bộ mật khẩu dùng được ngay; nhân viên thường tái sử dụng mật khẩu cho dịch vụ khác. Truy vấn so khớp trực tiếp cũng dễ bị timing/exfil.
- **Cách sửa đề xuất:** Hash mật khẩu bằng **bcrypt/argon2** (qua extension `pgcrypto` hoặc trong Edge Function). So khớp ở server, không bao giờ gửi cột password về client.

### [CRITICAL] A3 — Phân quyền chỉ enforce ở client; toàn bộ DB mở cho `anon` (69 policy `USING (true)`)
- **File:** 69 policy rải khắp `supabase/migrations/*` (vd `..._001:170-171`, `..._037_role_permissions.sql:10-11`, `20260620120000_059_loan_module.sql` mọi bảng). Logic phân quyền duy nhất nằm ở client: `src/lib/auth.tsx:103-112` (`canAccess`) + ẩn/hiện ở `Sidebar.tsx`, `App.tsx`.
- **Mô tả:** Mọi bảng nhạy cảm (`clients`, `finance_records`, `loans`, `payment_history`, `monthly_confirmations`, `proxy_ledger`, `role_permissions`...) đều `FOR ALL TO anon USING (true)`. `canAccess()` chỉ quyết định **hiển thị UI**, không có ràng buộc nào ở DB.
- **Vì sao nguy hiểm:** Một user `kinhdoanh` (hoặc người ngoài) có thể bỏ qua UI, gọi thẳng `supabase.from('finance_records').select('*')` / `from('loans').select('*')` để đọc dữ liệu tài chính/khoản vay mà UI đã "ẩn". Ghi đè cũng được. Phân quyền granular (view/edit/delete/export) **vô hiệu trên thực tế**.
- **Cách sửa đề xuất:** Enforce ở tầng DB. Vì dùng anon key + custom auth, RLS theo `auth.uid()` không khả dụng → lựa chọn:
  - **Tốt nhất:** đưa truy cập dữ liệu nhạy cảm qua Edge Functions có kiểm tra role (service_role ở server), client không gọi trực tiếp.
  - **Hoặc:** chuyển sang Supabase Auth thật để dùng RLS theo `auth.uid()` + bảng `role`.
  - Trước mắt: siết policy theo nhóm bảng (vd module tài chính/khoản vay chỉ cho phép qua RPC `SECURITY DEFINER` có check role truyền vào + xác thực bằng session token, không phải plain `USING (true)`).

### [CRITICAL] A4 — Module "Khoản vay" (admin-only) KHÔNG enforce ở DB
- **File:** `src/lib/auth.tsx:92,97` + `20260620120000_059_loan_module.sql` (mọi bảng `loans`, `monthly_confirmations`, `payment_history`, `proxy_ledger`, `loan_renewals`... đều `FOR ALL TO anon USING (true)`).
- **Mô tả:** Yêu cầu "module nhạy cảm chỉ admin" hiện chỉ được chặn bằng route guard `canAccess` + 1 dòng `role_permissions`. Dữ liệu khoản vay (dư nợ ~68 tỷ, lãi suất, CIC) mở cho anon ở DB.
- **Vì sao nguy hiểm:** Bất kỳ tài khoản nào (kể cả `kinhdoanh`/`ketoan`) hoặc người có anon key đọc/sửa được toàn bộ số liệu khoản vay — đúng loại dữ liệu được mô tả là "cần bảo vệ nhất".
- **Cách sửa đề xuất:** Như A3 — bắt buộc đi qua lớp server có kiểm tra `role = 'admin'` trước khi chạm bảng loan. Không dựa vào route guard.

### [HIGH] A5 — `VITE_GEMINI_API_KEY` bị nhúng vào bundle client
- **File:** `.env` (key `VITE_GEMINI_API_KEY`), `src/lib/gemini.ts:9,122,171` (`...:generateContent?key=${API_KEY}` gọi thẳng từ trình duyệt).
- **Mô tả:** Mọi biến tiền tố `VITE_` được Vite **inline vào JS client** lúc build. Key Gemini xuất hiện trong network request và trong file JS đã ship.
- **Vì sao nguy hiểm:** Bất kỳ ai mở app đều trích được key và dùng cho mục đích riêng → **phát sinh chi phí / cạn quota / lạm dụng** trên tài khoản Google của bạn.
- **Ghi chú kiểm chứng:** `dist/` local hiện không chứa key (có thể build trước khi thêm key), nhưng **cơ chế đảm bảo** mọi build có env này sẽ lộ key. Anon key Supabase thì OK (đúng thiết kế, công khai).
- **Cách sửa đề xuất:** Đưa lời gọi Gemini ra **Edge Function/backend**; client gọi function của bạn, key nằm ở server (biến không có tiền tố `VITE_`). Thu hồi & xoay (rotate) key Gemini hiện tại vì coi như đã lộ.

### [HIGH] A6 — Trang Admin tải nguyên cột `password` (plaintext) về client
- **File:** `src/pages/AdminPage.tsx:143` (`supabase.from('app_users').select('*')`).
- **Mô tả:** `select('*')` bao gồm cột `password` → mảng `users` trong state React của trình duyệt admin chứa mật khẩu plaintext của mọi người.
- **Vì sao nguy hiểm:** Lộ qua React DevTools, memory dump, hoặc extension độc hại. Vi phạm nguyên tắc tối thiểu hóa dữ liệu.
- **Cách sửa đề xuất:** Chỉ `select` các cột cần (`id, username, full_name, role, email, is_active, created_at`). Sau khi đã hash (A2), tuyệt đối không trả password.

### [MEDIUM] A7 — `role_permissions` cho `anon` ghi → tự nâng quyền
- **File:** `supabase/migrations/20260613130000_037_role_permissions.sql:10-11`.
- **Mô tả:** Ai cũng có thể `update role_permissions set level='full'` cho role của mình. (Hệ quả bị A3 che mờ, nhưng vẫn là đường nâng quyền độc lập, kể cả khi A3 được vá một phần.)
- **Cách sửa:** Chỉ cho ghi qua server/Edge Function có check admin; client chỉ `select`.

### [MEDIUM] A8 — Stored XSS qua `rich_notes` (innerHTML)
- **File:** `src/pages/CRMLeads.tsx:27-28` (`ref.current.innerHTML = value`), nguồn dữ liệu `rich_notes` từ DB (`:165,180,425`).
- **Mô tả:** Trình soạn rich-text gán thẳng `innerHTML` bằng `rich_notes` đọc từ bảng `contacts` (mà anon ghi được). Payload kiểu `<img src=x onerror=...>` sẽ thực thi khi mở/sửa contact.
- **Vì sao nguy hiểm:** Một người ghi dữ liệu độc vào `contacts.rich_notes` → chạy script trong trình duyệt nhân viên khác (đánh cắp `localStorage` session, thao tác thay người dùng).
- **Cách sửa:** Sanitize HTML trước khi render (DOMPurify), hoặc chuyển sang lưu/hiển thị dạng text/markdown an toàn.

### [MEDIUM] A9 — Thông tin đăng nhập demo hiển thị công khai + mật khẩu yếu
- **File:** `src/pages/Login.tsx:86-89` (`admin / admin`, `ketoan / ketoan`...).
- **Mô tả:** Trang đăng nhập in sẵn tài khoản/mật khẩu thật, mật khẩu cực yếu (`admin/admin`).
- **Cách sửa:** Bỏ block demo khỏi production; ép đặt lại mật khẩu mạnh cho tài khoản hệ thống.

### [LOW] A10 — Session lưu ở `localStorage`, không hết hạn, role tin tưởng client
- **File:** `src/lib/auth.tsx:53-55,36-42` (`localStorage.setItem('letsgo_user', ...)`).
- **Mô tả:** Object user (gồm `role`) lưu localStorage, đọc lại khi load. Không có hết hạn; sửa tay `role` trong localStorage là "thành admin" ở phía UI (chỉ ảnh hưởng hiển thị, nhưng cũng cho thấy không có nguồn role đáng tin).
- **Cách sửa:** Dùng token có ký + hết hạn từ server; role lấy từ token đã xác thực, không từ localStorage.

### Không áp dụng / đạt yêu cầu
- **A.5 Edge Functions:** Không tồn tại (`supabase/functions/` absent) → không có gì để đánh giá. *(Lưu ý: phần lớn khuyến nghị ở trên là tạo Edge Functions.)*
- **A.7 SQL injection:** Không phát hiện — toàn bộ dùng Supabase query builder (tham số hóa).
- **service_role / secret:** Không có trong `src/`, config, hay git history. `.env` không bị track. ✅

---

## B. LỖI & BUG

### [HIGH] B1 — `npm run typecheck` đỏ: 72 lỗi TypeScript
- **Lệnh:** `npx tsc -p tsconfig.app.json --noEmit` → **72 errors**.
- **Phân loại:**
  - **Type-safety thật sự (nên sửa):**
    - `src/hooks/useAppData.ts:25-83` — `withTimeout()` nhận `PostgrestFilterBuilder` (thenable, không phải `Promise`) → kết quả bị suy ra `unknown`, mất kiểu trên toàn bộ data layer chính (`data`/`error` là `unknown`). Chạy được lúc runtime nhưng mất hết bảo vệ kiểu.
    - `src/pages/Analytics.tsx:5` — import `MARKET_DATA` không tồn tại trong `constants` → **trang sẽ crash nếu được render** (hiện không nằm trong route, xem E1).
    - `src/pages/market/KCNMap.tsx:52-122` — hàng loạt `unknown`/`any` (vd `new` thiếu construct signature) → dễ lỗi runtime khi dữ liệu khác kỳ vọng.
    - `src/components/ContactsTab.tsx:127` — object insert thiếu field so với `Omit<Contact,...>`.
    - `src/pages/CRMBoard.tsx:103`, `CRMPipeline.tsx:84` — ép kiểu `contacts` không an toàn.
  - **Nhiễu (TS6133 unused — ưu tiên thấp):** phần lớn 72 lỗi là biến/import không dùng ở `Workspace.tsx`, `MorningPrioritySection.tsx`, `App.tsx:53`...
- **Vì sao nguy hiểm:** `tsconfig.app.json` bật `strict` + `noUnusedLocals/Parameters`, nên script typecheck luôn fail → mất "lưới an toàn" CI, lỗi thật bị chôn lẫn trong nhiễu.
- **Cách sửa:** Sửa nhóm type-safety trước (đặc biệt `useAppData` — cho `withTimeout` generic đúng kiểu `PromiseLike<T>`), dọn unused sau. Mục tiêu đưa typecheck về 0.

### [MEDIUM] B2 — Nuốt lỗi âm thầm khi tải dữ liệu
- **File:** `src/hooks/useAppData.ts:66-71` (`loadFinance` không đọc `error`), `:80-83` (`loadMarket` chỉ `if (!sr.error) set...`, nhánh lỗi không báo gì).
- **Mô tả:** Nếu tải finance/market lỗi, không `setError`, không toast → người dùng thấy dữ liệu trống mà tưởng "không có dữ liệu".
- **Cách sửa:** Bắt và hiển thị lỗi (toast/empty-error state) cho từng nhánh.

### [MEDIUM] B3 — Đăng nhập không kiểm tra `is_active` → user bị khóa vẫn vào được
- **File:** `src/lib/auth.tsx:44-56` (không có `.eq('is_active', true)`), trong khi `AdminPage.tsx:239-257` có nút Khóa/Mở khóa.
- **Mô tả:** Chức năng "Khóa tài khoản" cập nhật `is_active=false` nhưng login bỏ qua cờ này → khóa không có tác dụng.
- **Cách sửa:** Thêm điều kiện `is_active` vào truy vấn đăng nhập (và sau này vào hàm verify server-side).

### [LOW] B4 — 125 lỗi ESLint (98 `no-explicit-any`, 23 unused, 2 unused-expression)
- **Lệnh:** `npx eslint .` → 125 errors. Cộng vài cảnh báo `react-hooks/exhaustive-deps` (`UserManagement.tsx:39`, `WinLossSection.tsx:54`, `KCNMap.tsx:33`, `PnLProjectTab.tsx:93`, `AdminSettings.tsx:108`...).
- **Mô tả:** `any` rải rác (đặc biệt các tab Market) làm mất kiểm tra kiểu cục bộ. Các `exhaustive-deps` phần lớn là pattern "load once" (rủi ro thấp) nhưng nên xác nhận từng chỗ không tạo stale closure.
- **Cách sửa:** Thay `any` bằng kiểu cụ thể; rà từng `exhaustive-deps` để chắc không gây dữ liệu cũ.

### Đạt yêu cầu
- **Memory leak / cleanup:** `useAppData.ts:86-95` có cờ `active` + cleanup đúng; không tìm thấy subscription/listener nào thiếu cleanup. ✅
- **Race/double-fetch:** data layer chính có guard `active`. (Dev StrictMode vẫn fetch 2 lần do thiếu `useRef` dedupe — chỉ ảnh hưởng dev, không nghiêm trọng.)

---

## C. LOGIC NGHIỆP VỤ

### [MEDIUM] C1 — Lệch ngày do timezone (parse `YYYY-MM-DD` thành UTC, đọc/so theo local UTC+7)
- **File:** `src/lib/format.ts:19-23` (`daysUntil`: `new Date(dateStr)`), `src/lib/paymentDate.ts:63` (`new Date(client.invoice_date)` rồi đọc `.getDate()/.getMonth()`), tương tự `gemini.ts:20` dùng `toISOString().slice(0,7)` (lấy tháng theo UTC).
- **Mô tả:** Chuỗi date-only như `"2026-06-30"` được JS hiểu là **UTC 00:00**. Khi so với `new Date().setHours(0,0,0,0)` (local midnight VN) hoặc khi đọc `.getDate()` ở local (UTC+7), có thể lệch **1 ngày**. Ảnh hưởng: "còn N ngày", trạng thái urgent/overdue, và **ngày thu tiền dự kiến** (`calcExpectedDue`).
- **Vì sao nguy hiểm:** Ngày đến hạn thanh toán/đáo hạn bị lệch 1 ngày → nhắc sai, hoặc trong module khoản vay là **rủi ro CIC** (nộp trễ).
- **Cách sửa:** Chuẩn hóa parse date-only theo local (tự tách `y,m,d` rồi `new Date(y, m-1, d)` như `format.ts:13-17` đã làm đúng), dùng nhất quán toàn bộ. Cân nhắc 1 helper `parseVNDate()` dùng chung.

### [MEDIUM] C2 — `adjustHoliday` chỉ tránh cuối tuần, không có ngày lễ VN (Tết...)
- **File:** `src/lib/paymentDate.ts:24-29` (tên là `holiday` nhưng chỉ check `isWeekend`).
- **Mô tả:** Ngày thu tiền rơi vào lễ (Tết, 30/4, 2/9...) vẫn được coi là ngày làm việc.
- **Cách sửa:** Bổ sung danh sách ngày lễ VN (cấu hình được) vào logic dời ngày.

### [LOW] C3 — Thiếu guard chia 0 / số âm trong tính toán khoản vay
- **File:** `src/lib/loanCalculations.ts:23-27` (`calcEMI`: nếu `termMonths===0` → `principal/0` = Infinity; `Math.pow(1+r,0)-1=0` → chia 0), `src/pages/Loans.tsx` (input số **không có `min=`** → nhập `principal`/`interest_rate` âm được; không chặn `maturity_date < disbursement_date`).
- **Mô tả:** Edge case nhập liệu chưa chặn; EMI với kỳ hạn 0 cho kết quả vô nghĩa.
- **Cách sửa:** Validate `principal>0`, `interest_rate>=0`, `term_months>=1`, `maturity_date>disbursement_date`; guard `termMonths` trong `calcEMI`.

### [LOW] C4 — `monthlyInterest` ước tính theo số ngày của tháng dương lịch
- **File:** `src/lib/loanCalculations.ts:18-21` dùng trong `Loans.tsx` (KPI "Lãi tháng này", cột "Lãi/tháng").
- **Mô tả:** Spec yêu cầu tính lãi theo **số ngày thực giữa các kỳ**; hiện dashboard ước tính bằng "số ngày của tháng hiện tại". Chấp nhận được như con số ước tính, nhưng sẽ lệch với lãi thực tế trong `monthly_confirmations`.
- **Cách sửa:** Khi xây tab "Nhập lãi", tính theo ngày thực giữa 2 lần đóng; ghi rõ KPI là "ước tính".

### [INFO] C5 — State machine khoản vay (pending→confirmed→paid→overdue) CHƯA được hiện thực
- **File:** `src/pages/Loans.tsx` (các tab `input-interest`, `renewal`, `risk`, `proxy`, `cashflow` đang là `PlaceholderTab`).
- **Mô tả:** Schema đã có (`monthly_confirmations.status`, `cic_risk`), nhưng luồng chuyển trạng thái + ràng buộc chưa code → chưa thể audit. **Cần review lại C.2 (state machine) khi các tab này được build**, đặc biệt: chặn `paid` khi chưa `confirmed`, tự đánh `overdue`/`cic_risk` khi quá ngày `payment_day`, và quy tắc "tất toán ≠ xóa" (đã có chặn xóa khi có lịch sử ở `Loans.tsx:handleDelete`, tốt).

### Đạt yêu cầu
- `calcPnl` (`format.ts:157-173`), `WACC` (`Loans.tsx`) có guard mảng rỗng / chia 0. ✅
- `getMonthLast` dùng regex khớp chính xác `^TmWw$` (tránh `T1` ăn nhầm `T10/11/12`). ✅

---

## D. HIỆU NĂNG

### [LOW] D1 — Không có vấn đề N+1 đáng kể; data layer batch tốt
- **Quan sát:** `useAppData.loadClients` gộp labor/manager history bằng `.in('client_id', ids)` (1 query), finance dùng join `select('*, clients(name)')`. Chỉ 1 chỗ `Promise.all(others.map(...))` ở `useContacts.ts:67` nhưng đã song song hóa và bị giới hạn nhỏ. → Không phải N+1 thực sự.

### [LOW] D2 — Thiếu memo/virtualize cho danh sách
- **Mô tả:** Các bảng (Clients, Loans, Market) render trực tiếp; chưa `React.memo`/`useMemo` cho hàng nặng, chưa virtualize. Ở quy mô hiện tại (~40 khách hàng, ~13 khoản vay) **không phải vấn đề**; chỉ lưu ý khi dữ liệu lớn dần.
- **Cách sửa (tương lai):** `useMemo` cho danh sách đã lọc/sắp xếp; virtualize (react-window) khi >200 dòng.

### [LOW] D3 — Double-fetch ở dev (StrictMode)
- **Mô tả:** Thiếu `useRef` dedupe nên một số effect fetch 2 lần trong dev. Không ảnh hưởng production build.

---

## E. CHẤT LƯỢNG & BẢO TRÌ

### [MEDIUM] E1 — Code chết / hỏng: `Analytics.tsx`, `CSKH.tsx`, `Quotes.tsx`
- **File:** `src/pages/Analytics.tsx` (import `MARKET_DATA` không tồn tại → lỗi typecheck, **không** nằm trong route ở `App.tsx`), `src/pages/CSKH.tsx`, `src/pages/Quotes.tsx` (không được route).
- **Mô tả:** File không dùng nhưng vẫn nằm trong `tsconfig include` → góp lỗi typecheck và gây nhầm lẫn.
- **Cách sửa:** Xóa hoặc sửa & nối lại route (tùy ý định). `Analytics.tsx` ít nhất phải sửa import trước khi dùng.

### [MEDIUM] E2 — Business logic + truy cập Supabase nằm rải khắp 40 file page/component
- **Quan sát:** ~40 file gọi `supabase.from(...)` trực tiếp. Khó áp dụng phân quyền/validation tập trung, và là lý do khiến A3 khó vá (không có "1 cửa" data access).
- **Cách sửa:** Gom truy cập dữ liệu nhạy cảm vào lớp service/hook (hoặc Edge Functions) để vừa bảo mật vừa dễ bảo trì.

### [LOW] E3 — Xử lý lỗi cho người dùng cuối chưa đồng nhất
- **Mô tả:** Đa số nơi đã dùng `toast(...)` (tốt), nhưng còn chỗ nuốt lỗi (B2). Lỗi cấp app có `error` state + nút "Thử lại" (`App.tsx:248-260`) — ổn.
- **Cách sửa:** Chuẩn hóa: mọi thao tác ghi/đọc thất bại đều có thông báo thân thiện.

---

## TỔNG KẾT & THỨ TỰ XỬ LÝ ĐỀ XUẤT

### Thống kê theo mức độ
| Mức độ | Số lượng | Mã |
|--------|----------|-----|
| CRITICAL | 4 | A1, A2, A3, A4 |
| HIGH | 3 | A5, A6, B1 |
| MEDIUM | 8 | A7, A8, A9, B2, B3, C1, C2, E1, E2 *(9 mục)* |
| LOW | 7 | A10, B4, C3, C4, D2, D3, E3 |
| INFO/NOTE | 1 | C5 |

*(Đã đạt/không áp dụng: Edge Functions, SQL injection, service_role, memory leak, N+1 — xem chi tiết trong từng nhóm.)*

### Thứ tự xử lý khuyến nghị
1. **Chặn lỗ hổng auth/RLS trước mọi thứ (A1 → A2 → A3 → A4):** đây là rủi ro "mất trắng dữ liệu". Hướng đi gốc: dựng lớp server (Edge Function dùng `service_role`) cho đăng nhập + truy cập dữ liệu nhạy cảm; hash mật khẩu; thu hồi policy `anon` trên `app_users`/`role_permissions`/module tài chính-khoản vay.
2. **Xoay & giấu key (A5) + ngừng trả password về client (A6):** rotate key Gemini, chuyển lời gọi ra server; `select` cột tối thiểu.
3. **Khôi phục lưới an toàn (B1, B3, B2):** đưa typecheck về 0 (ưu tiên nhóm type-safety `useAppData`), thêm check `is_active` khi login, bỏ nuốt lỗi.
4. **Sửa logic ảnh hưởng tiền/ngày (C1, C2, C3):** chuẩn hóa parse ngày VN, thêm ngày lễ, validate input khoản vay.
5. **XSS & dọn dẹp (A8, A9, E1, E2):** sanitize `rich_notes`, bỏ demo creds, xóa/sửa code chết, gom data access.
6. **Đánh bóng (B4, C4, D2, D3, E3) và rà lại C5 khi build tiếp module khoản vay.**

> Lưu ý: rất nhiều mục MEDIUM/HIGH (A6, A7, A8, B2, B3) sẽ tự được giải quyết hoặc giảm rủi ro mạnh khi A1–A4 được vá bằng lớp server. Nên thiết kế hướng sửa A1–A4 trước, rồi các mục còn lại bám theo.

---
*Hết báo cáo. Chưa có thay đổi nào với code/DB. Chờ bạn duyệt để sửa từng phần.*
