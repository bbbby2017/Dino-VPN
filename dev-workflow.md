# 前端热更新开发流程

## 原理

`pnpm dev` 实际执行的是 `tauri dev`，它做了两件事：

1. **编译 Rust 后端** — 构建完整的 Tauri 应用（含系统代理、TUN、服务管理等所有后端能力）
2. **启动 Vite Dev Server** — 前端通过 Vite HMR 运行在 Tauri WebView 中

编译完成后，Tauri 桌面窗口会自动打开。此时修改 `src/` 下的任何前端文件（TSX/TS/CSS/SCSS），**保存即生效**，无需重新编译 Rust。

## 启动命令

```bash
# 确保 cargo 在 PATH 中，然后启动
export PATH="$HOME/.cargo/bin:$PATH" && pnpm dev
```

## 首次编译耗时

- **首次编译**：约 2-3 分钟（需编译 ~1003 个 Rust crate）
- **后续启动**：如果没改 Rust 代码，增量编译几乎秒过

## 为什么不能用 `pnpm web:dev`

`pnpm web:dev` 只启动 Vite，在浏览器中打开 `http://localhost:3000/`。
但前端启动时需要调用 Tauri 后端（`@tauri-apps/api` 的 `invoke`），浏览器里没有 `window.__TAURI__` 环境，所以会卡在 "Loading Clash Verge..." 无法进入主界面。

## 工作流

1. 运行 `export PATH="$HOME/.cargo/bin:$PATH" && pnpm dev`
2. 等待 Rust 编译完成，Tauri 窗口自动弹出
3. 修改 `src/` 下的前端代码，保存后窗口自动热更新
4. 如果修改了 Rust 代码（`src-tauri/`），Tauri 会自动重新编译并重启

## 注意事项

- 开发模式使用 `verge-dev` feature flag（`-f verge-dev`）
- Rust 会开启 `RUST_BACKTRACE=full` 以便调试
- 如果只改前端，整个开发循环是**毫秒级**的热更新
