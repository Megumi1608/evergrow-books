# Evergrow Books

Sổ thu chi doanh nghiệp gọn nhẹ cho Windows. Toàn bộ dữ liệu nằm trong một tệp SQLite trên máy, không cần tài khoản, không cần máy chủ.

![Tổng quan](docs/dashboard.png)

## Tính năng

- **Tổng quan** theo tháng: thu nhập, chi phí, chênh lệch, biểu đồ 6 tháng và cơ cấu chi phí.
- **Giao dịch**: thêm, sửa, xoá; lọc theo khoảng ngày, loại, danh mục và từ khoá; phân trang.
- **Danh mục** thu/chi có màu nhận diện; chặn xoá danh mục đang được sử dụng.
- **Báo cáo** theo tháng/quý/năm hoặc khoảng tuỳ chọn.
- **Xuất tệp**: CSV (UTF-8 cho Excel), XLSX nhiều sheet, PDF A4.
- **Sao lưu và phục hồi** trực tiếp từ tệp `.db`.
- **Tự động cập nhật** qua GitHub Releases: kiểm tra khi mở app và mỗi 4 giờ, tải ngầm, cài khi khởi động lại.
- **Bộ cài dạng wizard** (NSIS), đóng gói sẵn Electron và SQLite — máy người dùng không cần cài Node.js hay môi trường nào khác.

![Giao dịch](docs/transactions.png)

## Cài đặt

1. Mở trang [Releases](https://github.com/Megumi1608/evergrow-books/releases).
2. Tải `Evergrow-Books-Setup-x.y.z.exe`.
3. Chạy bộ cài, chọn thư mục và hoàn tất wizard.

Yêu cầu: Windows 10/11 x64. Bản cài hiện chưa ký số nên Windows SmartScreen có thể hiện cảnh báo — chọn **More info → Run anyway**.

## Dữ liệu

- Cơ sở dữ liệu: `%APPDATA%\Evergrow Books\evergrow-books.db` (SQLite, chế độ WAL).
- Nút **Mở thư mục** trong Cài đặt đưa thẳng tới tệp đang dùng.
- **Sao lưu** tạo một tệp `.db` độc lập; **Phục hồi** thay thế dữ liệu hiện tại.
- Dữ liệu không được mã hoá. Hãy bảo vệ tệp `.db` và các bản sao lưu.
- Ứng dụng không gửi dữ liệu lên máy chủ. Khi kiểm tra cập nhật, chỉ phiên bản ứng dụng được đối chiếu với GitHub.

## Xuất tệp

| Định dạng | Nội dung |
| --- | --- |
| CSV | Danh sách giao dịch theo bộ lọc hiện tại, có BOM UTF-8 để mở đúng tiếng Việt trong Excel |
| XLSX | Sheet **Giao dịch** (chi tiết) và **Tổng hợp** (thu, chi, chênh lệch, theo danh mục) |
| PDF | Báo cáo A4 theo khoảng ngày: tổng hợp, cơ cấu danh mục, chi tiết tháng và danh sách giao dịch |

## Tự động cập nhật

- App đọc bản phát hành mới nhất từ repo public, tải ngầm qua `electron-updater` và kiểm tra SHA-512 trong `latest.yml`.
- Trạng thái được hiển thị ở thanh bên và trong **Cài đặt → Cập nhật ứng dụng**.
- Khi tải xong, bấm **Khởi động lại & cập nhật**; bản cài cũng được áp dụng khi thoát app.

### Phát hành bản mới

```bash
npm version patch            # tăng phiên bản
npm run build
npx electron-builder --win nsis
gh release create v1.0.1 \
  release/Evergrow-Books-Setup-1.0.1.exe \
  release/latest.yml \
  release/Evergrow-Books-Setup-1.0.1.exe.blockmap \
  --title "Evergrow Books 1.0.1" --notes "Nội dung cập nhật"
```

Luôn tải kèm `latest.yml` và tệp `.blockmap`; thiếu một trong hai thì tự cập nhật sẽ không hoạt động.

## Phát triển

Yêu cầu: Node.js 22+ và npm. Chỉ cần Windows khi đóng gói installer.

```bash
npm install
npm run dev        # Vite + Electron, dữ liệu dev riêng
npm run typecheck
npm run verify     # build, mở Electron thật, chụp ảnh và kiểm tra xuất tệp
npm run dist       # tạo installer NSIS
```

`npm run verify` dùng Playwright để mở app, nạp dữ liệu mẫu, xuất CSV/XLSX/PDF và sao lưu `.db`, sau đó kiểm tra nội dung tệp. Ảnh và tệp kiểm thử nằm trong `.verify/` (không commit).

### Cấu trúc

```
src/main/       Electron main, SQLite, IPC, xuất tệp, updater
src/preload/    Cầu contextBridge có kiểu
src/renderer/   React + TypeScript + Vite
src/shared/     Kiểu dữ liệu và tiện ích dùng chung
scripts/        build, dev, verify, tạo icon
build/          icon.ico / installer assets
```

### Bảo mật

- `contextIsolation`, `sandbox`, không bật `nodeIntegration`.
- IPC chỉ mở các kênh cần thiết; mọi dữ liệu được kiểm tra lại ở main process.
- Truy vấn SQLite dùng tham số; danh mục/giao dịch được ràng buộc bằng khoá ngoại và CHECK constraint.
- Cửa sổ mới và điều hướng ngoài bị chặn; liên kết GitHub được mở qua shell hệ điều hành.

## Giới hạn hiện tại

- Windows x64, một người dùng trên một máy.
- Số tiền là số nguyên đồng (VND), không hỗ trợ tiền tệ khác.
- Không nhập được giao dịch ở tương lai.
- Bản phát hành chưa ký số nên có thể bị SmartScreen cảnh báo.
