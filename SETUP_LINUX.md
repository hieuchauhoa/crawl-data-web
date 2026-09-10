# Crawl Data Web Phase 0 — Setup Linux

Linux được coi là môi trường triển khai chính cho repo Phase 0 này.

## 1. Yêu cầu

- Linux desktop có GUI nếu muốn dùng Chrome/Chromium Extension picker.
- Node.js 24 LTS khuyến nghị (repo hỗ trợ Node 22–26).
- npm.
- MariaDB Server + MariaDB Client.
- Chrome hoặc Chromium hỗ trợ Manifest V3.

> Nếu máy chỉ là Linux server/headless thì Local API/UI vẫn chạy được, nhưng bước click/chọn DOM bằng Extension cần một browser GUI. Phase 3 sau này mới là nơi Playwright crawler chạy độc lập.

## 2. Ubuntu / Debian

### Cài công cụ hệ thống

```bash
sudo apt update
sudo apt install -y curl ca-certificates build-essential mariadb-server mariadb-client
```

Khởi động MariaDB:

```bash
sudo systemctl enable --now mariadb
sudo systemctl status mariadb --no-pager
```

Có thể chạy hardening mặc định:

```bash
sudo mariadb-secure-installation
```

### Node.js 24 bằng nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 24
nvm use 24
node -v
npm -v
```

## 3. Tạo MariaDB account cho Local Tool

Trên nhiều distro Linux, `root` của MariaDB dùng Unix socket nên Node kết nối TCP tới `127.0.0.1` bằng root có thể bị từ chối. Phase 0 nên tạo một account riêng chỉ dùng local development.

Mở MariaDB bằng sudo:

```bash
sudo mariadb
```

Sau đó chạy:

```sql
CREATE USER IF NOT EXISTS 'crawl_admin'@'127.0.0.1' IDENTIFIED BY 'change-this-local-password';
GRANT ALL PRIVILEGES ON *.* TO 'crawl_admin'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```

Thoát:

```sql
exit
```

Test TCP login:

```bash
mariadb -h 127.0.0.1 -P 3306 -u crawl_admin -p -e "SELECT VERSION();"
```

Account này cần quyền tạo/xóa workspace DB và tạo user import tạm. SQL dump không chạy bằng account này; backend tạo một credential ngẫu nhiên chỉ có quyền trên DB workspace rồi xóa sau import.

## 4. Cấu hình repo

Tại thư mục repo:

```bash
npm install
cp apps/server/.env.example apps/server/.env
nano apps/server/.env
```

Cấu hình:

```env
PORT=17321
HOST=127.0.0.1

MARIADB_HOST=127.0.0.1
MARIADB_PORT=3306
MARIADB_USER=crawl_admin
MARIADB_PASSWORD=change-this-local-password
MARIADB_CLI=/usr/bin/mariadb
```

Nếu không biết path:

```bash
command -v mariadb
```

## 5. Kiểm tra môi trường

```bash
npm run check:env
```

Sau đó test MariaDB trực tiếp:

```bash
curl -s http://127.0.0.1:17321/api/health
```

Lệnh `curl` trên chỉ chạy sau khi server đã được start ở bước tiếp theo.

## 6. Chạy Phase 0

```bash
npm run dev
```

Hoặc:

```bash
./scripts/start-dev.sh
```

Các process:

- API: `http://127.0.0.1:17321`
- UI: `http://127.0.0.1:5173`
- Extension watch build: `apps/extension/dist`

Mở UI:

```text
http://127.0.0.1:5173
```

## 7. Load Chrome/Chromium Extension trên Linux

1. Mở `chrome://extensions` (hoặc tương đương trên Chromium).
2. Bật Developer mode.
3. Chọn **Load unpacked**.
4. Chọn thư mục tuyệt đối `apps/extension/dist`.
5. Sau mỗi lần reload extension, reload tab website nguồn để content script được inject lại.

Không dùng `--load-extension` trong script; Chrome hiện không còn khuyến nghị flow đó cho browser thường.

## 8. SQL thật đã xác minh cho Phase 0

File test của dự án: `admin_aiwritter_com.sql`.

Đã xác minh tĩnh file này có các bảng bắt buộc:

- `bmws_product`
- `bmws_news`
- `bmws_seo`

Đặc điểm quan trọng: dump tạo các cột trước, sau đó mới dùng `ALTER TABLE` để thêm primary key và `AUTO_INCREMENT`. Vì vậy nghiệm thu phải dựa vào schema MariaDB **sau import**, đúng với `inspectSchema()` hiện tại.

Các ID auto increment trong dump hiện có mốc:

- `bmws_product`: `AUTO_INCREMENT=152`
- `bmws_news`: `AUTO_INCREMENT=80`
- `bmws_seo`: `AUTO_INCREMENT=301`

File không chứa `CREATE DATABASE`, `DROP DATABASE` hoặc `USE` ở đầu dump theo kiểm tra hiện tại, nhưng backend vẫn tạo `workspace-import.sql` riêng và không sửa file upload gốc.

## 9. Test SQL thật

Trong UI chọn chính file `admin_aiwritter_com.sql` rồi **Import SQL**.

Kết quả bắt buộc:

```text
inputUnchanged = true
bmws_product = found
bmws_news    = found
bmws_seo     = found
```

Sau import, xem các column quan trọng:

```text
bmws_product.namevi
bmws_product.id_cat
bmws_product.regular_price
bmws_news.namevi
bmws_seo.id_parent
bmws_seo.titlevi
bmws_seo.keywordsvi
bmws_seo.descriptionvi
```

## 10. Build / typecheck

```bash
npm run typecheck
npm run build
```

Nếu cả hai pass, extension production output nằm ở:

```text
apps/extension/dist
```

## 11. Lỗi Linux hay gặp

### `Access denied for user 'root'@'localhost'`

Không dùng root socket account. Dùng `crawl_admin@127.0.0.1` như hướng dẫn ở trên.

### `mariadb: command not found`

```bash
sudo apt install mariadb-client
command -v mariadb
```

Rồi đặt `MARIADB_CLI` vào `.env`.

### `ECONNREFUSED 127.0.0.1:3306`

```bash
sudo systemctl restart mariadb
sudo ss -ltnp | grep 3306
```

### Extension không hiện trên website

- kiểm tra `npm run dev` vẫn đang chạy;
- reload extension trong `chrome://extensions`;
- reload tab website;
- kiểm tra Local API tại `http://127.0.0.1:17321/api/health`.

### Linux server không có GUI

Extension UX Phase 0 không thể nghiệm thu trên máy headless thuần. Có thể để server/database chạy trên Linux server, nhưng Extension cần Chrome/Chromium desktop ở cùng máy hoặc phải thay đổi kiến trúc bridge/network — việc đó không nằm trong Phase 0 hiện tại.
