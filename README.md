<h1 align="center">
  <img src="./src-tauri/icons/icon.png" alt="DinoVPN" width="128" />
  <br>
  DinoVPN
  <br>
</h1>

<h3 align="center">
一款基于 <a href="https://github.com/tauri-apps/tauri">Tauri</a> 与 <a href="https://github.com/MetaCubeX/mihomo">Mihomo</a> 内核的跨平台代理客户端
</h3>

## 简介

DinoVPN 是基于 [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev) 二次开发的桌面代理客户端，采用 Rust + Tauri 2 构建，内置 Mihomo（Clash.Meta）内核，提供订阅管理、代理分组、连接监控、日志、规则编辑与系统代理等能力。

## 功能特性

- 基于性能强劲的 Rust 与 Tauri 2 框架，内置 [Clash.Meta(mihomo)](https://github.com/MetaCubeX/mihomo) 内核。
- 统一的首页快捷控制卡：代理开关、增强模式、代理模式切换、节点选择与延迟检测、订阅摘要一体化。
- 订阅配置管理与增强（Merge 与 Script），配置文件语法提示。
- 系统代理与守卫、`TUN(虚拟网卡)` 模式。
- 可视化节点与规则编辑。
- 流媒体解锁检测（Netflix、Disney+、ChatGPT 等）。
- 多级代理链管理。
- 自定义主题颜色、代理组/托盘图标以及 `CSS Injection`。
- WebDAV 配置备份与同步。

## 技术栈

- **后端**：Rust + Tauri 2，通过 `tauri-plugin-mihomo` 与 Mihomo 内核通信。
- **前端**：React + TypeScript + Vite，UI 基于 MUI。
- **内核**：Mihomo（Clash.Meta），以 sidecar 子进程或 Windows 服务方式运行。

## 开发

在安装好 **Tauri** 所需的全部前置依赖后，执行以下命令启动开发服务器：

```shell
pnpm i
pnpm run prebuild
pnpm dev
```

构建生产安装包：

```shell
pnpm build
```

## 致谢

DinoVPN 基于以下开源项目二次开发或受其启发：

- [clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev)：本项目的上游基线。
- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge)：基于 Tauri 的 Clash GUI。
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri)：更小、更快、更安全的桌面应用框架。
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)：基于 Go 的规则式代理内核。
- [vitejs/vite](https://github.com/vitejs/vite)：新一代前端构建工具。

## 许可证

GPL-3.0 License. 详见 [License](./LICENSE)。

本项目基于 Clash Verge Rev（GPL-3.0）二次开发，遵循 GPL-3.0 协议开源。
