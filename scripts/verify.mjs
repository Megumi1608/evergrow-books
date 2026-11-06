import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const verifyDir = path.join(root, '.verify');
const userData = path.join(verifyDir, 'user-data');
const exportDir = path.join(verifyDir, 'exports');
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(exportDir, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(exportDir, { recursive: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: root,
  env,
});

const page = await app.firstWindow();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
  console.log('[renderer]', message.type(), message.text());
});
page.on('pageerror', (error) => {
  errors.push(error.message);
  console.log('[pageerror]', error.message);
});

const shot = async (name) => {
  await page.screenshot({ path: path.join(verifyDir, name) });
  console.log('SHOT', name);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
  console.log('OK', message);
};

const stubSaveDialog = async (filePath) => {
  await app.evaluate(async ({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, filePath);
};

await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1200);
await shot('01-dashboard-empty.png');

// Seed demo data
await page.getByRole('button', { name: 'Dùng dữ liệu mẫu' }).click();
await page.waitForSelector('.chart-svg', { timeout: 15000 });
await page.waitForTimeout(4600);
await shot('02-dashboard-data.png');

// Transactions
await page.locator('a.nav-item[href="#/transactions"]').click();
await page.waitForSelector('.tx-table tbody tr', { timeout: 10000 });
await page.waitForTimeout(500);
await shot('03-transactions.png');

// Add transaction modal — 3-step wizard
await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click();
await page.waitForSelector('.wizard-steps');
await page.locator('input[placeholder="Chọn hoặc nhập khách hàng mới"]').fill('Công ty Kiểm Thử');
await page.getByLabel('Số tờ khai').fill('108674195011');
await page.getByLabel('Phí dịch vụ container thu khách').fill('20000000');

const containerCount = page.getByLabel('Số lượng cont');
await containerCount.focus();
await containerCount.fill('5');
await containerCount.fill('');
await containerCount.fill('2');
assert((await containerCount.inputValue()) === '2', 'Số container cho phép xoá và nhập lại');
assert(
  (await page.locator('.expense-calc-total').textContent()).includes('20.000.000'),
  'Tờ khai hiển thị tổng thu nhập',
);

await page.waitForTimeout(300);
await shot('04-transaction-declaration.png');

const next = page.locator('.modal-foot').getByRole('button', { name: 'Tiếp tục' });
await next.click();
await page.locator('.modal-head p').filter({ hasText: 'Bước 2/3' }).waitFor();
await page.getByLabel('Tiền cost (container)').fill('10000000');
await page.getByLabel('VAT của tiền cost').fill('800000');
await page.getByLabel('Phí nâng').fill('1000000');
await page.getByLabel('Phí hải quan').fill('400000');
await page.getByLabel('Chiết khấu').fill('300000');
await page.getByLabel('Khác').fill('200000');
await page.locator('textarea').fill('Chi phí nhập tay khi kiểm tra giao diện');
await page.waitForTimeout(300);
assert(
  (await page.locator('.expense-calc-row').first().textContent()).includes('10.800.000'),
  'Tiền cost + VAT được cộng đúng',
);
assert(
  !(await page.locator('.expense-calc').first().textContent()).includes('Còn lại'),
  'Không còn dòng Còn lại trong mục chi phí',
);
await shot('04b-transaction-expense.png');

await next.click();
await page.locator('.modal-head p').filter({ hasText: 'Bước 3/3' }).waitFor();
await page.waitForTimeout(300);
const profitSummary = await page.locator('.expense-calc').textContent();
assert(profitSummary.includes('21.000.000'), 'Tổng thu nhập = phí thu khách + tiền xe');
assert(profitSummary.includes('12.700.000'), 'Tổng chi phí cộng đủ các khoản');
assert(
  (await page.locator('.wizard-page').textContent()).includes('12.700.000'),
  'Chi phí lưu sổ bằng tổng các khoản',
);
assert(
  (await page.locator('.expense-calc-total').textContent()).includes('8.300.000'),
  'Lợi nhuận = thu nhập − chi phí',
);
await shot('04c-transaction-profit.png');

await page.locator('.modal-foot').getByRole('button', { name: 'Thêm giao dịch' }).click();
await page.waitForSelector('.modal', { state: 'detached', timeout: 10000 });
await page.waitForTimeout(700);
await shot('05-transactions-after-add.png');

// Edit the new transaction to exercise update + service revenue persistence
await page.locator('.tx-table tbody tr').first().click();
await page.waitForSelector('.wizard-steps');
assert(
  (await page.getByLabel('Phí dịch vụ container thu khách').inputValue()).replace(/\D/g, '') ===
    '20000000',
  'Phí dịch vụ thu khách được lưu khi sửa',
);
await page.locator('.modal-foot').getByRole('button', { name: 'Tiếp tục' }).click();
await page.locator('.modal-head p').filter({ hasText: 'Bước 2/3' }).waitFor();
await page.locator('.modal-foot').getByRole('button', { name: 'Tiếp tục' }).click();
await page.locator('.modal-head p').filter({ hasText: 'Bước 3/3' }).waitFor();
await page.locator('.modal-foot').getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.waitForSelector('.modal', { state: 'detached', timeout: 10000 });
await page.waitForTimeout(500);

// Categories
await page.locator('a.nav-item[href="#/categories"]').click();
await page.waitForSelector('.cat-panel', { timeout: 10000 });
await page.waitForTimeout(400);
await shot('06-categories.png');

// Reports
await page.locator('a.nav-item[href="#/reports"]').click();
await page.waitForSelector('.chart-svg', { timeout: 10000 });
await page.waitForTimeout(500);
await shot('07-reports.png');

// Settings
await page.locator('a.nav-item[href="#/settings"]').click();
await page.waitForSelector('.settings-grid', { timeout: 10000 });
await page.waitForTimeout(500);
await shot('08-settings.png');

// Print preview route
await page.evaluate(() => {
  window.location.hash = '/print?from=2026-06-01&to=2026-11-30';
});
await page.waitForSelector('.print-sheet', { timeout: 10000 });
await page.waitForTimeout(600);
await shot('09-print.png');

// Export CSV / XLSX / PDF through the real IPC + save dialog (stubbed)
const range = { from: '2026-06-01', to: '2026-11-30' };
for (const format of ['csv', 'xlsx', 'pdf']) {
  const target = path.join(exportDir, `giao-dich-kiem-tra.${format}`);
  await stubSaveDialog(target);
  const result = await page.evaluate(
    async ({ format, range }) => window.api.exportFile(format, range),
    { format, range },
  );
  assert(result.saved === true, `export ${format} trả về đã lưu`);
  assert(fs.existsSync(target) && fs.statSync(target).size > 100, `tệp ${format} được tạo`);
}

const csv = fs.readFileSync(path.join(exportDir, 'giao-dich-kiem-tra.csv'), 'utf8');
assert(csv.includes('STT,Ngày,Loại,Số TK,Cửa,Đối tác'), 'CSV có tiêu đề chuẩn hóa');
const xlsxHead = fs.readFileSync(path.join(exportDir, 'giao-dich-kiem-tra.xlsx')).subarray(0, 2).toString();
assert(xlsxHead === 'PK', 'XLSX là tệp zip hợp lệ');
const pdfHead = fs.readFileSync(path.join(exportDir, 'giao-dich-kiem-tra.pdf')).subarray(0, 4).toString();
assert(pdfHead === '%PDF', 'PDF có magic header');

// DB backup through IPC
const backupPath = path.join(exportDir, 'backup-kiem-tra.db');
await stubSaveDialog(backupPath);
const backup = await page.evaluate(() => window.api.data.backup());
assert(backup.saved === true && fs.existsSync(backupPath), 'sao lưu SQLite được tạo');
assert(fs.statSync(backupPath).size > 4096, 'tệp sao lưu có dữ liệu');

assert(errors.length === 0, 'không có lỗi console');
console.log('VERIFY COMPLETE');
await app.close();
