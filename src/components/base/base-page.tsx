import { ArrowBack } from '@mui/icons-material'
import { IconButton, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import React, { ReactNode, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { BaseErrorBoundary } from './base-error-boundary'

interface Props {
  title?: React.ReactNode // the page title
  header?: React.ReactNode // something behind title
  contentStyle?: React.CSSProperties
  children?: ReactNode
  full?: boolean
}

export const BasePage: React.FC<Props> = (props) => {
  const { title, header, contentStyle, full, children } = props
  const theme = useTheme()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const isDark = theme.palette.mode === 'dark'

  // 子窗口（顶栏页面窗口）里不显示返回箭头，避免把独立窗口导航回首页
  const isMainWindow = useMemo(
    () => getCurrentWebviewWindow().label === 'main',
    [],
  )

  return (
    <BaseErrorBoundary>
      <div className="base-page">
        <header data-tauri-drag-region="true" style={{ userSelect: 'none' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'auto',
            }}
          >
            {isMainWindow && pathname !== '/' && (
              <IconButton
                onClick={() => navigate('/')}
                edge="start"
                sx={{ mr: 1 }}
                size="small"
              >
                <ArrowBack />
              </IconButton>
            )}
            <Typography
              sx={{ fontSize: '20px', fontWeight: '700 ' }}
              data-tauri-drag-region="true"
            >
              {title}
            </Typography>
          </div>

          <div style={{ pointerEvents: 'auto' }}>{header}</div>
        </header>

        <div
          className={full ? 'base-container no-padding' : 'base-container'}
          style={{ backgroundColor: isDark ? '#1e1f27' : '#ffffff' }}
        >
          <section
            style={{
              backgroundColor: isDark ? '#1e1f27' : 'var(--background-color)',
            }}
          >
            <div className="base-content" style={contentStyle}>
              {children}
            </div>
          </section>
        </div>
      </div>
    </BaseErrorBoundary>
  )
}
