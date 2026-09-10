# Phase 3 — Simple UX Patch

Mục tiêu: giảm tối đa số thao tác và thuật ngữ kỹ thuật trong Local Tool.

## Thay đổi

- Luồng chính còn 5 bước: SQL → Chọn bảng → Dạy crawler → Test 1 item → Crawl toàn bộ.
- Schema Inspector, Existing Data, Reset, Export và log kỹ thuật được chuyển vào vùng **Công cụ nâng cao**.
- Relation được ẩn trong mục mở rộng ngay bên dưới phần chọn bảng.
- Crawl Runner được làm lại thành hành động chính rõ ràng: **Test 1 item** trước, sau khi pass mới mở **Crawl toàn bộ**.
- Workers đổi từ ô số sang dropdown 1–8, đánh dấu 4 là mức khuyên dùng.
- Queue hiển thị bằng các ô đếm lớn: Trang / Chờ / Đang chạy / Thành công / Lỗi.
- Chỉ hiện URL lỗi ở giao diện chính; queue đầy đủ và log nằm trong phần chi tiết kỹ thuật.
- Thêm hướng dẫn thao tác thân thiện cho Avatar / Gallery / HTML content để thống nhất UX các phase kế tiếp.
- Giữ nguyên backend Phase 3 và patch `page.evaluate/__name` trước đó.
