import { NetworkCheckOutlined, TuneOutlined } from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { delayGroup } from 'tauri-plugin-mihomo-api'

import { Switch } from '@/components/base'
import { EnhancedCard } from '@/components/home/enhanced-card'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import delayManager from '@/services/delay'
import { showNotice } from '@/services/notice-service'
import parseTraffic from '@/utils/parse-traffic'

import { ClashModeCard } from './clash-mode-card'

// ---------- 代理开关区 ----------

const ProxySwitchRow = ({
  label,
  active,
  onChange,
  disabled,
}: {
  label: string
  active: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) => {
  const theme = useTheme()
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        p: 1,
        borderRadius: 1.5,
        bgcolor: active
          ? alpha(theme.palette.success.main, 0.08)
          : alpha(theme.palette.action.hover, 0.04),
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
      <Switch
        checked={active}
        disabled={disabled}
        onChange={(_, v) => onChange(v)}
      />
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

  // Auto-pick first group if nothing selected
  useEffect(() => {
    if (groups.length === 0) return
    if (
      !selectedGroup ||
      !groups.find((g: ProxyGroup) => g.name === selectedGroup)
    ) {
      const first = groups[0].name
      setSelectedGroup(first)
      localStorage.setItem(STORAGE_KEY_GROUP, first)
    }
  }, [groups, selectedGroup])

  // Sync selectedProxy to group's "now"
  useEffect(() => {
    if (!selectedGroup) return
    const group = groups.find((g: ProxyGroup) => g.name === selectedGroup)
    if (group?.now && !selectedProxy) {
      setSelectedProxy(group.now)
    }
  }, [groups, selectedGroup, selectedProxy])

  const currentGroupData = useMemo(
    () => groups.find((g: ProxyGroup) => g.name === selectedGroup),
    [groups, selectedGroup],
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
      const previousProxy = selectedProxy
      setSelectedProxy(newProxy)
      localStorage.setItem(STORAGE_KEY_PROXY, newProxy)

      const skipConfigSave = isGlobalMode || isDirectMode
      handleSelectChange(selectedGroup, previousProxy, skipConfigSave)(e)
    },
    [
      isDirectMode,
      isGlobalMode,
      selectedGroup,
      selectedProxy,
      handleSelectChange,
    ],
  )

  // 延迟检测：测试当前组全部节点
  const handleCheckDelay = useLockFn(async () => {
    if (!selectedGroup || isDirectMode) return
    setTesting(true)
    try {
      const timeout = verge?.default_latency_timeout || 10000
      const collectNames = (): string[] => {
        const source = isGlobalMode
          ? groups.find(
              (g: ProxyGroup) => g.name === 'GLOBAL' || g.name === 'global',
            )
          : groups.find((g: ProxyGroup) => g.name === selectedGroup)
        return (source?.all ?? [])
          .map((item) => (typeof item === 'string' ? item : (item?.name ?? '')))
          .filter((n) => n && n !== 'DIRECT' && n !== 'REJECT')
      }
      const delayProxies = collectNames()
        .map((name) => records[name])
        .filter(Boolean)
      if (delayProxies.length > 0) {
        const url = delayManager.getUrl(selectedGroup)
        await Promise.race([
          delayManager.checkListDelay(delayProxies, selectedGroup, timeout),
          delayGroup(selectedGroup, url, timeout),
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
        <FormControl fullWidth variant="outlined" size="small">
          <InputLabel>
            {t('home.components.currentProxy.labels.group')}
          </InputLabel>
          <Select
            value={selectedGroup}
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
        <Select
          value={selectedProxy}
          onChange={handleProxyChange}
          MenuProps={{
            slotProps: { paper: { style: { maxHeight: 400 } } },
          }}
          renderValue={(v) => {
            const record = records[v as string]
            const delayValue =
              record && selectedGroup
                ? delayManager.getDelayFix(record, selectedGroup)
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
              record && selectedGroup
                ? delayManager.getDelayFix(record, selectedGroup)
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

export const UnifiedControlCard = () => {
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { indicator: systemProxyOn, toggleSystemProxy } = useSystemProxyState()
  const { isTunModeAvailable } = useSystemState()
  const { current } = useProfiles()

  const { enable_tun_mode } = verge ?? {}

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

  const handleProxyToggle = useCallback(
    async (v: boolean) => {
      try {
        await toggleSystemProxy(v)
      } catch (err) {
        showNotice.error(err)
      }
    },
    [toggleSystemProxy],
  )

  const handleTunToggle = useCallback(
    async (v: boolean) => {
      if (!isTunModeAvailable) {
        showNotice.error(
          t('settings.sections.proxyControl.tooltips.tunUnavailable'),
        )
        return
      }
      try {
        mutateVerge({ ...verge, enable_tun_mode: v }, false)
        await patchVerge({ enable_tun_mode: v })
      } catch (err) {
        showNotice.error(err)
      }
    },
    [isTunModeAvailable, verge, mutateVerge, patchVerge, t],
  )

  const sectionLabel = {
    display: 'block',
    mb: 0.5,
    color: 'text.secondary',
    fontWeight: 600,
    letterSpacing: 0.4,
  } as const

  return (
    <EnhancedCard
      title="快捷控制"
      icon={<TuneOutlined />}
      iconColor="info"
      action={null}
    >
      <Stack spacing={2} divider={<Divider flexItem />}>
        {/* 第一段：开启代理 + 增强模式 并排 */}
        <Stack direction="row" spacing={1}>
          <ProxySwitchRow
            label="开启代理"
            active={systemProxyOn}
            onChange={handleProxyToggle}
          />
          <ProxySwitchRow
            label="增强模式"
            active={enable_tun_mode || false}
            onChange={handleTunToggle}
            disabled={!isTunModeAvailable}
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
        {(updatedText || trafficText) && (
          <Box>
            <Stack spacing={0.5}>
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
            </Stack>
          </Box>
        )}
      </Stack>
    </EnhancedCard>
  )
}
