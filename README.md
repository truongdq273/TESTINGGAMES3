# TESTINGGAME2 — bản sửa bảo mật và kết nối

Bản sửa dựa trên commit `b5bff4cae6106ef256dd684c5bab550cbca7669f`.
Đọc `SECURITY-FIXES.md` để xem từng thay đổi và giới hạn đã kiểm thử.
**Hướng dẫn này thay thế phần chạy relay/transport cũ trong các IT-HANDOFF.md.**

## Cài đặt (Windows, macOS, Linux)

Cần Node.js 20 trở lên. Giải nén **toàn bộ** thư mục, mở terminal tại thư mục có README này:

```sh
npm ci
npm test
```

Chỉ cài ở thư mục gốc; không cần cài Express hoặc Socket.IO. Không di chuyển riêng một game ra khỏi gói vì server dùng thư mục `shared/` và `private-content/` ở gốc.

### Windows PowerShell — ví dụ chạy Ếch bắt muỗi

```powershell
$env:TEACHER_PASSWORD = Read-Host 'Dat mat khau giao vien (it nhat 16 ky tu)'
npm run start:frog
```

### macOS / Linux (bash)

```bash
read -r -s -p 'Teacher password (at least 16 characters): ' TEACHER_PASSWORD
export TEACHER_PASSWORD
npm run start:frog
```

Mở `http://localhost:3000/teacher.html`, đăng nhập bằng mật khẩu vừa đặt. Giáo viên mở phòng; học sinh mở `http://localhost:3000/student.html` và nhập mã phòng. Mật khẩu **chỉ cấp cho giáo viên**, không gửi kèm link học sinh. Dùng profile/trình duyệt riêng để thử vai trò học sinh: profile đã đăng nhập giáo viên cũng có quyền tải đáp án.

| Lệnh | Game | Trạng thái |
|---|---|---|
| `npm run start:frog` | Ếch bắt muỗi | Relay có xác thực, hỗ trợ kết nối qua mạng |
| `npm run start:chicken` | Bắn gà | Relay WebSocket có xác thực, thay Socket.IO chưa nối |
| `npm run start:cow` | Tìm Bò | Relay có xác thực; bỏ endpoint lấy từ query `?ws=` |
| `npm run start:motorbike` | Motorbike Runner | Server bảo vệ file đáp án; gameplay vẫn là demo local |
| `npm run start:tower` | Tower Builder | Server bảo vệ file đáp án; gameplay vẫn là demo local |

Chạy mỗi game ở một port/origin riêng. Mặc định port 3000 và chỉ bind `127.0.0.1`. Muốn chạy game khác, dừng tiến trình hiện tại bằng Ctrl+C, hoặc đặt `PORT` khác trước khi chạy.

## Kết nối nhiều máy

Với ba game đầu, IT cấu hình reverse proxy HTTPS/WSS chuyển **cả HTTP và WebSocket `/room-socket`** đến cùng tiến trình Node. Đặt:

```text
HOST=0.0.0.0
PORT=3000
ALLOWED_ORIGINS=https://game.example.edu
TEACHER_PASSWORD=<mat-khau-rieng-toi-thieu-16-ky-tu>
```

`ALLOWED_ORIGINS` là danh sách origin chính xác, phân cách bằng dấu phẩy, không dấu `/` cuối, không wildcard. Mỗi game nên có origin riêng vì cookie và các endpoint ở gốc origin. Không cho trình duyệt gọi HTTP không mã hóa qua Internet. Cookie tự có Secure khi đăng nhập từ origin HTTPS. Bản thử LAN HTTP chỉ dùng trong mạng thử tin cậy.

**Không upload nguyên repo lên CDN/static hosting rồi coi là server.** `private-content/` chứa đáp án và chỉ nằm ở máy chủ. Node phục vụ allowlist file game; `/content.json` được ánh xạ vào thư mục private và yêu cầu phiên giáo viên. Cũng không đưa server-kit Đập chuột lên public.

## Giới hạn kiến trúc được giữ nguyên

- Ếch, bắn gà và Tìm Bò: Node xác thực phiên, quyền phòng, người gửi và người nhận. **Logic chấm điểm vẫn chạy trong tab giáo viên được tin cậy**, không phải một dịch vụ chấm điểm độc lập trên server. Không tin điểm do học sinh gửi. Giữ tab giáo viên mở khi chơi.
- Phiên, membership và cache kết quả retry của relay nằm trong RAM, hết hạn sau tối đa 8 giờ. Khởi động lại Node cần mở phiên/phòng mới. Bản này không bổ sung SSO, database, scale nhiều instance hoặc khôi phục qua server restart.
- Reload cùng tab có giữ identity/progress bằng sessionStorage; đóng tab hoặc xóa dữ liệu trình duyệt không được bảo đảm khôi phục. Điểm đồng bộ qua mạng đã được kiểm thử bằng Node clients; thao tác reload/UI thật còn cần nghiệm thu trình duyệt.
- Motorbike Runner và Tower Builder: `BroadcastChannel/localStorage` chỉ mô phỏng nhiều tab **cùng máy, cùng origin/profile trình duyệt**. Hai thiết bị thật cần backend Room Protocol v1 chưa có trong repo. `server.cjs` mới của hai game này chỉ bảo vệ trang/file; không triển khai Room Protocol v1.
- Đập chuột: thư mục production tiếp tục chờ gateway `/classroom/v1/socket` theo `DAP-CHUOT 1/dap-chuot-server-kit/SERVER-CONTRACT.md`. Không ghép relay mới vào giao thức này.

## IT nghiệm thu trước khi mở lớp thật

1. Thử 1 giáo viên + 4 học sinh trên các profile/thiết bị độc lập; hai phòng khác nhau không nhận tin của nhau.
2. Thử mất mạng, nối lại, reload cùng tab, nộp lặp, kết thúc vòng, bắt đầu vòng mới và mở tab học sinh muộn.
3. Kiểm tra HTTPS/WSS, Origin, đăng nhập giáo viên, private content và hết hạn phiên trên host triển khai thật.
4. Nếu cần server-authoritative scoring/durable sessions/SSO, tích hợp chúng trước khi nghiệm thu production; relay có phân quyền không thay thế các thành phần đó.
