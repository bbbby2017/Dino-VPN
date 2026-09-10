import {
  CloseOutlined,
  DnsOutlined,
  HistoryEduOutlined,
  RssFeedOutlined,
  SettingsOutlined,
  SpeedOutlined,
} from '@mui/icons-material'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  TextField,
  Typography,
} from '@mui/material'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import type { ComponentType } from 'react'
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseLoading, BasePage } from '@/components/base'
import { EnhancedCard } from '@/components/home/enhanced-card'
import { EnhancedTrafficStats } from '@/components/home/enhanced-traffic-stats'
import { UnifiedControlCard } from '@/components/home/unified-control-card'
import { useProfiles } from '@/hooks/use-profiles'
import { useVerge } from '@/hooks/use-verge'
import {
  enhanceProfiles,
  importProfile,
  patchProfilesConfig,
} from '@/services/cmds'
import { ensureLanguageSections } from '@/services/i18n'

// 定义首页卡片设置接口
interface HomeCardsSettings {
  connection: boolean
  traffic: boolean
  info: boolean
  [key: string]: boolean
}

const PANEL_WIDTH = 800
// 左栏与面板之间的间距，窗口加宽时必须一并计入，否则面板右侧会被裁掉
const PANEL_GAP = 12

const createPanelPage = (
  load: () => Promise<{ default: ComponentType<any> }>,
  sections?: string | readonly string[],
) =>
  lazy(async () => {
    const [mod] = await Promise.all([
      load(),
      sections ? ensureLanguageSections(sections) : Promise.resolve(),
    ])
    return mod
  })

const PANEL_ITEMS = [
  {
    path: '/profile',
    label: '订阅',
    icon: <RssFeedOutlined />,
    Component: createPanelPage(() => import('./profiles'), 'rules'),
  },
  {
    path: '/connections',
    label: '连接',
    icon: <DnsOutlined />,
    Component: createPanelPage(() => import('./connections'), 'connections'),
  },
  {
    path: '/logs',
    label: '日志',
    icon: <HistoryEduOutlined />,
    Component: createPanelPage(() => import('./logs'), 'logs'),
  },
  {
    path: '/settings',
    label: '设置',
    icon: <SettingsOutlined />,
    Component: createPanelPage(() => import('./settings')),
  },
]

const HomePage = () => {
  const { t } = useTranslation()
  const { verge } = useVerge()
  const { profiles, mutateProfiles } = useProfiles()

  // 右侧弹出面板：panelPath 为空表示未展开
  const [panelPath, setPanelPath] = useState<string | null>(null)
  // 面板展开期间把左栏锁成固定宽度，避免窗口变宽/变窄过程中卡片左右跳动
  const [leftWidth, setLeftWidth] = useState<number | null>(null)
  const baseWidthRef = useRef<number | null>(null)
  const leftColumnRef = useRef<HTMLDivElement>(null)
  // 连点顶栏时 panelPath state 可能还没刷新，分支判断走 ref
  const panelPathRef = useRef<string | null>(null)
  const resizingRef = useRef(false)

  const resizeWindowWidth = useCallback(async (width: number) => {
    const win = getCurrentWindow()
    const scale = await win.scaleFactor()
    const inner = (await win.innerSize()).toLogical(scale)
    await win.setSize(new LogicalSize(width, Math.round(inner.height)))
  }, [])

  const handleTogglePanel = useCallback(
    async (path: string) => {
      const currentPath = panelPathRef.current

      // 已展开其它页面 → 仅切换内容，窗口宽度不变
      if (currentPath && currentPath !== path) {
        panelPathRef.current = path
        setPanelPath(path)
        return
      }

      // 宽度调整期间忽略新的展开/收起，否则会记错还原宽度
      if (resizingRef.current) return
      resizingRef.current = true
      try {
        if (currentPath === path) {
          // 收起 → 窗口还原到展开前的宽度
          panelPathRef.current = null
          setPanelPath(null)
          const base = baseWidthRef.current
          baseWidthRef.current = null
          try {
            if (base) await resizeWindowWidth(base)
          } finally {
            setLeftWidth(null)
          }
          return
        }

        // 未展开 → 锁住左栏当前宽度，再把窗口向右加宽
        setLeftWidth(leftColumnRef.current?.offsetWidth ?? null)
        panelPathRef.current = path
        setPanelPath(path)
        const win = getCurrentWindow()
        const scale = await win.scaleFactor()
        const inner = (await win.innerSize()).toLogical(scale)
        const base = Math.round(inner.width)
        baseWidthRef.current = base
        await resizeWindowWidth(base + PANEL_WIDTH + PANEL_GAP)
      } catch (err) {
        console.error('[HomePage] 调整面板窗口宽度失败', err)
      } finally {
        resizingRef.current = false
      }
    },
    [resizeWindowWidth],
  )

  const panelContent = useMemo(() => {
    if (!panelPath) return null
    const item = PANEL_ITEMS.find((entry) => entry.path === panelPath)
    if (!item) return null
    const PanelComponent = item.Component
    // 日志页需要 active 才会建立日志订阅
    return panelPath === '/logs' ? (
      <PanelComponent active />
    ) : (
      <PanelComponent />
    )
  }, [panelPath])

  // Welcome dialog state — derive `welcomeOpen` from profiles + dismissed flag
  // to avoid `setState` calls inside `useEffect` (eslint set-state-in-effect)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  const [subUrl, setSubUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  const welcomeOpen = useMemo(() => {
    if (welcomeDismissed) return false
    if (!profiles) return false
    const items = profiles.items ?? []
    const realProfiles = items.filter(
      (p) => p.type === 'remote' || p.type === 'local',
    )
    return realProfiles.length === 0
  }, [profiles, welcomeDismissed])

  const handleImportSub = useCallback(async () => {
    const url = subUrl.trim()
    if (!url) return
    setImporting(true)
    setImportError('')
    try {
      // 1. import the subscription and get the new profile's UID (requires backend update)
      const newUid = await importProfile(url)

      // 2. explicitly activate the new profile
      if (newUid) {
        await patchProfilesConfig({ current: newUid })
      }

      // 3. refresh UI
      await mutateProfiles()

      // 4. reload core engine
      await new Promise((r) => setTimeout(r, 300))
      await enhanceProfiles()

      setWelcomeDismissed(true)
    } catch (e: any) {
      setImportError(String(e?.message || e || '导入失败'))
    } finally {
      setImporting(false)
    }
  }, [subUrl, mutateProfiles])

  // 卡片显示状态
  const defaultCards = useMemo<HomeCardsSettings>(
    () => ({
      info: false,
      connection: true,
      traffic: false,
    }),
    [],
  )

  const vergeHomeCards = useMemo<HomeCardsSettings | null>(
    () => (verge?.home_cards as HomeCardsSettings | undefined) ?? null,
    [verge],
  )

  const effectiveHomeCards = useMemo<HomeCardsSettings>(
    () => vergeHomeCards ?? defaultCards,
    [defaultCards, vergeHomeCards],
  )

  const renderCard = useCallback(
    (cardKey: string, component: React.ReactNode, size: number = 6) => {
      if (!effectiveHomeCards[cardKey]) return null

      return (
        <Grid size={size} key={cardKey}>
          {component}
        </Grid>
      )
    },
    [effectiveHomeCards],
  )

  const criticalCards = useMemo(() => {
    if (!effectiveHomeCards.connection) return null

    return (
      <Grid size={12} sx={{ display: 'flex', justifyContent: 'center' }}>
        <Box sx={{ width: 420, maxWidth: '100%' }}>
          <UnifiedControlCard />
        </Box>
      </Grid>
    )
  }, [effectiveHomeCards.connection])

  const nonCriticalCards = useMemo(
    () => [
      renderCard(
        'traffic',
        <EnhancedCard
          title={t('home.page.cards.trafficStats')}
          icon={<SpeedOutlined />}
          iconColor="secondary"
        >
          <EnhancedTrafficStats />
        </EnhancedCard>,
        12,
      ),
    ],
    [t, renderCard],
  )
  return (
    <BasePage
      title=""
      headerAlign="left"
      contentStyle={{ padding: 2, height: '100%', boxSizing: 'border-box' }}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {PANEL_ITEMS.map((item) => {
            const active = panelPath === item.path
            return (
              <Button
                key={item.path}
                variant="text"
                color={active ? 'primary' : 'inherit'}
                size="small"
                onClick={() => handleTogglePanel(item.path)}
                startIcon={item.icon}
                sx={{
                  fontWeight: 'bold',
                  bgcolor: active ? 'action.selected' : 'transparent',
                }}
              >
                {item.label}
              </Button>
            )
          })}
        </Box>
      }
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          gap: `${PANEL_GAP}px`,
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <Box
          ref={leftColumnRef}
          sx={{
            width: leftWidth ?? '100%',
            flexShrink: 0,
            overflow: 'auto',
          }}
        >
          <Grid container spacing={1.5} columns={{ xs: 6, sm: 6, md: 12 }}>
            {criticalCards}

            {nonCriticalCards}
          </Grid>
        </Box>

        {panelPath && (
          <Box
            sx={{
              width: PANEL_WIDTH,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 2,
              overflow: 'hidden',
              bgcolor: (theme) =>
                theme.palette.mode === 'dark' ? '#282a36' : '#ffffff',
            }}
          >
            <Box
              sx={{
                px: 1.5,
                py: 0.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: 1,
                borderColor: 'divider',
                flexShrink: 0,
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {PANEL_ITEMS.find((item) => item.path === panelPath)?.label}
              </Typography>
              <IconButton
                size="small"
                onClick={() => handleTogglePanel(panelPath)}
              >
                <CloseOutlined fontSize="small" />
              </IconButton>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
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
                {panelContent}
              </Suspense>
            </Box>
          </Box>
        )}
      </Box>

      {/* 首次启动欢迎弹窗 */}
      <Dialog
        open={welcomeOpen}
        maxWidth="sm"
        fullWidth
        onClose={(_event, reason) => {
          if (reason === 'escapeKeyDown') return
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: 22 }}>
          🎉 欢迎使用Dino-VPN
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2, color: 'text.secondary' }}>
            检测到您是首次启动，请粘贴您的订阅链接以便快速开始：
          </Typography>
          <TextField
            autoFocus
            fullWidth
            variant="outlined"
            placeholder="https://example.com/subscribe?token=xxx"
            value={subUrl}
            onChange={(e) => setSubUrl(e.target.value)}
            disabled={importing}
            error={!!importError}
            helperText={importError || ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && subUrl.trim()) {
                handleImportSub()
              }
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setWelcomeDismissed(true)}
            disabled={importing}
          >
            稍后手动添加
          </Button>
          <Button
            variant="contained"
            onClick={handleImportSub}
            disabled={importing || !subUrl.trim()}
            startIcon={importing ? <CircularProgress size={16} /> : null}
          >
            {importing ? '正在导入...' : '确认导入'}
          </Button>
        </DialogActions>
      </Dialog>
    </BasePage>
  )
}

export default HomePage
