use super::CmdResult;
use crate::core::autostart;
use crate::{cmd::StringifyErr as _, feat, utils::dirs};
use clash_verge_logging::{Type, logging_error};
use smartstring::alias::String;
use tauri::{AppHandle, Manager as _};

/// 打开应用程序所在目录
#[tauri::command]
pub async fn open_app_dir() -> CmdResult<()> {
    let app_dir = dirs::app_home_dir().stringify_err()?;
    open::that(app_dir).stringify_err()
}

/// 打开核心所在目录
#[tauri::command]
pub async fn open_core_dir() -> CmdResult<()> {
    let core_dir = tauri::utils::platform::current_exe().stringify_err()?;
    let core_dir = core_dir.parent().ok_or("failed to get core dir")?;
    open::that(core_dir).stringify_err()
}

/// 打开日志目录
#[tauri::command]
pub async fn open_logs_dir() -> CmdResult<()> {
    let log_dir = dirs::app_logs_dir().stringify_err()?;
    open::that(log_dir).stringify_err()
}

/// 打开网页链接
#[tauri::command]
pub fn open_web_url(url: String) -> CmdResult<()> {
    open::that(url.as_str()).stringify_err()
}

/// 打开/关闭开发者工具
#[tauri::command]
pub fn open_devtools(app_handle: AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        if !window.is_devtools_open() {
            window.open_devtools();
        } else {
            window.close_devtools();
        }
    }
}

/// 顶栏页面子窗口白名单：页面标识 → (窗口标题, 前端路由路径)
/// 窗口 label 统一为 `page-{标识}`，capabilities 按 `page-*` 通配授权；
/// URL 用 `/?window={标识}` 入口页重写方案（见 index.html），与主窗口加载同构
const PAGE_WINDOWS: &[(&str, &str, &str)] = &[
    ("profile", "DinoVPN - 订阅", "/profile"),
    ("connections", "DinoVPN - 连接", "/connections"),
    ("logs", "DinoVPN - 日志", "/logs"),
    ("settings", "DinoVPN - 设置", "/settings"),
];

/// 打开顶栏页面的独立子窗口（订阅/连接/日志/设置）
///
/// 已打开则聚焦（取消最小化并置前），不存在则创建；
/// 子窗口不受主窗口尺寸限制，关闭即销毁（关闭拦截仅针对主窗口）。
#[tauri::command]
pub async fn open_page_window(app_handle: AppHandle, page: String) -> CmdResult<()> {
    use clash_verge_logging::logging;

    let page = page.as_str();
    let Some((key, title, path)) = PAGE_WINDOWS.iter().find(|(key, _, _)| *key == page).copied() else {
        return Err(format!("unknown page: {page}").into());
    };
    let label = format!("page-{key}");

    // 已打开则聚焦，避免重复窗口
    if let Some(window) = app_handle.get_webview_window(&label) {
        logging!(info, Type::Window, "页面子窗口已存在，聚焦: {label}");
        let _ = window.unminimize();
        let _ = window.show();
        logging_error!(Type::Window, window.set_focus());
        return Ok(());
    }

    // 与主窗口保持一致的主题/背景色，避免启动白闪
    let (resolved_theme, background_color, initial_script) =
        crate::utils::resolve::window::resolve_window_theme().await;

    // 入口页与主窗口同构（/?window=xxx），由 index.html 重写到目标路由，
    // 避免子路径在 dev/prod 环境下的加载差异
    let entry_url = format!("/?window={key}");

    logging!(info, Type::Window, "创建页面子窗口: {label} -> {entry_url} ({path})");

    let mut builder = tauri::WebviewWindowBuilder::new(&app_handle, &label, tauri::WebviewUrl::App(entry_url.into()))
        .title(title)
        .center()
        .decorations(crate::utils::resolve::window::DEFAULT_DECORATIONS)
        .inner_size(940.0, 700.0)
        .min_inner_size(520.0, 520.0)
        .visible(true) // 背景色已就绪，直接显示，不依赖页面加载事件
        .initialization_script(&initial_script)
        .general_autofill_enabled(false)
        .on_page_load(move |window, payload| {
            use clash_verge_logging::logging;

            let event = payload.event();
            logging!(info, Type::Window, "页面子窗口加载事件: {} {:?}", window.label(), event);
            if event == tauri::webview::PageLoadEvent::Finished {
                logging_error!(Type::Window, window.set_focus());
            }
        });

    if let Some(theme) = resolved_theme {
        builder = builder.theme(Some(theme));
    }

    builder
        .background_color(background_color)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 前端诊断日志：把 webview 内的关键节点写入 Rust 日志文件，
/// 用于排查子窗口加载卡点（IPC 挂起时日志会中断在卡点处）
#[tauri::command]
pub async fn frontend_log(message: String) {
    use clash_verge_logging::logging;

    logging!(info, Type::Window, "[Frontend] {message}");
}

/// 退出应用
#[tauri::command]
pub async fn exit_app() {
    feat::quit().await;
}

/// 重启应用
#[tauri::command]
pub async fn restart_app() -> CmdResult<()> {
    feat::restart_app().await;
    Ok(())
}

/// 获取便携版标识
#[tauri::command]
pub fn get_portable_flag() -> bool {
    *dirs::PORTABLE_FLAG.get().unwrap_or(&false)
}

/// 获取应用目录
#[tauri::command]
pub fn get_app_dir() -> CmdResult<String> {
    let app_home_dir = dirs::app_home_dir().stringify_err()?.to_string_lossy().into();
    Ok(app_home_dir)
}

/// 获取当前自启动状态
#[tauri::command]
pub fn get_auto_launch_status() -> CmdResult<bool> {
    autostart::get_launch_status().stringify_err()
}

/// 下载图标缓存
#[tauri::command]
pub async fn download_icon_cache(url: String, name: String) -> CmdResult<String> {
    feat::download_icon_cache(url, name).await
}

/// 复制图标文件
#[tauri::command]
pub async fn copy_icon_file(path: String, icon_info: feat::IconInfo) -> CmdResult<String> {
    feat::copy_icon_file(path, icon_info).await
}
