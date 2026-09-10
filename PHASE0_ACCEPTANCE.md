# Phase 0 — Acceptance Checklist

Theo Project Charter V1, không chuyển Phase 1 trước khi các tiêu chí sau pass trên máy thật.

## A. Local Tool / SQL

- [ ] Local Tool chạy được tại `127.0.0.1`.
- [ ] MariaDB health PASS.
- [ ] Import SQL thật thành công.
- [ ] SQL input không bị thay đổi (`SHA-256 before == after`).
- [ ] Inspector tìm thấy `bmws_product`.
- [ ] Inspector tìm thấy `bmws_news`.
- [ ] Inspector tìm thấy `bmws_seo`.
- [ ] UI hiển thị columns/type/default/key của các bảng.

## B. Extension Bridge

- [ ] Extension MV3 load unpacked thành công.
- [ ] Floating panel xuất hiện trên website nguồn.
- [ ] Extension hiện CONNECTED.
- [ ] Local UI hiện Extension connected.

## C. List POC

- [ ] Từ Local UI mở được website mẫu.
- [ ] Hover element highlight đúng.
- [ ] Click một product card không điều hướng nhầm trong lúc picker chạy.
- [ ] Repeated detector tìm được group product tương ứng.
- [ ] Local UI nhận được số repeated item.
- [ ] Chọn được Detail URL.

## D. Detail + SEO

- [ ] Bấm Mở Detail điều hướng đúng URL.
- [ ] Chọn được tên sản phẩm.
- [ ] `namevi` về Local UI đúng text.
- [ ] `<title>` được lấy tự động.
- [ ] Meta description được lấy nếu nguồn có.
- [ ] Meta keywords được lấy nếu nguồn có.
- [ ] Canonical được lấy nếu nguồn có.
- [ ] OG/Twitter/robots/JSON-LD được extractor giữ trong state.

## E. Reload

- [ ] Reload Local UI không làm backend crash.
- [ ] Reload target website Extension inject/reconnect lại.
- [ ] Reload Extension + reload page workflow tiếp tục dùng được.
- [ ] Không yêu cầu queue/full crawl persistence ở Phase 0.

## Out of scope — không dùng để chặn Phase 0

- Pagination inference đầy đủ.
- Full crawl.
- Production queue.
- Category/relation resolver đầy đủ.
- Gallery.
- Asset download/rewrite.
- SQL mapping/import record product/news.
