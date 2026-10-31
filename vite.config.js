import { defineConfig } from "vite";

// Windows 上 "localhost" 可能只解析到 IPv6 ::1，浏览器/代理走 127.0.0.1 时会连不上。
// 显式绑定 IPv4 回环地址；只监听本机，不暴露到局域网。
export default defineConfig({
  server: { host: "127.0.0.1", port: 5391, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
