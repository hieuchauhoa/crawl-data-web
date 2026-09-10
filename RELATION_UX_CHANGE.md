# Phase 1 — Relation UX change

Relation Suggestions không còn là luồng chính.

Luồng mới:

1. Chọn Main table.
2. Chọn các Related tables thực sự sẽ thao tác.
3. Khai báo relation trực tiếp bằng `source table.column -> target table.column`.
4. Relation được lưu ngay ở trạng thái confirmed vì đây là cấu hình do người dùng tạo.
5. Auto-detect `id_*` vẫn tồn tại trong `schema.relations`, nhưng chỉ xuất hiện như gợi ý cho relation đang chọn; không tự đưa hàng loạt suggestion vào workspace config.
6. Khi bỏ một Related table, các relation dùng bảng đó được dọn khỏi config.
7. Reset workspace giữ cấu hình bảng/relation của người dùng, chỉ reset dữ liệu DB từ baseline/import-copy.

Ví dụ:

`bmws_product.id_list -> bmws_product_list.id`

`bmws_gallery.id_parent -> bmws_product.id`

`bmws_seo.id_parent -> bmws_product.id`
