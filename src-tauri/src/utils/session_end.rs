//! Windows 会话结束（关机 / 重启 / 注销）时的退出清理
//!
//! 正式构建是 GUI 子系统（`windows_subsystem = "windows"`），没有控制台，
//! 因此 `clash-verge-signal` 里基于 `SetConsoleCtrlHandler` 的 `ctrl_shutdown`
//! / `ctrl_logoff` 永远不会被投递 —— 关机时退出清理不会执行，系统代理设置
//! 残留在注册表里指向已经不存在的本地端口，导致重启后浏览器全部无法联网。
//!
//! Windows 对 GUI 进程是通过向其**顶层窗口**发送 `WM_QUERYENDSESSION` /
//! `WM_ENDSESSION` 来通知会话结束的。这里不复用主窗口，因为轻量模式会调用
//! `WindowManager::destroy_main_window()` 把主窗口销毁（见 `module/lightweight.rs`），
//! 而长期挂机后关机恰好是本问题最常见的场景。所以单独创建一个贯穿进程生命周期
//! 的隐藏顶层窗口专门接收这两个消息。
//!
//! 注意不能用 message-only 窗口（父窗口设为 `HWND_MESSAGE`）：那类窗口收不到
//! `WM_QUERYENDSESSION` 这种面向顶层窗口的通知。

use std::ffi::c_void;

use clash_verge_logging::{Type, logging};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, MSG, RegisterClassW, WM_ENDSESSION,
        WM_QUERYENDSESSION, WNDCLASSW, WS_OVERLAPPED,
    },
};

use crate::feat;

/// 窗口类名与窗口标题（宽字符，以 NUL 结尾）
const CLASS_NAME: &[u16] = &[
    b'D' as u16,
    b'i' as u16,
    b'n' as u16,
    b'o' as u16,
    b'V' as u16,
    b'P' as u16,
    b'N' as u16,
    b'S' as u16,
    b'e' as u16,
    b's' as u16,
    b's' as u16,
    b'i' as u16,
    b'o' as u16,
    b'n' as u16,
    b'W' as u16,
    b'a' as u16,
    b't' as u16,
    b'c' as u16,
    b'h' as u16,
    0,
];

/// 执行退出清理
///
/// 直接复用 `feat::quit()`，与托盘退出、信号退出等路径保持完全一致的清理行为
/// （重置系统代理、关闭 TUN、停止内核），其内部已带超时约束。
fn run_cleanup(reason: &str) {
    logging!(info, Type::System, "[会话结束] {reason}，开始退出清理");
    tauri::async_runtime::block_on(feat::quit());
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        // 询问是否允许结束会话：一律同意，真正的清理放到 WM_ENDSESSION。
        // 此时不做清理，避免别的程序否决关机后我们已经把代理关掉。
        WM_QUERYENDSESSION => 1,
        WM_ENDSESSION => {
            // wparam 非 0 表示会话确实要结束
            if wparam != 0 {
                run_cleanup("收到 WM_ENDSESSION");
            }
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

/// 注册会话结束监听
///
/// 在独立线程里创建隐藏窗口并运行消息循环，不干扰 Tauri 自身的事件循环。
pub fn register() {
    std::thread::Builder::new()
        .name("session-end-watch".into())
        .spawn(|| unsafe {
            let hinstance = GetModuleHandleW(std::ptr::null());

            let mut class: WNDCLASSW = std::mem::zeroed();
            class.lpfnWndProc = Some(wndproc);
            class.hInstance = hinstance;
            class.lpszClassName = CLASS_NAME.as_ptr();

            if RegisterClassW(&class) == 0 {
                logging!(
                    error,
                    Type::System,
                    "[会话结束] 注册窗口类失败，关机时将无法清理系统代理"
                );
                return;
            }

            // 必须是顶层窗口（父窗口为空）才能收到 WM_QUERYENDSESSION；不加 WS_VISIBLE 所以不可见
            let hwnd = CreateWindowExW(
                0,
                CLASS_NAME.as_ptr(),
                CLASS_NAME.as_ptr(),
                WS_OVERLAPPED,
                0,
                0,
                0,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                hinstance,
                std::ptr::null::<c_void>(),
            );

            if hwnd.is_null() {
                logging!(
                    error,
                    Type::System,
                    "[会话结束] 创建隐藏窗口失败，关机时将无法清理系统代理"
                );
                return;
            }

            logging!(info, Type::System, "[会话结束] 监听已就绪");

            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                DispatchMessageW(&msg);
            }
        })
        .ok();
}
