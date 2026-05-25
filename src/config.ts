import { DeviceConfig } from './storage/types'

export function convertContentPrivacyConfig (deviceId: string, config: DeviceConfig['settings']['contentPrivacy']): unknown {
  return {
    calendar: config.calendar,
    id: deviceId,
    mail: config.mail,
    revision: config.revision,
    telegram: config.telegram,
    vk_messages: config.vkMessages,
    vk_messages_notifications: config.vkMessagesNotifications
  }
}

export function convertGeneralConfig (deviceId: string, name: string, config: DeviceConfig['settings']['general']): unknown {
  return {
    alarm_volume: config.alarmVolume,
    allow_music_from_app: config.allowMusicFromApp,
    baby_monitor_calls_available: config.babyMonitorCallsAvailable,
    blackbox_depth: config.blackboxDepth,
    bt_handsfree: config.btHandsfree,
    children_mode: config.childrenMode,
    clock_brightness: config.clockBrightness,
    clock_enabled: config.clockEnabled,
    clock_night_brightness: config.clockNightBrightness,
    coordinates: config.coordinates,
    demomode_enabled_at: config.demomodeEnabledAt,
    groups: config.groups,
    home_id: config.homeId,
    id: deviceId,
    is_blocked: config.isBlocked,
    keyword_sound: config.keywordSound,
    master_volume: config.masterVolume,
    name,
    reminder_sync: config.reminderSync,
    revision: config.revision,
    room_id: config.roomId,
    skillserver_type: config.skillserverType,
    speaker_calls_available: config.speakerCallsAvailable,
    timezone: config.timezone,
    upnp_discovery: config.upnpDiscovery
  }
}

export function convertNightModeConfig (deviceId: string, config: DeviceConfig['settings']['nightMode']): unknown {
  return {
    enabled: config.enabled,
    id: deviceId,
    revision: config.revision,
    scheduled: config.scheduled,
    start_at: config.startAt,
    stop_at: config.stopAt
  }
}

export function convertSafeModeConfig (deviceId: string, config: DeviceConfig['settings']['safeMode']): unknown {
  return {
    enabled: config.enabled,
    id: deviceId,
    revision: config.revision,
  }
}

export function convertSpotifyConfig (deviceId: string, config: DeviceConfig['settings']['spotify']): unknown {
  return {
    enabled: config.enabled,
    id: deviceId,
    revision: config.revision,
  }
}

export function convertStereoConfig (deviceId: string, config: DeviceConfig['settings']['stereo']): unknown {
  return {
    auto_reconnect: config.autoReconnect,
    channel: config.channel,
    enabled: config.enabled,
    id: deviceId,
    master_id: config.masterId,
    mic_muted: config.micMuted,
    mode: config.mode,
    name: config.name,
    pair_id: config.pairId,
    revision: config.revision,
    slave_channel: config.slaveChannel,
    slave_id: config.slaveId,
    slave_volume: config.slaveVolume,
    volume: config.volume
  }
}

export function convertTelegramConfig (deviceId: string, config: DeviceConfig['settings']['telegram']): unknown {
  return {
    id: deviceId,
    revision: config.revision,
    telegram_auth: config.telegramAuth,
    telegram_phone: config.telegramPhone,
    telegram_username: config.telegramUsername
  }
}

export function convertVkCallsConfig (deviceId: string, config: DeviceConfig['settings']['vkCalls']): unknown {
  return {
    available: config.available,
    enabled: config.enabled,
    id: deviceId,
    revision: config.revision,
    ring_volume: config.ringVolume,
    speech_volume: config.speechVolume
  }
}
