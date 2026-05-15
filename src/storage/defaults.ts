import { DeviceConfig, deviceConfig } from './types'

export function getDefaultDeviceConfig (): DeviceConfig {
  return deviceConfig.parse({})
}
