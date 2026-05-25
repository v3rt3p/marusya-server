import { Column, DataSource, Entity, PrimaryColumn } from 'typeorm'

import { deviceConfig, DeviceConfig } from './types'

export interface DeviceInfo {
  config: DeviceConfig
  id: string
  name: string
}

@Entity('device')
class Device {
  @Column('jsonb')
  config!: unknown

  @PrimaryColumn('text')
  id!: string

  @Column('text')
  name!: string
}

export class DeviceStorage {
  private readonly dataSource: DataSource

  constructor (databaseUrl: string) {
    this.dataSource = new DataSource({
      entities: [Device],
      synchronize: true,
      type: 'postgres',
      url: databaseUrl
    })
  }

  async getOrCreate (deviceId: string, defaultConfig: DeviceConfig): Promise<DeviceInfo> {
    return await this.dataSource.transaction(async manager => {
      const deviceRepository = manager.getRepository(Device)
      const device = await deviceRepository.findOne({
        where: {
          id: deviceId
        }
      })
      if (device) {
        return mapToDeviceInfo(device)
      }

      const newDevice = deviceRepository.create()
      newDevice.id = deviceId
      newDevice.name = `VK Capsula #${Math.floor(Math.random() * 1000)}`
      newDevice.config = defaultConfig
      await deviceRepository.save(newDevice)
      return mapToDeviceInfo(newDevice)
    })
  }

  async init (): Promise<void> {
    await this.dataSource.initialize()
  }

  async saveConfig (deviceInfo: DeviceInfo): Promise<void> {
    await this.dataSource.transaction(async manager => {
      const deviceRepository = manager.getRepository(Device)
      const device = await deviceRepository.findOne({
        where: {
          id: deviceInfo.id
        }
      })
      if (device) {
        device.config = deviceInfo.config
        await deviceRepository.save(device)
        return
      }
      throw new Error(`device ${deviceInfo.id} not found`)
    })
  }
}

function mapToDeviceInfo (device: Device): DeviceInfo {
  return {
    config: deviceConfig.parse(device.config),
    id: device.id,
    name: device.name
  }
}
