import {
  AddModeratorOutlined,
  BuildOutlined,
  NetworkCheckOutlined,
  RemoveModeratorOutlined,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { delayGroup } from 'tauri-plugin-mihomo-api'

import { Switch, TooltipIcon } from '@/components/base'
import { EnhancedCard } from '@/components/home/enhanced-card'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useServiceInstaller } from '@/hooks/use-service-installer'
import { useServiceUninstaller } from '@/hooks/use-service-uninstaller'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import { restartCore, updateProfile } from '@/services/cmds'
import delayManager from '@/services/delay'
import { showNotice } from '@/services/notice-service'
import parseTraffic from '@/utils/parse-traffic'

import { ClashModeCard } from './clash-mode-card'

// ---------- 代理开关区 ----------

const ProxySwitchRow = ({
  label,
  description,
  active,
  onChange,
  disabled,
  pending,
  busy,
}: {
  label: string
  description: string
  active: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** 本行正在处理，显示转圈 */
  pending: boolean
  /** 任一开关正在处理，两行都拦住点击 */
  busy: boolean
}) => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        pt: 1,
        pb: 1.5,
        borderRadius: 1.5,
        // 关闭态用黑色叠加做凹陷感；白色叠加在深色卡片上几乎不可见
        bgcolor: active
          ? alpha(theme.palette.success.main, 0.16)
          : alpha(theme.palette.common.black, isDark ? 0.28 : 0.06),
        transition: 'background-color 0.25s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Typography
        variant="caption"
        sx={{ fontWeight: 600, color: 'text.secondary' }}
      >
        {label}
      </Typography>
      <Box sx={{ position: 'relative', display: 'inline-flex' }}>
        <Box
          sx={{
            // 处理中降低不透明度并拦住点击，配合转圈表达「正在处理」而非「不可用」
            opacity: pending ? 0.45 : 1,
            pointerEvents: busy ? 'none' : 'auto',
            transition: 'opacity 0.2s',
          }}
        >
          <Switch
            checked={active}
            disabled={disabled}
            onChange={(_, v) => onChange(v)}
          />
        </Box>
        {pending && (
          <CircularProgress
            size={18}
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              mt: '-9px',
              ml: '-9px',
            }}
          />
        )}
      </Box>
      <Typography
        sx={{
          mt: 0.25,
          // 撑满剩余高度并居中，使行数较少的说明也不会贴顶
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          lineHeight: 1.4,
          color: 'text.secondary',
          textAlign: 'center',
          whiteSpace: 'pre-line',
        }}
      >
        {description}
      </Typography>
    </Box>
  )
}

// ---------- 节点选择区 ----------

const STORAGE_KEY_GROUP = 'clash-verge-selected-proxy-group'
const STORAGE_KEY_PROXY = 'clash-verge-selected-proxy'

function convertDelayColor(
  delayValue: number,
): 'success' | 'warning' | 'error' | 'default' {
  const colorStr = delayManager.formatDelayColor(delayValue)
  if (!colorStr) return 'default'
  const main = colorStr.split('.')[0]
  if (main === 'success') return 'success'
  if (main === 'warning') return 'warning'
  if (main === 'error') return 'error'
  return 'default'
}

const NodeSelector = () => {
  const { t } = useTranslation()
  const { proxies } = useProxiesData()
  const { clashConfig } = useClashConfigData()
  const { refreshProxy } = useAppRefreshers()
  const { verge } = useVerge()

  const { handleSelectChange } = useProxySelection({
    onSuccess: () => refreshProxy(),
    onError: () => refreshProxy(),
  })

  const mode = (clashConfig?.mode as string)?.toLowerCase() || 'rule'
  const isGlobalMode = mode === 'global'
  const isDirectMode = mode === 'direct'

  // Derive groups & proxies from the raw proxies data
  type ProxyGroup = { name: string; now: string; all: any[] }
  const groups: ProxyGroup[] = useMemo(
    () => (proxies as any)?.groups ?? [],
    [proxies],
  )
  const records: Record<string, any> = useMemo(
    () => (proxies as any)?.records ?? {},
    [proxies],
  )

  const [selectedGroup, setSelectedGroup] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_GROUP)
    return saved || ''
  })
  const [selectedProxy, setSelectedProxy] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_PROXY)
    return saved || ''
  })
  const [testing, setTesting] = useState(false)

  // 订阅切换后旧的选中项可能已不存在，这里回退而不是用 effect 回写 state
  const activeGroup = useMemo(() => {
    if (
      selectedGroup &&
      groups.some((g: ProxyGroup) => g.name === selectedGroup)
    )
      return selectedGroup
    return groups[0]?.name ?? ''
  }, [groups, selectedGroup])

  const currentGroupData = useMemo(
    () => groups.find((g: ProxyGroup) => g.name === activeGroup),
    [groups, activeGroup],
  )

  const proxyOptions: string[] = useMemo(() => {
    const extractNames = (all: any[]): string[] =>
      all
        .map((item) => (typeof item === 'string' ? item : (item?.name ?? '')))
        .filter(Boolean)

    if (isGlobalMode) {
      const globalGroup = groups.find(
        (g: ProxyGroup) => g.name === 'GLOBAL' || g.name === 'global',
      )
      return extractNames(globalGroup?.all ?? [])
    }
    return extractNames(currentGroupData?.all ?? [])
  }, [isGlobalMode, groups, currentGroupData])

  const activeProxy = useMemo(() => {
    if (selectedProxy && proxyOptions.includes(selectedProxy))
      return selectedProxy
    return currentGroupData?.now ?? ''
  }, [selectedProxy, proxyOptions, currentGroupData])

  const handleGroupChange = useCallback(
    (e: SelectChangeEvent<string>) => {
      if (isGlobalMode || isDirectMode) return
      const v = e.target.value
      setSelectedGroup(v)
      localStorage.setItem(STORAGE_KEY_GROUP, v)
      const group = groups.find((g: ProxyGroup) => g.name === v)
      if (group?.now) {
        setSelectedProxy(group.now)
        localStorage.setItem(STORAGE_KEY_PROXY, group.now)
      }
    },
    [groups, isGlobalMode, isDirectMode],
  )

  const handleProxyChange = useCallback(
    (e: SelectChangeEvent<string>) => {
      if (isDirectMode) return
      const newProxy = e.target.value
      const previousProxy = activeProxy
      setSelectedProxy(newProxy)
      localStorage.setItem(STORAGE_KEY_PROXY, newProxy)

      const skipConfigSave = isGlobalMode || isDirectMode
      handleSelectChange(activeGroup, previousProxy, skipConfigSave)(e)
    },
    [isDirectMode, isGlobalMode, activeGroup, activeProxy, handleSelectChange],
  )

  // 延迟检测：测试当前组全部节点
  const handleCheckDelay = useLockFn(async () => {
    if (!activeGroup || isDirectMode) return
    setTesting(true)
    try {
      const timeout = verge?.default_latency_timeout || 10000
      const collectNames = (): string[] => {
        const source = isGlobalMode
          ? groups.find(
              (g: ProxyGroup) => g.name === 'GLOBAL' || g.name === 'global',
            )
          : groups.find((g: ProxyGroup) => g.name === activeGroup)
        return (source?.all ?? [])
          .map((item) => (typeof item === 'string' ? item : (item?.name ?? '')))
          .filter((n) => n && n !== 'DIRECT' && n !== 'REJECT')
      }
      const delayProxies = collectNames()
        .map((name) => records[name])
        .filter(Boolean)
      if (delayProxies.length > 0) {
        const url = delayManager.getUrl(activeGroup)
        await Promise.race([
          delayManager.checkListDelay(delayProxies, activeGroup, timeout),
          delayGroup(activeGroup, url, timeout),
        ])
      }
      refreshProxy()
    } catch (error) {
      console.error('[UnifiedControlCard] 延迟测试出错', error)
    } finally {
      setTesting(false)
    }
  })

  if (groups.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        {t('home.components.currentProxy.labels.noActiveNode')}
      </Typography>
    )
  }

  if (isDirectMode) return null

  return (
    <Stack spacing={1}>
      {/* 标题 + 延迟检测按钮 */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography
          variant="caption"
          sx={{
            flex: 1,
            color: 'text.secondary',
            fontWeight: 600,
            letterSpacing: 0.4,
          }}
        >
          节点选择
        </Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={handleCheckDelay}
          disabled={testing}
          startIcon={
            testing ? <CircularProgress size={14} /> : <NetworkCheckOutlined />
          }
          sx={{ flexShrink: 0, height: 32, minWidth: 112 }}
        >
          {testing ? '检测中' : '延迟检测'}
        </Button>
      </Stack>

      {/* 代理组选择 (rule 模式下显示) */}
      {!isGlobalMode && groups.length > 1 && (
        <FormControl fullWidth variant="outlined" size="small" sx={{ mb: 0.5 }}>
          <InputLabel>
            {t('home.components.currentProxy.labels.group')}
          </InputLabel>
          <Select
            value={activeGroup}
            onChange={handleGroupChange}
            label={t('home.components.currentProxy.labels.group')}
          >
            {groups.map((g: ProxyGroup) => (
              <MenuItem key={g.name} value={g.name}>
                {g.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {/* 节点选择框（整行拉长） */}
      <FormControl fullWidth variant="outlined" size="small">
        <InputLabel>选节点</InputLabel>
        <Select
          value={activeProxy}
          onChange={handleProxyChange}
          label="选节点"
          MenuProps={{
            slotProps: { paper: { style: { maxHeight: 400 } } },
          }}
          renderValue={(v) => {
            const record = records[v as string]
            const delayValue =
              record && activeGroup
                ? delayManager.getDelayFix(record, activeGroup)
                : -1
            return (
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', overflow: 'hidden' }}
              >
                <Typography noWrap sx={{ flex: 1 }}>
                  {v}
                </Typography>
                <Chip
                  size="small"
                  label={delayManager.formatDelay(delayValue)}
                  color={convertDelayColor(delayValue)}
                  sx={{ minWidth: 54, height: 20, flexShrink: 0 }}
                />
              </Stack>
            )
          }}
        >
          {proxyOptions.map((name) => {
            const record = records[name]
            const delayValue =
              record && activeGroup
                ? delayManager.getDelayFix(record, activeGroup)
                : -1
            return (
              <MenuItem
                key={name}
                value={name}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  pr: 1,
                }}
              >
                <Typography noWrap sx={{ flex: 1, mr: 1 }}>
                  {name}
                </Typography>
                <Chip
                  size="small"
                  label={delayManager.formatDelay(delayValue)}
                  color={convertDelayColor(delayValue)}
                  sx={{ minWidth: 54, height: 20, flexShrink: 0 }}
                />
              </MenuItem>
            )
          })}
        </Select>
      </FormControl>
    </Stack>
  )
}

// ---------- 主组件 ----------

// 两个状态徽章共用的固定宽度：容纳最长文案「管理员模式」五字，切换时不跳动
const STATUS_CHIP_WIDTH = 86

export const UnifiedControlCard = () => {
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { indicator: systemProxyOn, toggleSystemProxy } = useSystemProxyState()
  const { isTunModeAvailable, isAdminMode, isSidecarMode, isServiceOk } =
    useSystemState()
  const { current, profiles } = useProfiles()
  const { installServiceAndRestartCore } = useServiceInstaller()
  const { uninstallServiceAndRestartCore } = useServiceUninstaller()

  const { enable_tun_mode } = verge ?? {}

  const autoLaunchEnabled = verge?.enable_auto_launch || false

  const runningModeText = useMemo(() => {
    // 内核走服务即为服务模式；否则按 app 是否提权区分
    if (!isSidecarMode)
      return t('home.components.systemInfo.badges.serviceMode')
    if (isAdminMode) return t('home.components.systemInfo.badges.adminMode')
    return t('home.components.systemInfo.badges.sidecarMode')
  }, [isAdminMode, isSidecarMode, t])

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

  // 订阅摘要信息
  const updatedText = useMemo(() => {
    if (!current?.updated) return null
    return dayjs(current.updated * 1000).format('YYYY-MM-DD HH:mm')
  }, [current?.updated])

  const trafficText = useMemo(() => {
    if (!current?.extra) return null
    const used = (current.extra as any).upload + (current.extra as any).download
    const total = (current.extra as any).total
    return `${parseTraffic(used)} / ${parseTraffic(total)}`
  }, [current?.extra])

  const trafficRemain = useMemo(() => {
    const extra = current?.extra as any
    if (!extra) return null
    const total = extra.total ?? 0
    // 无限流量订阅不提供总量，标记出来以显示无限符号，同时避免 0 除 0 得到 NaN
    // 进度取满格：0 时填充宽度为零、看不出颜色，满格才呈现绿色的「额度充足」语义
    if (total <= 0) return { unlimited: true, remain: 0, percent: 100 }
    const remain = Math.max(total - (extra.upload + extra.download), 0)
    return {
      unlimited: false,
      remain,
      percent: Math.min((remain / total) * 100, 100),
    }
  }, [current?.extra])

  // 互斥后两个开关共用同一条后端配置路径，锁必须共享
  // state 驱动转圈显示，ref 负责互斥判断（连点时 state 可能还没刷新）
  const [switching, setSwitching] = useState<'proxy' | 'tun' | null>(null)
  const switchingRef = useRef<'proxy' | 'tun' | null>(null)

  const runSwitch = useCallback(
    async (key: 'proxy' | 'tun', action: () => Promise<void>) => {
      if (switchingRef.current) return
      switchingRef.current = key
      setSwitching(key)
      try {
        await action()
      } finally {
        switchingRef.current = null
        setSwitching(null)
      }
    },
    [],
  )

  const handleProxyToggle = useCallback(
    async (v: boolean) => {
      try {
        // 两种模式互斥：开普通模式前先关掉增强模式
        if (v && enable_tun_mode) {
          mutateVerge({ ...verge, enable_tun_mode: false }, false)
          await patchVerge({ enable_tun_mode: false })
        }
        await toggleSystemProxy(v)
      } catch (err) {
        showNotice.error(err)
      }
    },
    [enable_tun_mode, verge, mutateVerge, patchVerge, toggleSystemProxy],
  )

  const handleTunToggle = useCallback(
    async (v: boolean) => {
      if (!isTunModeAvailable) {
        showNotice.error(
          t('settings.sections.proxyControl.tooltips.tunUnavailable'),
        )
        return
      }
      const previous = verge?.enable_tun_mode
      try {
        // 两种模式互斥：开增强模式前先关掉普通模式
        if (v && systemProxyOn) {
          await toggleSystemProxy(false)
        }
        mutateVerge({ ...verge, enable_tun_mode: v }, false)
        await patchVerge({ enable_tun_mode: v })
      } catch (err) {
        // 失败要回滚乐观更新，否则开关状态会与实际不一致
        mutateVerge({ ...verge, enable_tun_mode: previous }, false)
        showNotice.error(err)
      }
    },
    [
      isTunModeAvailable,
      systemProxyOn,
      toggleSystemProxy,
      verge,
      mutateVerge,
      patchVerge,
      t,
    ],
  )

  const handleInstallService = useLockFn(async () => {
    try {
      await installServiceAndRestartCore()
    } catch (err) {
      showNotice.error(err)
    }
  })

  const handleUninstallService = useLockFn(async () => {
    try {
      // 服务被卸载后 TUN 失去支撑，先关掉再卸载
      if (verge?.enable_tun_mode) {
        await handleTunToggle(false)
      }
      await uninstallServiceAndRestartCore()
    } catch (err) {
      showNotice.error(err)
    }
  })

  const sectionLabel = {
    display: 'block',
    mb: 0.5,
    color: 'text.secondary',
    fontWeight: 600,
    letterSpacing: 0.4,
  } as const

  return (
    <EnhancedCard
      action={
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ alignItems: 'center', width: '100%' }}
        >
          <Chip
            size="small"
            label={autoLaunchEnabled ? '开机自启' : '未自启'}
            color={autoLaunchEnabled ? 'success' : 'default'}
            variant={autoLaunchEnabled ? 'filled' : 'outlined'}
            sx={{ width: STATUS_CHIP_WIDTH }}
          />
          <Chip
            size="small"
            label={runningModeText}
            color="primary"
            variant="outlined"
            sx={{ width: STATUS_CHIP_WIDTH }}
          />
          {isServiceOk ? (
            <TooltipIcon
              title={t(
                'settings.sections.proxyControl.actions.uninstallService',
              )}
              icon={RemoveModeratorOutlined}
              color="secondary"
              onClick={handleUninstallService}
            />
          ) : (
            <TooltipIcon
              title={t('settings.sections.proxyControl.actions.installService')}
              icon={AddModeratorOutlined}
              color="primary"
              onClick={handleInstallService}
            />
          )}
          <Tooltip
            title={
              !profiles?.current ? t('home.page.quickFix.tooltipNoProfile') : ''
            }
            arrow
            disableHoverListener={!!profiles?.current}
            disableFocusListener={!!profiles?.current}
            disableTouchListener={!!profiles?.current}
          >
            <span style={{ marginLeft: 'auto' }}>
              <Button
                variant="contained"
                color="success"
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
        </Stack>
      }
    >
      <Stack spacing={2} divider={<Divider flexItem />}>
        {/* 第一段：开启代理 + 增强模式 并排 */}
        <Stack direction="row" spacing={1}>
          <ProxySwitchRow
            label="普通模式"
            description="浏览器等日常上网"
            active={systemProxyOn}
            onChange={(v) => runSwitch('proxy', () => handleProxyToggle(v))}
            pending={switching === 'proxy'}
            busy={switching !== null}
          />
          <ProxySwitchRow
            label="增强模式"
            description={
              '接管普通代理覆盖不到的应用\n如 ChatGPT、Claude 桌面端'
            }
            active={enable_tun_mode || false}
            onChange={(v) => runSwitch('tun', () => handleTunToggle(v))}
            disabled={!isTunModeAvailable}
            pending={switching === 'tun'}
            busy={switching !== null}
          />
        </Stack>

        {/* 第二段：代理模式 规则/全局/直连 */}
        <Box>
          <Typography variant="caption" sx={sectionLabel}>
            {t('home.page.cards.proxyMode')}
          </Typography>
          <ClashModeCard />
        </Box>

        {/* 第三段：节点选择 */}
        <NodeSelector />

        {/* 第四段：订阅摘要 */}
        {(current?.name || updatedText || trafficText) && (
          <Box>
            <Typography variant="caption" sx={sectionLabel}>
              已选订阅
            </Typography>
            <Stack spacing={0.5}>
              {current?.name && (
                <Typography
                  variant="body2"
                  noWrap
                  title={current.name}
                  sx={{ fontWeight: 600 }}
                >
                  {current.name}
                </Typography>
              )}
              {updatedText && (
                <Typography variant="caption" color="text.secondary">
                  {t('shared.labels.updateTime')}: {updatedText}
                </Typography>
              )}
              {trafficText && (
                <Typography variant="caption" color="text.secondary">
                  {t('shared.labels.usedTotal')}: {trafficText}
                </Typography>
              )}
              {trafficRemain && (
                <Box>
                  <LinearProgress
                    variant="determinate"
                    value={trafficRemain.percent}
                    color={
                      trafficRemain.percent > 30
                        ? 'success'
                        : trafficRemain.percent > 10
                          ? 'warning'
                          : 'error'
                    }
                    sx={{ height: 6, borderRadius: 3 }}
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 0.25, textAlign: 'right' }}
                  >
                    剩余{' '}
                    {trafficRemain.unlimited
                      ? '♾️'
                      : parseTraffic(trafficRemain.remain)}
                  </Typography>
                </Box>
              )}
            </Stack>
          </Box>
        )}
      </Stack>
    </EnhancedCard>
  )
}
