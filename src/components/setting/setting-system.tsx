import { Button, Typography } from '@mui/material'
import { useLockFn } from 'ahooks'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogRef, Switch, TooltipIcon } from '@/components/base'
import ProxyControlSwitches from '@/components/shared/proxy-control-switches'
import { useServiceInstaller } from '@/hooks/use-service-installer'
import { useServiceUninstaller } from '@/hooks/use-service-uninstaller'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'

import { GuardState } from './mods/guard-state'
import { SettingList, SettingItem } from './mods/setting-comp'
import { SysproxyViewer } from './mods/sysproxy-viewer'
import { TunViewer } from './mods/tun-viewer'

interface Props {
  onError?: (err: Error) => void
}

const SettingSystem = ({ onError }: Props) => {
  const { t } = useTranslation()

  const { verge, mutateVerge, patchVerge } = useVerge()
  const { isServiceOk, mutateSystemState } = useSystemState()
  const { installServiceAndRestartCore } = useServiceInstaller()
  const { uninstallServiceAndRestartCore } = useServiceUninstaller()
  const [serviceBusy, setServiceBusy] = useState(false)

  const handleServiceAction = useLockFn(async () => {
    setServiceBusy(true)
    try {
      if (isServiceOk) {
        // 卸载前先关闭 TUN，避免残留虚拟网卡
        if (verge?.enable_tun_mode) {
          await patchVerge({ enable_tun_mode: false })
        }
        await uninstallServiceAndRestartCore()
      } else {
        await installServiceAndRestartCore()
      }
      await mutateSystemState()
    } catch {
      // 错误通知已在 hook 内弹出
    } finally {
      setServiceBusy(false)
    }
  })

  const { enable_auto_launch, enable_silent_start } = verge ?? {}

  const sysproxyRef = useRef<DialogRef>(null)
  const tunRef = useRef<DialogRef>(null)

  const onSwitchFormat = (
    _e: React.ChangeEvent<HTMLInputElement>,
    value: boolean,
  ) => value
  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false)
  }

  return (
    <SettingList title={t('settings.sections.system.title')}>
      <SysproxyViewer ref={sysproxyRef} />
      <TunViewer ref={tunRef} />

      <SettingItem label="服务模式">
        <React.Fragment>
          <Typography
            variant="body2"
            sx={{
              fontSize: 13,
              mr: 1,
              color: isServiceOk ? 'success.main' : 'text.disabled',
            }}
          >
            {isServiceOk ? '已安装' : '未安装'}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            color={isServiceOk ? 'secondary' : 'primary'}
            disabled={serviceBusy}
            onClick={handleServiceAction}
            sx={{ minWidth: 88 }}
          >
            {isServiceOk
              ? t('settings.sections.proxyControl.actions.uninstallService')
              : t('settings.sections.proxyControl.actions.installService')}
          </Button>
        </React.Fragment>
      </SettingItem>

      <ProxyControlSwitches
        label={t('settings.sections.system.toggles.tunMode')}
        onError={onError}
      />

      <ProxyControlSwitches
        label={t('settings.sections.system.toggles.systemProxy')}
        onError={onError}
      />

      <SettingItem label={t('settings.sections.system.fields.autoLaunch')}>
        <GuardState
          value={enable_auto_launch ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => {
            onChangeData({ enable_auto_launch: e })
          }}
          onGuard={async (e) => {
            try {
              // 先触发UI更新立即看到反馈
              onChangeData({ enable_auto_launch: e })
              await patchVerge({ enable_auto_launch: e })
              return Promise.resolve()
            } catch (error) {
              // 如果出错，恢复原始状态
              onChangeData({ enable_auto_launch: !e })
              return Promise.reject(error)
            }
          }}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t('settings.sections.system.fields.silentStart')}
        extra={
          <TooltipIcon
            title={t('settings.sections.system.tooltips.silentStart')}
            sx={{ opacity: '0.7' }}
          />
        }
      >
        <GuardState
          value={enable_silent_start ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_silent_start: e })}
          onGuard={(e) => patchVerge({ enable_silent_start: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>
    </SettingList>
  )
}

export default SettingSystem
