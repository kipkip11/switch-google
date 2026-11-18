#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import path from 'path';
import { ProfileManager } from './profiles/manager';
import { startApiServer } from './server/api';

// Load .env from project directory or current working directory
dotenv.config();
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const program = new Command();
const manager = new ProfileManager();

program
  .name('switch-google')
  .description('Quản lý đa tài khoản Google, phiên làm việc OAuth2 và cấp API cho bên thứ 3')
  .version('1.0.0');

// Command: login
program
  .command('login [profile_name]')
  .description('Đăng nhập thêm tài khoản Google mới (tự động lấy email làm tên nếu không nhập tên)')
  .action(async (profileName?: string) => {
    try {
      console.log(`Đang mở trình duyệt đăng nhập Google OAuth...`);
      const profile = await manager.loginAndSave(profileName);
      console.log(`\n✓ Đã kết nối thành công tài khoản [${profile.name}] (${profile.email})!`);
      console.log(`Phiên đăng nhập đã được lưu trữ an toàn.`);
    } catch (err: any) {
      console.error(`\n✗ Lỗi đăng nhập: ${err.message}`);
      process.exit(1);
    }
  });

// Command: add-key
program
  .command('add-key <profile_name> <api_key>')
  .description('Thêm tài khoản trực tiếp bằng Google Gemini API Key (từ Google AI Studio)')
  .option('-e, --email <email>', 'Email định danh tài khoản')
  .action((profileName: string, apiKey: string, options: { email?: string }) => {
    try {
      const prof = manager.addApiKeyProfile(profileName, apiKey, options.email);
      console.log(`\n✓ Đã thêm tài khoản [${prof.name}] thành công bằng API Key!`);
    } catch (err: any) {
      console.error(`\n✗ Lỗi: ${err.message}`);
      process.exit(1);
    }
  });

// Command: add-token
program
  .command('add-token <profile_name> <access_token> [refresh_token]')
  .description('Thêm tài khoản trực tiếp bằng Bearer Access Token / Refresh Token')
  .option('-e, --email <email>', 'Email tài khoản', 'manual@google.com')
  .action((profileName: string, accessToken: string, refreshToken?: string, options?: { email?: string }) => {
    try {
      const prof = manager.addDirectTokenProfile(profileName, options?.email || 'manual@google.com', accessToken, refreshToken);
      console.log(`\n✓ Đã thêm tài khoản [${prof.name}] thành công bằng Token!`);
    } catch (err: any) {
      console.error(`\n✗ Lỗi: ${err.message}`);
      process.exit(1);
    }
  });

// Command: list
program
  .command('list')
  .alias('ls')
  .description('Liệt kê danh sách các tài khoản Google đã kết nối')
  .action(() => {
    try {
      const profiles = manager.listProfiles();
      if (profiles.length === 0) {
        console.log('\nChưa có tài khoản nào được kết nối.');
        console.log('Chạy lệnh sau để kết nối tài khoản đầu tiên:');
        console.log('  switch-google login <tên_profile>\n');
        return;
      }

      console.log('\nDanh sách tài khoản Google đã kết nối:\n');
      console.log(
        '  ' +
        'ACTIVE'.padEnd(8) +
        'PROFILE'.padEnd(18) +
        'TYPE'.padEnd(12) +
        'EMAIL'.padEnd(28) +
        'HẾT HẠN TOKEN'.padEnd(25) +
        'TRẠNG THÁI'
      );
      console.log('  ' + '-'.repeat(105));

      for (const p of profiles) {
        const marker = p.isActive ? '  *   ' : '      ';
        const status = p.isExpired ? 'Hết hạn (Sẽ tự refresh)' : 'Hoạt động';
        console.log(
          marker +
          p.name.padEnd(18) +
          p.type.toUpperCase().padEnd(12) +
          p.email.padEnd(28) +
          p.expiresAt.padEnd(25) +
          status
        );
      }
      console.log('\n(*) Đang là tài khoản Active mặc định.');
    } catch (err: any) {
      console.error(`Lỗi: ${err.message}`);
    }
  });

// Command: use
program
  .command('use <profile_name>')
  .description('Chuyển đổi tài khoản đang hoạt động mặc định')
  .action((profileName: string) => {
    try {
      manager.setActiveProfile(profileName);
      console.log(`\n✓ Đã chuyển tài khoản active sang: [${profileName}]`);
    } catch (err: any) {
      console.error(`\n✗ Lỗi: ${err.message}`);
      process.exit(1);
    }
  });

// Command: token
program
  .command('token [profile_name]')
  .description('Lấy Access Token hiện tại (tự động làm mới nếu token hết hạn)')
  .option('-r, --raw', 'Chỉ in ra token thuần để truyền vào script')
  .action(async (profileName: string | undefined, options: { raw?: boolean }) => {
    try {
      const tokenInfo = profileName
        ? await manager.getTokenForProfile(profileName)
        : await manager.getActiveToken();

      if (options.raw) {
        process.stdout.write(tokenInfo.access_token);
      } else {
        console.log(`\n[Profile: ${tokenInfo.profile}] - [Email: ${tokenInfo.email}]`);
        console.log(`Access Token:\n${tokenInfo.access_token}`);
        if (tokenInfo.expiry_date) {
          console.log(`\nHết hạn vào: ${new Date(tokenInfo.expiry_date).toLocaleString()}`);
        }
      }
    } catch (err: any) {
      console.error(`\n✗ Lỗi lấy token: ${err.message}`);
      process.exit(1);
    }
  });

// Command: delete
program
  .command('delete <profile_name>')
  .alias('rm')
  .description('Xóa một tài khoản khỏi danh sách')
  .action((profileName: string) => {
    try {
      const success = manager.deleteProfile(profileName);
      if (success) {
        console.log(`\n✓ Đã xóa profile [${profileName}].`);
      } else {
        console.log(`\nProfile [${profileName}] không tồn tại.`);
      }
    } catch (err: any) {
      console.error(`\n✗ Lỗi: ${err.message}`);
      process.exit(1);
    }
  });

// Command: import-antigravity
program
  .command('import-antigravity')
  .description('Tự động nhập tài khoản Antigravity đang hoạt động từ macOS Keychain')
  .action(() => {
    const prof = manager.importAntigravityKeychainSession();
    if (prof) {
      console.log(`\n✓ Đã kết nối thành công phiên Antigravity: ${prof.name}`);
    } else {
      console.log(`\nKhông tìm thấy phiên Antigravity trong Keychain hoặc hệ thống không hỗ trợ.`);
    }
  });

// Command: serve
program
  .command('serve')
  .description('Khởi chạy Web Dashboard & API Server để bên thứ 3 có thể lấy token hoặc switch tài khoản')
  .option('-p, --port <number>', 'Cổng Web Server', '1909')
  .action((options: { port: string }) => {
    manager.importAntigravityKeychainSession();
    const port = parseInt(options.port, 10) || 1909;
    startApiServer(port);
  });

program.parse(process.argv);
