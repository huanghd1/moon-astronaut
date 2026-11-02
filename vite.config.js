import { defineConfig } from "vite";

// Windows 上 "localhost" 可能只解析到 IPv6 ::1，浏览器/代理走 127.0.0.1 时会连不上。
// 显式绑定 IPv4 回环地址；只监听本机，不暴露到局域网。
//
// base：站点部署在域名根目录（Vercel / 自定义域名 / 本地）用 "/"；
// 部署到 GitHub Pages 项目页（https://<用户名>.github.io/<仓库名>/）要用 "/<仓库名>/"。
// 由环境变量 VITE_BASE 控制，GitHub Actions 里会自动设成仓库名，本地和 Vercel 不用设。
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  server: { host: "127.0.0.1", port: 5391, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
