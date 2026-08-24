import { CloseOutlined } from '@mui/icons-material'
import { Box, Dialog, DialogContent, IconButton } from '@mui/material'
import { Suspense, type ReactNode } from 'react'

import { BaseLoading } from '@/components/base'

interface Props {
  open: boolean
  onClose: () => void
  children: ReactNode
}

// 顶栏按钮弹窗：承载完整页面组件（页面自带 BasePage 标题栏）
export const HeaderPageDialog = ({ open, onClose, children }: Props) => (
  <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
    <DialogContent
      sx={{
        p: 0,
        height: '85vh',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <IconButton
        size="small"
        onClick={onClose}
        sx={{ position: 'absolute', top: 15, right: 14, zIndex: 5 }}
      >
        <CloseOutlined />
      </IconButton>
      <Box
        sx={{
          height: '100%',
          // 给悬浮关闭按钮让出页 header 右上角
          '& .base-page > header': { paddingRight: '56px' },
        }}
      >
        <Suspense
          fallback={
            <Box
              sx={{
                display: 'flex',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <BaseLoading />
            </Box>
          }
        >
          {open ? children : null}
        </Suspense>
      </Box>
    </DialogContent>
  </Dialog>
)
