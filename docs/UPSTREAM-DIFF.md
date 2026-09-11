# DinoVPN 相比上游 Clash Verge Rev v2.5.2 的改动

> 基线：[clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev) **v2.5.2**（已合并其全部修复与新功能）
> 本文档基于与 v2.5.2 源码的逐文件比对整理，最后更新：2026-09-11

**一句话总结**：绝大多数差异是品牌字符串替换；真正的行为差异集中在首页/窗口的界面重构、渠道自动配置、Windows 服务冷启动等待、按需 WebSocket 订阅这几处，另外内置自动更新与全部外链入口被彻底移除。

---

## 一、界面与交互（fork 自有实现）

首页被完全重写，是与上游差异最大的部分。

### 单张「快捷控制」卡

`src/components/home/unified-control-card.tsx`（**新增文件**）把上游分散的多张首页卡片合并为一张固定 420px 宽的卡：

- 标题栏：自启状态徽章、运行模式徽章（两者等宽 86px，文案切换不跳动）、服务安装/卸载入口、一键修复按钮
- **普通模式 / 增强模式**（即系统代理 / TUN）：**刻意做成互斥**，同时只能开一个，开其中一个会先关掉另一个
  - 上游允许两者同时开启，这是有意偏离
  - 两个开关共用父级的切换锁，切换期间双双禁用并显示转圈，避免连点触发内核配置校验冲突
  - 切换失败会回滚乐观更新
- 分流模式（规则/全局/直连）、节点选择与延迟检测
- 已选订阅段：订阅名、更新时间、已用/总量、**剩余流量进度条**（无限流量订阅显示 ♾️ 且进度条为满格绿色）

配套改动：`src/components/home/enhanced-card.tsx` 的 `title` / `icon` 改为可选，两者都不传时不渲染左侧区块。

### 右侧内嵌面板取代页面跳转

`src/pages/home.tsx`：顶栏的订阅/连接/日志/设置不再整页跳转，改为在右侧展开内嵌面板，同时把窗口向右加宽 800px（外加 12px 间距）。

- 面板切换带互斥锁，用 ref 而非 state 做判断，避免连点后窗口宽度无法还原
- `src/pages/_layout.tsx`：左侧侧边栏容器被 `display: 'none'` 隐藏，改为纯顶栏布局
- `src/components/base/base-page.tsx`：新增 `headerAlign` 属性（默认 `right`，不影响其他页面），首页顶栏按钮改为左对齐

### 窗口尺寸完全锁定

`src-tauri/src/utils/resolve/window.rs` + `src-tauri/src/lib.rs`：

- 默认尺寸 `940x700` → **`520x760`**
- `resizable(false)` + `maximizable(false)`：鼠标拖拽与最大化按钮均禁用
- 窗口状态插件的 `StateFlags` 排除 `SIZE` 与 `MAXIMIZED`，保证打包后每次启动都是默认尺寸，不被历史状态覆盖（位置、可见性等仍然记忆）
- 仅保留首页展开面板时的程序化加宽

### 其他界面调整

- `src/pages/profiles.tsx`：订阅卡片从 MUI 断点栅格改为容器自适应 CSS Grid（`repeat(auto-fill, minmax(320px, 1fr))`）。原因是 MUI 断点依据**窗口宽度**判断，而该页现在被嵌在 800px 面板里，断点失准导致卡片被压到 190px
- 无可用节点时提供「添加订阅」入口，可重新唤起首启的订阅导入弹窗
- 界面文案去术语化：「代理模式」→「分流模式」、「开启代理」→「普通模式」等

---

## 二、行为差异（后端）

| 位置 | 差异 |
|---|---|
| `src-tauri/src/utils/channel.rs`（**新增**） | 渠道分发机制，见下节 |
| `src-tauri/src/core/service.rs:579` | 新增 `wait_for_service_available_on_startup()`（Windows），以 200ms 间隔、最长 30s 重试探测服务 IPC 命名管道 |
| `src-tauri/src/config/config.rs:83` | 上游无条件检查服务可用性、不可用就关掉 TUN；fork 改为**仅在 TUN 已开启且非管理员**时检查，并调用上述等待逻辑。解决冷启动时命名管道尚未创建就被误判为「服务不可用」、进而把持久化的 TUN 设置关掉的问题 |
| `src-tauri/src/cmd/profile.rs:71` | `import_profile` 返回值由 `()` 改为新导入 profile 的 `uid`，供前端导入后直接选中 |
| `src-tauri/src/core/sysopt.rs` | `reset_sysproxy` 从上游的 `spawn_blocking` 改回在当前异步上下文同步调用（行为回退） |

### 渠道自动配置（fork 最主要的新增业务能力）

`src-tauri/src/utils/channel.rs`，由 `lib.rs` 在启动流程中调用：

1. 从 NSIS 安装器写入的 `installer_name.txt`、或可执行文件名末段解析「渠道 ID」（过滤 setup / portable / x64 等噪声词）
2. 与 `app_home_dir/channel_id.txt` 缓存比对
3. 渠道发生变化时，向 `https://v.dodoj.com/s/{channel_id}` 拉取订阅（15 秒超时），追加到 profile 列表、设为当前配置、强制重载内核并刷新界面
4. 成功后写回缓存

### 前端按需 WebSocket 订阅

`src/hooks/use-log-data.ts`、`use-memory-data.ts`、`use-traffic-data.ts`、`use-mihomo-ws-subscription.ts` 全部新增 `enabled` 开关（为 `false` 时不建立 WS 连接）。`src/pages/logs.tsx` 接收 `active` 并透传，`_layout.tsx` 按当前是否为日志页传入。效果：不在日志页时不再订阅日志 WebSocket。

---

## 三、移除的上游功能

- **内置自动更新彻底关闭**
  - `src-tauri/tauri.conf.json`：删除整个 `updater` 插件配置（pubkey + endpoints），`createUpdaterArtifacts` 置为 `false`
  - `src-tauri/src/utils/resolve/mod.rs`：`init_silent_updater()` 从启动流程移除（函数保留但已无调用点）
  - 目的是避免被上游发布的安装包覆盖安装
  - 注意：`Cargo.toml` 的 `tauri-plugin-updater` 依赖与 `capabilities/desktop.json` 权限**仍保留**
- **外链入口**
  - `src/pages/settings.tsx`：删除设置页右上角 GitHub / 文档 / Telegram 跳转按钮
  - `src/components/setting/mods/update-viewer.tsx`：删除「前往 Release 页」按钮
- **赞助与推广**：删除 `.github/FUNDING.yml`、Issue 模板中指向上游文档/FAQ/Telegram 群的链接、发布说明里的机场推广

---

## 四、品牌改名（纯字符串替换，无行为变化）

以下文件仅把 `Clash Verge` / `clash-verge-rev` 替换为 `DinoVPN` / `dinovpn`，逻辑与上游完全一致：

- **配置文件头注释**：`config/clash.rs`、`config/config.rs`、`config/profiles.rs`、`config/verge.rs`、`core/manager/config.rs`、`utils/init.rs`、`utils/tmpl.rs`
- **标识符与路径**：`utils/dirs.rs`（备份目录 `dinovpn-backup`）、`core/tray/mod.rs`（托盘 ID 与 tooltip）、`utils/schtasks.rs`（计划任务名、`DinoVPN.lnk`）、`utils/init.rs`（URL Scheme 注册表显示名）、`core/backup.rs`（WebDAV User-Agent）、`core/service.rs`（错误文案与 macOS 测试用例路径）、`core/updater.rs`（更新窗口标题）
- **前端**：`src/index.html`（页面标题）、`src/services/api.ts`
- **日志枚举**：`crates/clash-verge-logging/src/lib.rs` 的 `Type::ClashVergeRev` → `Type::DinoVPN`，连带 `utils/resolve/mod.rs` 调用点

> **应用 identifier 保留为 `io.github.clash-verge-rev.clash-verge-rev`**，以兼容既有用户的配置目录与数据。

---

## 五、CI 与发布流程

**`.github/workflows/autobuild.yml`**
- 删除定时 cron，改为纯手动触发（`workflow_dispatch`，无输入参数）
- 发布 tag 由 `autobuild` 改为 **`DinoVPN`**（固定 tag，每次覆盖同一个 release）
- 可复用 workflow 从 `clash-verge-rev/...@dev` 改为本仓库 `./.github/workflows/...`
- 产物名 `Clash.Verge_*` → `DinoVPN_*`，下载地址指向 `bbbby2017/Dino-VPN`
- **删除全部 `TAURI_SIGNING_*` 与 `APPLE_*` 签名/公证环境变量**（不再签名与公证）
- **删除整个 `notify-telegram` job**
- macOS runner 由 `macos-latest` 固定为 `macos-15` / `macos-15-intel`，并为 `x86_64-apple-darwin` 增加 `brew install openssl@3` 与 `OPENSSL_*` / `PKG_CONFIG_PATH` 步骤

**`.github/workflows/release.yml`**：同样的品牌/URL/产物名替换、macOS runner 固定与 OpenSSL 步骤，winget identifier 改 `DinoVPN.DinoVPN`。**签名密钥与 telegram job 在此文件中保留**。仅由 tag push 触发。

**`.github/workflows/check-commit-needs-build.yml`**：`latest.json` 地址由硬编码上游 URL 改为用 `gh release view "$TAG_NAME"` 动态查询本仓库 release 资产。

**`.github/workflows/build-macos-arm.yml`（新增）**：名为 "Build All Platforms" 的手动工作流，用布尔输入勾选 windows_x64/arm64、macos_arm64/x64、linux_x64/arm64/armv7，按需单平台出包。

---

## 六、仓库元数据

- **版本号线独立**：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 从 `2.5.2` 抬到 **`3.2.0`**，不再与上游对齐
- `productName` / `publisher` / 描述字段改为 DinoVPN；`Cargo.toml` 的 `repository` 指向 `bbbby2017/Dino-VPN`
- 锁定内核与服务组件版本：mihomo 与 `clash-verge-service-ipc` 锁定在 v2.3.3，避免服务协议版本不匹配
- `package.json` 的 lint-staged 给 `biome format` 加 `--no-errors-on-unmatched`（避免无匹配文件时 pre-commit 失败）
- Issue 模板条目从 6/5 条精简为 3 条，删除「先试 AutoBuild」条款
- `.gitignore` 增加 `.qoder/`、`.tmp/`、`.tmp-latest.log`

---

## 七、维护提示

**刻意与上游保持零分歧的文件**（改行为时请优先动 fork 自有文件，不要碰这些）：

- `src/components/shared/proxy-control-switches.tsx` —— 设置页的代理/TUN 开关。因此**从设置页仍可把普通模式与增强模式同时打开**，此时首页两个开关会同时显示为开启，属已知且接受的不一致
- `src-tauri/src/feat/config.rs`、`src/components/setting/setting-system.tsx`

**已知的上游缺陷，刻意不修**：

`src-tauri/src/feat/config.rs` 的 `patch_verge` 中，`process_terminated_flags(...).await?` 位于普通块内，`?` 直接从函数返回，导致下方的 `Config::verge().await.discard()` 成为不可达代码。后果是配置应用失败时草稿残留，`latest_arc()` 会读到幽灵值，且下一次成功的 `patch_verge` 会把它一并提交。该文件与上游逐字节一致，**问题源于上游**。当前策略是保持后端跟随上游，改用前端防重入把触发概率压到零。

**pre-commit 钩子的注意点**：

`cargo fmt` 会格式化整个 workspace（不限于暂存文件），但 `Makefile.toml` 的 `git-add` 任务只把 i18n 与生成文件加回暂存区、不含 Rust。因此若某个 `.rs` 文件与 `rustfmt.toml`（`max_width = 120`）不一致，它会在每次 Rust 提交时被重排却永远进不了提交。同时这也意味着**该钩子并不保证提交进仓库的 Rust 代码是格式化过的**。
