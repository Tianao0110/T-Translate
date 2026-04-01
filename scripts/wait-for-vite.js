// scripts/wait-for-vite.js
// 替代 wait-on，用原生 http 模块轮询 Vite 开发服务器
const http = require('http');

const url = process.argv[2] || 'http://localhost:5173';
const timeout = 30000;
const interval = 500;
const start = Date.now();

function check() {
  const req = http.get(url, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      process.exit(0);
    }
    retry();
  });
  req.on('error', retry);
  req.setTimeout(2000, () => { req.destroy(); retry(); });
}

function retry() {
  if (Date.now() - start > timeout) {
    console.error(`Timeout: ${url} not ready after ${timeout / 1000}s`);
    process.exit(1);
  }
  setTimeout(check, interval);
}

check();
