# Crawl Data Web

Công cụ crawl dữ liệu web bằng thao tác **click-to-select**, không cần viết code hay CSS selector tay. Gồm 3 phần chạy cùng nhau:

- **Chrome Extension** (Manifest V3) — bảng điều khiển nổi trên trang web thật, click chọn item/link/ảnh/field để build "Recipe" (công thức crawl).
- **Local Tool** (Fastify server + React web UI) — import file SQL để tạo workspace MariaDB, map dữ liệu crawl được vào đúng bảng/cột, chạy crawl hàng loạt, và ghi dữ liệu vào database.
- **MariaDB workspace** — mỗi lần import SQL tạo một database riêng biệt, dữ liệu gốc không bao giờ bị sửa trực tiếp.

Toàn bộ giao diện và thông báo lỗi bằng tiếng Việt, hướng tới người dùng không rành kỹ thuật.

## Tính năng chính

- **Point-and-click Recipe builder**: chọn item lặp lại, link trang chi tiết, ảnh đại diện, phân trang, rồi map từng field vào cột SQL — tất cả bằng click trên trang thật, extension tự suy ra CSS selector.
- **Nhiều kiểu lấy dữ liệu cho 1 field**: text, HTML, hằng số cố định, giá trị tự sinh (generated), URL trang đã crawl (kèm quy tắc tìm/thay thế), và **"Vùng dữ liệu"** — chọn 2 mốc làm giới hạn trên/dưới khi nội dung không nằm trong một khung `div` bao riêng; hệ thống lấy đúng phần nằm giữa 2 mốc (dùng DOM Range, không yêu cầu 2 mốc phải cùng cấp cha).
- **Field chỉ có ở trang danh sách** ("list-scoped field"): dữ liệu chỉ xuất hiện ở trang list (không có ở trang chi tiết) vẫn map được, lấy 1 lần trong lúc dò danh sách.
- **Mở rộng lên cấp cha**: nếu click bị trúng phần tử con quá hẹp (vd. click vào 1 đoạn `<p>` trong khi ý muốn là lấy cả khối `div` bao ngoài), bấm 1 nút để mở rộng vùng chọn lên đúng 1 cấp cha mà không cần click lại trên trang.
- **Hỗ trợ site offline (`file://`)**: crawl được cả các bản mirror HTML tĩnh lưu trên máy, không chỉ site online qua `http(s)://`.
- **Phân trang tự nhận diện**: tự suy ra pattern phân trang (theo URL path hoặc query param), không phụ thuộc số trang hiển thị trên site (vốn hay bị thiếu do trang hiện tại không phải link `<a>` thật).
- **Chống trùng dữ liệu khi crawl lại**: cấu hình cột để nhận diện bản ghi đã tồn tại, tránh insert trùng khi chạy lại cùng một crawl.
- **Rollback theo từng lần import**: xoá đúng các dòng do 1 lần "Đưa vào Database" cụ thể tạo ra, không ảnh hưởng dữ liệu khác.
- **Bảng phụ / quan hệ / gallery ảnh / tự tạo danh mục (category)**: hỗ trợ cấu trúc SQL nhiều bảng liên kết, không chỉ 1 bảng phẳng.
- **Tải ảnh về máy**: avatar + gallery, tự thử lại không mã hoá TLS khi gặp lỗi chứng chỉ SSL của server ảnh nguồn.
- **Xuất project**: đóng gói `final.sql`, `delta.sql`, `recipe.json`, log và assets thành 1 file `.zip` để bàn giao.
- Giao diện web theo phong cách tối giản kiểu Apple/iOS, có chuyển đổi sáng/tối.

## Kiến trúc thư mục

```text
crawl-data-web/
├─ apps/
│  ├─ extension/    Chrome MV3 — panel chọn dữ liệu trên trang web thật
│  ├─ server/       Fastify + Playwright + MariaDB — crawl, mapping, import
│  └─ web/          React + Vite — cấu hình workspace, xem kết quả, import
├─ packages/
│  └─ shared/       Type TypeScript dùng chung giữa 3 phần trên
├─ scripts/         Script kiểm tra môi trường / chạy dev
├─ fixtures/        File SQL mẫu để test nhanh khi chưa có SQL thật
└─ workspaces/      Sinh ra lúc chạy (database import, log, assets) — không commit lên git
```

## 1. Môi trường cần cài

| Thành phần | Khuyến nghị |
|---|---|
| Node.js | 24 LTS (repo hỗ trợ 22–26) |
| MariaDB | Community Server 11.8 LTS |
| Chrome/Chromium | Manifest V3 (từ bản 120 trở lên) |

Linux là môi trường phát triển chính — xem `SETUP_LINUX.md` để cài chi tiết từng bước. Hướng dẫn Windows ở `SETUP_WINDOWS.md`.

Kiểm tra nhanh:

```bash
node -v
npm -v
mariadb --version
```

## 2. Cài đặt

```bash
npm install
cp apps/server/.env.example apps/server/.env
```

Sửa `apps/server/.env` theo MariaDB thật của bạn:

```env
MARIADB_HOST=127.0.0.1
MARIADB_PORT=3306
MARIADB_USER=root
MARIADB_PASSWORD=MAT_KHAU_CUA_BAN
```

Nếu lệnh `mariadb`/`mariadb-dump` không có sẵn trong PATH, khai báo đường dẫn trực tiếp bằng `MARIADB_CLI` / `MARIADB_DUMP_CLI` trong `.env`.

Kiểm tra môi trường trước khi chạy:

```bash
npm run check:env
```

## 3. Chạy dev

```bash
npm run dev
```

Lệnh này chạy song song 3 tiến trình:

- **API server**: `http://127.0.0.1:17321`
- **Web UI**: `http://127.0.0.1:5173`
- **Extension build watch**: ghi ra `apps/extension/dist`

Trên Linux có thể dùng thêm helper: `./scripts/start-dev.sh`.

Mở Web UI tại `http://127.0.0.1:5173` để bắt đầu.

## 4. Nạp Chrome Extension

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. **Load unpacked** → chọn thư mục `apps/extension/dist`.

Khi sửa code extension: watch build tự cập nhật `dist`, sau đó vào `chrome://extensions` bấm reload extension, rồi reload lại tab trang web nguồn để content script mới được inject.

## 5. Quy trình sử dụng (tóm tắt)

1. **Web UI** — import file `.sql` để tạo workspace database mới, xác nhận bảng chính/bảng phụ và quan hệ giữa các bảng.
2. **Extension** — mở trang danh sách của site cần crawl, đi qua từng bước: chọn nhóm item lặp lại → chọn link trang chi tiết → chọn ảnh đại diện → thiết lập phân trang → map từng field dữ liệu vào cột SQL → lưu Recipe.
3. **Web UI** — cấu hình thêm: SEO tự động, tải ảnh về máy, cột chống trùng dữ liệu.
4. Chạy **crawl** toàn bộ theo Recipe đã lưu, theo dõi tiến trình.
5. **Đưa vào Database** để ghi dữ liệu đã crawl vào workspace; có thể **rollback** riêng từng lần import nếu cần.
6. **Xuất project** thành file `.zip` để bàn giao hoặc lưu trữ.

## 6. Build & kiểm tra

```bash
npm run typecheck   # type-check cả 3 package
npm run build        # build production cho server/web/extension
```

## 7. Tài liệu khác trong repo

Các file `PHASE*_ACCEPTANCE.md`, `README_PHASE*.md`, `PATCH_NOTES_*.md` ở thư mục gốc là nhật ký kỹ thuật theo từng giai đoạn phát triển — giữ lại để tham khảo lịch sử quyết định, không phải hướng dẫn sử dụng chính.
