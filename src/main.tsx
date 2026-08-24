import './assets/styles/index.scss'

import { ResizeObserver } from '@juggle/resize-observer'
import { ComposeContextProvider } from 'foxact/compose-context-provider'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { SWRConfig } from 'swr'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

import { BaseErrorBoundary } from './components/base'
import { router } from './pages/_routers'
import { AppDataProvider } from './providers/app-data-provider'
import { WindowProvider } from './providers/window'
import { frontendLog } from './services/frontend-log'
import { FALLBACK_LANGUAGE, initializeLanguage } from './services/i18n'
import {
  preloadAppData,
  resolveThemeMode,
  getPreloadConfig,
} from './services/preload'
import { swrConfig } from './services/query-client'
import {
  LoadingCacheProvider,
  ThemeModeProvider,
  UpdateStateProvider,
} from './services/states'
import { disableWebViewShortcuts } from './utils/disable-webview-shortcuts'

if (!window.ResizeObserver) {
  window.ResizeObserver = ResizeObserver
}

const mainElementId = 'root'
const container = document.getElementById(mainElementId)

if (!container) {
  throw new Error(`No container '${mainElementId}' found to render application`)
}

disableWebViewShortcuts()

const initializeApp = (initialThemeMode: 'light' | 'dark') => {
  const contexts = [
    <ThemeModeProvider key="theme" initialState={initialThemeMode} />,
    <LoadingCacheProvider key="loading" />,
    <UpdateStateProvider key="update" />,
  ]

  const root = createRoot(container)
  root.render(
    <React.StrictMode>
      <ComposeContextProvider contexts={contexts}>
        <BaseErrorBoundary>
          <SWRConfig value={swrConfig}>
            <WindowProvider>
              <AppDataProvider>
                <RouterProvider router={router} />
              </AppDataProvider>
            </WindowProvider>
          </SWRConfig>
        </BaseErrorBoundary>
      </ComposeContextProvider>
    </React.StrictMode>,
  )
}

const bootstrap = async () => {
  frontendLog(`bootstrap 开始: preloadAppData (${location.pathname})`)
  const { initialThemeMode } = await preloadAppData()
  frontendLog('bootstrap 完成: preloadAppData 已 resolve')
  initializeApp(initialThemeMode)
  frontendLog('initializeApp 完成: root.render 已调用')
}

bootstrap().catch((error) => {
  frontendLog(`bootstrap 失败: ${String(error)}`)
  console.error(
    '[main.tsx] App bootstrap failed, falling back to default language:',
    error,
  )
  initializeLanguage(FALLBACK_LANGUAGE)
    .catch((fallbackError) => {
      console.error(
        '[main.tsx] Fallback language initialization failed:',
        fallbackError,
      )
    })
    .finally(() => {
      initializeApp(resolveThemeMode(getPreloadConfig()))
    })
})

// Error handling
window.addEventListener('error', (event) => {
  console.error('[main.tsx] Global error:', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[main.tsx] Unhandled promise rejection:', event.reason)
})

// 全局 WebSocket 单例按主窗口生命周期管理：
// 子窗口加载/关闭时若也执行清理，会把主窗口（及其他子窗口）的 WS 连接全部断掉
const isMainWindow = getCurrentWebviewWindow().label === 'main'
frontendLog(`main.tsx 模块加载完成: label=${getCurrentWebviewWindow().label}`)

// Page close/refresh events
if (isMainWindow) {
  window.addEventListener('beforeunload', () => {
    // Clean up all WebSocket instances to prevent memory leaks
    MihomoWebSocket.cleanupAll()
  })

  // Page loaded event
  window.addEventListener('DOMContentLoaded', () => {
    // Clean up all WebSocket instances to prevent memory leaks
    MihomoWebSocket.cleanupAll()
  })
}
