# Các thay đổi và kết quả kiểm tra

Ngày thực hiện: 18/09/2026. Base commit: b5bff4cae6106ef256dd684c5bab550cbca7669f.
Bản ZIP chứa mã đã sửa; không push lên GitHub, không triển khai host công khai.

## Đối chiếu 7 phát hiện của báo cáo

| Mục | Đã sửa | Giới hạn |
|---|---|---|
| 01 — giả mạo quyền phòng | Thay ba relay mở bằng `shared/secure-server.cjs`; đăng nhập giáo viên, HttpOnly/SameSite cookie, ticket một lần, ràng buộc ID + vai trò + phòng, resume capability, allowlist lệnh, private answer result, Origin check, giới hạn payload/rate/phòng. Bỏ hostToken chia sẻ và socket URL từ query. | Danh tính giáo viên hiện dựa vào mật khẩu triển khai, chưa tích hợp Edupia SSO. Teacher tab vẫn chấm điểm; cần backend authority riêng nếu yêu cầu đó là tiêu chí production. |
| 02 — XSS bục trao giải | Escape tên/avatar trong template; validate player ID, giới hạn tên, avatar whitelist phía controller. | Chưa chạy payload trong Chromium; cần nghiệm thu trình duyệt và CSP của host. |
| 03 — binary/text | Giao thức WebSocket gửi JSON text nhất quán; từ chối binary input. | Đã kiểm thử frame text qua mạng localhost. |
| 04 — mất join | Chờ HTTP cấp ticket + WebSocket ready trước khi gửi; queue giới hạn, rejoin khi reconnect, thông báo lỗi kết nối; cache kết quả riêng để retry không chấm lại. | Không bảo đảm phục hồi qua server restart; queue không lưu bền. |
| 05 — đáp án public | Chuyển 5 bộ đề sang `private-content/`; server chỉ cho giáo viên tải `/content.json`; chặn server source/node_modules; bỏ fallback đọc bank trong iframe Tìm Bò. | Phải chạy server được cung cấp. Không public thư mục private hoặc whole repo trên static host. |
| 06 — luật chấm | Kiểm tra playing, roundId, membership, câu hiện tại, option trước khi chấm; bỏ tạo người chơi từ attempt; clamp thời gian; chống lặp. | Luật chạy ở controller giáo viên; relay kiểm soát người được gửi đến controller. |
| 07 — loader | Timeout bao gồm đọc body; nối external abort; giới hạn stream theo byte; chặn redirect; giới hạn URL/schema; bỏ fallback âm thầm sang bộ đề khác. | Nguồn lỗi hiện báo lỗi; giáo viên cần chọn lại nguồn hoặc cấu hình về bộ đề kèm gói. |

## Các sửa liên quan

- Bắn gà dùng cùng WebSocket transport mới, không phụ thuộc Socket.IO chưa nạp. Sửa ba biến UI chưa khai báo khi chuyển sang playing. Giữ ID học sinh và snapshot/khóa chống trùng khi reload giáo viên.
- Ếch tạo mã phòng ngẫu nhiên 6 ký tự và giữ cùng tab; lưu roster/vòng/bank khóa/chống trùng. Khôi phục tiến độ cho iframe qua host message riêng, không sửa SDK.
- Tìm Bò không broadcast history đáp án của học sinh trong roster cho cả lớp; chỉ người đó nhận kết quả đã nộp. Giữ identity cùng tab, snapshot và tiến độ. Python server cũ nay chỉ là launcher của Node server an toàn hơn, không còn mở relay cũ.
- Giữ nguyên học liệu và hình ảnh; 5 file JSON chỉ đổi vị trí, không đổi nội dung. Đập chuột giữ gateway contract cũ. Motorbike/Tower vẫn cần backend riêng cho lớp thật.
- Cài dependencies ở root với lockfile chính xác. ZIP không chứa `.git`, `node_modules` hoặc dữ liệu phiên/mật khẩu.

## Đã chạy

- `npm test`: 7 nhóm kiểm thử PASS.
- Ba kiểm thử tích hợp dùng HTTP/WebSocket thật trên localhost, mỗi game có 1 controller giáo viên + 4 phiên học sinh riêng trong Node VM: join, start, chấm điểm, nộp lặp, không rò đáp án sang học sinh khác.
- Kiểm tra role giả, socket chưa authenticate, room khác, ID bị chiếm, `/content.json` không đăng nhập, server source và node_modules không public.
- Kiểm tra chấm trước start/sai vòng/sai ID/sai câu/sai lựa chọn/trùng attempt; avatar whitelist và template escape.
- Ba loader: nguồn vượt 1 MiB, body chậm quá deadline, external signal đã abort.
- Kiểm tra cú pháp 75 đơn vị JavaScript/module/script inline trong repo: không có lỗi.
- Validate 3 bộ đề legacy với loader mới: ếch 8 câu, bắn gà 10 câu, Tìm Bò 6 câu.

## Chưa chạy / không chứng nhận

Không có kiểm thử giao diện Chromium/mobile, visual QA, audio, hiệu năng, XSS runtime hoặc thao tác người dùng end-to-end. Môi trường không có Chromium và tải browser bị timeout. Không thử 5 thiết bị vật lý, reverse proxy/TLS thực, SSO, database, tải lớn hoặc quét CVE dependency. Không tuyên bố production-ready hoặc mọi hạng mục QA gameplay đã đạt.

Bộ test VM/network xác nhận logic và giao thức; không thay thế nghiệm thu UI và hạ tầng thật. Trước khi dùng trực tuyến, làm các bước cuối trong README.
