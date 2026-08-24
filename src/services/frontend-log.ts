import { invoke } from '@tauri-apps/api/core'

/**
 * 前端诊断日志：转发到 Rust 端写入日志文件。
 * 用于排查窗口加载卡点（如 IPC 挂起时日志会中断在卡点处），
 * 调用失败时静默忽略，绝不影响业务流程。
 */
export function frontendLog(message: string) {
  invoke('frontend_log', { message }).catch(() => {})
}
