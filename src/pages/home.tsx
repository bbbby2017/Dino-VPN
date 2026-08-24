import {
  BuildOutlined,
  DnsOutlined,
  HistoryEduOutlined,
  SettingsOutlined,
  SpeedOutlined,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { BasePage } from '@/components/base'
import { EnhancedCard } from '@/components/home/enhanced-card'
import { EnhancedTrafficStats } from '@/components/home/enhanced-traffic-stats'
import { UnifiedControlCard } from '@/components/home/unified-control-card'
import { useProfiles } from '@/hooks/use-profiles'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import {
  enhanceProfiles,
  importProfile,
  patchProfilesConfig,
  restartCore,
  updateProfile,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

// 定义首页卡片设置接口
interface HomeCardsSettings {
  connection: boolean
  traffic: boolean
  info: boolean
  [key: string]: boolean
}

const HomePage = () => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { verge } = useVerge()
  const { profiles, current, mutateProfiles } = useProfiles()
  const { isAdminMode, isSidecarMode } = useSystemState()

  // 运行模式文本
  const runningModeText = useMemo(() => {
    if (isAdminMode && !isSidecarMode) return t('home.components.systemInfo.badges.adminServiceMode')
    if (isAdminMode) return t('home.components.systemInfo.badges.adminMode')
    if (isSidecarMode) return t('home.components.systemInfo.badges.sidecarMode')
    return t('home.components.systemInfo.badges.serviceMode')
  }, [isAdminMode, isSidecarMode, t])

  const autoLaunchEnabled = verge?.enable_auto_launch || false

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

  // Quick-fix button state: prevent re-clicks while update + restart in flight
  const [quickFixLoading, setQuickFixLoading] = useState(false)
  const handleQuickFix = useCallback(async () => {
    const currentUid = profiles?.current
    if (!currentUid) return
    setQuickFixLoading(true)
    try {
      try {
        await updateProfile(currentUid)
      } catch (err) {
        showNotice.error('home.page.quickFix.updateFailed', err)
        return
      }
      try {
        await restartCore()
      } catch (err) {
        showNotice.error('home.page.quickFix.restartFailed', err)
        return
      }
      showNotice.success('home.page.quickFix.success')
    } finally {
      setQuickFixLoading(false)
    }
  }, [profiles])

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
      contentStyle={{ padding: 2 }}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            size="small"
            label={autoLaunchEnabled ? '开机自启' : '未自启'}
            color={autoLaunchEnabled ? 'success' : 'default'}
            variant={autoLaunchEnabled ? 'filled' : 'outlined'}
          />
          <Chip
            size="small"
            label={runningModeText}
            color="primary"
            variant="outlined"
          />
          <Tooltip
            title={
              !profiles?.current ? t('home.page.quickFix.tooltipNoProfile') : ''
            }
            arrow
            disableHoverListener={!!profiles?.current}
            disableFocusListener={!!profiles?.current}
            disableTouchListener={!!profiles?.current}
          >
            <span>
              <Button
                variant="text"
                color="inherit"
                size="small"
                onClick={handleQuickFix}
                disabled={quickFixLoading || !profiles?.current}
                startIcon={
                  quickFixLoading ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <BuildOutlined />
                  )
                }
                sx={{ fontWeight: 'bold' }}
              >
                {t('home.page.quickFix.button')}
              </Button>
            </span>
          </Tooltip>
          <Button
            variant="text"
            color="inherit"
            size="small"
            onClick={() => navigate('/connections')}
            startIcon={<DnsOutlined />}
            sx={{ fontWeight: 'bold' }}
          >
            连接
          </Button>
          <Button
            variant="text"
            color="inherit"
            size="small"
            onClick={() => navigate('/logs')}
            startIcon={<HistoryEduOutlined />}
            sx={{ fontWeight: 'bold' }}
          >
            日志
          </Button>
          <Button
            variant="text"
            color="inherit"
            size="small"
            onClick={() => navigate('/settings')}
            startIcon={<SettingsOutlined />}
            sx={{ fontWeight: 'bold' }}
          >
            设置
          </Button>
        </Box>
      }
    >
      <Grid container spacing={1.5} columns={{ xs: 6, sm: 6, md: 12 }}>
        {criticalCards}

        {nonCriticalCards}
      </Grid>

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
