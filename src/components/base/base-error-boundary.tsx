import { ReactNode } from 'react'
import { ErrorBoundary, FallbackProps } from 'react-error-boundary'

import { frontendLog } from '@/services/frontend-log'

function ErrorFallback({ error }: FallbackProps) {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? error.stack : undefined

  return (
    <div role="alert" style={{ padding: 16 }}>
      <h4>Something went wrong:(</h4>

      <pre>{errorMessage}</pre>

      <details title="Error Stack">
        <summary>Error Stack</summary>
        <pre>{errorStack}</pre>
      </details>
    </div>
  )
}

interface Props {
  children?: ReactNode
}

export const BaseErrorBoundary = ({ children }: Props) => {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, info) => {
        // 渲染错误转发到 Rust 日志：页面被 loading overlay 盖住时，错误 UI 用户看不到
        const component = info?.componentStack
          ?.split('\n')
          .find((line) => line.trim().length > 0)
        frontendLog(
          `渲染错误: ${error instanceof Error ? error.message : String(error)}${component ? ` @ ${component.trim()}` : ''}`,
        )
        console.error('[BaseErrorBoundary]', error, info)
      }}
    >
      {children}
    </ErrorBoundary>
  )
}
