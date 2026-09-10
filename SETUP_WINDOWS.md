# Cài môi trường — Crawl Data Web Phase 0 (Windows)

## 1. Cài Node.js

Baseline của repo: **Node.js 24 LTS**.

Sau khi cài, mở PowerShell mới và kiểm tra:

```powershell
node -v
npm -v
```

Node 22–26 có thể dùng để dev, nhưng nên dùng Node 24 LTS để đồng nhất môi trường.

## 2. Cài MariaDB

Khuyến nghị **MariaDB Community Server 11.8 LTS**.

Trong installer:

- cài Database instance;
- port mặc định: `3306`;
- đặt root password và lưu lại;
- giữ MariaDB chạy dạng Windows Service;
- cài command-line client (`mariadb.exe`).

Kiểm tra:

```powershell
mariadb --version
mariadb -u root -p
```

Nếu PowerShell báo không tìm thấy `mariadb`, không bắt buộc phải sửa PATH. Có thể khai báo đường dẫn CLI trong `.env`, ví dụ:

```env
MARIADB_CLI=C:\Program Files\MariaDB 11.8\bin\mariadb.exe
```

## 3. Cài Chrome

Dùng Google Chrome hoặc Chromium hỗ trợ Manifest V3.

## 4. Giải nén repo

Ví dụ:

```text
D:\Projects\crawl-data-web-phase0
```

Mở PowerShell tại thư mục repo.

## 5. Cài dependencies

```powershell
npm install
```

## 6. Tạo cấu hình Local Tool

```powershell
Copy-Item apps/server/.env.example apps/server/.env
notepad apps/server/.env
```

Sửa:

```env
PORT=17321
HOST=127.0.0.1

MARIADB_HOST=127.0.0.1
MARIADB_PORT=3306
MARIADB_USER=root
MARIADB_PASSWORD=MAT_KHAU_ROOT_CUA_BAN
MARIADB_CLI=
```

Nếu `mariadb.exe` không nằm trong PATH:

```env
MARIADB_CLI=C:\Program Files\MariaDB 11.8\bin\mariadb.exe
```

## 7. Kiểm tra môi trường

```powershell
npm run check:env
```

Cần thấy Node, npm, MariaDB CLI và Chrome ở trạng thái OK.

## 8. Chạy Phase 0

```powershell
npm run dev
```

Các địa chỉ:

```text
Local API: http://127.0.0.1:17321
Local UI : http://127.0.0.1:5173
```

Mở Local UI trong Chrome:

```text
http://127.0.0.1:5173
```

## 9. Load Extension

Sau khi `npm run dev` chạy:

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Bấm **Load unpacked**.
4. Chọn:

```text
<repo>\apps\extension\dist
```

Khi sửa code Extension:

1. build watch tự cập nhật `dist`;
2. bấm Reload trên `chrome://extensions`;
3. reload website đang test.

## 10. Test SQL trước

Có thể dùng fixture đi kèm:

```text
fixtures\phase0-smoke.sql
```

Trên Local UI:

1. Chọn file SQL.
2. Bấm **Import SQL**.
3. Xác nhận thấy:
   - `bmws_product`
   - `bmws_news`
   - `bmws_seo`
4. `Input unchanged` phải PASS.

Sau smoke test, dùng **SQL thật của dự án** để nghiệm thu.

## 11. Test website thật

Trong Local UI để URL:

```text
https://xulynuocbaominh.com/san-pham
```

Bấm **Mở website**.

Floating panel phải xuất hiện bên phải.

### Chọn repeated item

1. Bấm `1 · Chọn item`.
2. Hover product card -> phải highlight.
3. Click card.
4. Panel/Local UI phải hiện số item tương tự.

### Chọn Detail URL

1. Bấm `2 · Chọn detail URL`.
2. Click tên hoặc ảnh có link.
3. Bấm `3 · Mở Detail`.

### Chọn namevi + SEO

1. Trên detail bấm `4 · Chọn namevi`.
2. Click heading tên sản phẩm.
3. Extension tự gửi `namevi` và SEO `<head>` về Local Tool.
4. Local UI phải hiện Title / Description / Keywords / Canonical nếu nguồn có.

## 12. Reload test

- Reload Local UI -> preview cũ vẫn đọc lại từ state.
- Reload website -> Extension inject lại.
- Reload Extension -> sau đó reload website -> Extension reconnect Local Tool.

POC **không** có queue resume/full crawl ở Phase 0.

## 13. Build kiểm tra trước khi commit

```powershell
npm run typecheck
npm run build
```

## 14. Lỗi thường gặp

### `ECONNREFUSED 127.0.0.1:3306`

MariaDB service chưa chạy. Mở `services.msc` và start MariaDB.

### `Access denied for user 'root'`

Sai `MARIADB_PASSWORD` trong `apps/server/.env`.

### Không tìm thấy `mariadb`

Điền `MARIADB_CLI` bằng đường dẫn đầy đủ tới `mariadb.exe`.

### Extension hiện OFFLINE

Kiểm tra `npm run dev` còn chạy, sau đó Reload Extension và reload tab website.

### Port 17321 bị chiếm

```powershell
netstat -ano | findstr :17321
```

Có thể đổi `PORT` trong `.env`, nhưng Phase 0 Extension hiện đang khóa API tại `17321`; nếu đổi port cần sửa `apps/extension/src/background.ts` tương ứng.

### Import SQL lỗi

Local API trả phần cuối stderr của MariaDB CLI. Kiểm tra charset/collation hoặc syntax của dump. Tool chỉ chỉnh bản copy dùng để import; file SQL upload gốc trong workspace được giữ nguyên và hash trước/sau.
