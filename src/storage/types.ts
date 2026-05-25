import { randomBytes, randomUUID } from 'node:crypto'
import z from 'zod'

const rawDeviceConfig = z.object({
  global: z.object({
    vkDomain: z.string().default('notvk.notcom')
  }),
  settings: z.object({
    contentPrivacy: z.object({
      calendar: z.boolean().default(false),
      mail: z.boolean().default(false),
      revision: z.number().default(100),
      telegram: z.boolean().default(false),
      vkMessages: z.boolean().default(false),
      vkMessagesNotifications: z.boolean().default(false),
    }),
    general: z.object({
      alarmVolume: z.number().default(40),
      allowMusicFromApp: z.boolean().default(true),
      babyMonitorCallsAvailable: z.boolean().default(true),
      blackboxDepth: z.number().default(30),
      btHandsfree: z.boolean().default(false),
      childrenMode: z.boolean().default(false),
      clockBrightness: z.number().default(-1),
      clockEnabled: z.boolean().default(true),
      clockNightBrightness: z.number().default(-1),
      coordinates: z.array(z.number()).default([
        30.309_494,
        59.993_864
      ]),
      demomodeEnabledAt: z.unknown().default(null),
      groups: z.array(z.unknown()).default([]),
      homeId: z.uuid().default(randomUUID()),
      isBlocked: z.boolean().default(false),
      keywordSound: z.boolean().default(false),
      masterVolume: z.number().default(50),
      reminderSync: z.boolean().default(true),
      revision: z.number().default(100),
      roomId: z.uuid().nullable().default(null),
      skillserverType: z.string().default(''),
      speakerCallsAvailable: z.boolean().default(true),
      timezone: z.string().default('Europe/Moscow'),
      upnpDiscovery: z.boolean().default(false)
    }),
    nightMode: z.object({
      enabled: z.boolean().default(false),
      revision: z.number().default(100),
      scheduled: z.boolean().default(false),
      startAt: z.number().default(79_200),
      stopAt: z.number().default(36_000)
    }),
    safeMode: z.object({
      enabled: z.boolean().default(true),
      revision: z.number().default(100)
    }),
    spotify: z.object({
      enabled: z.boolean().default(true),
      revision: z.number().default(100)
    }),
    stereo: z.object({
      autoReconnect: z.boolean().default(true),
      channel: z.string().default('front_left'),
      enabled: z.boolean().default(false),
      masterId: z.string().default(''),
      micMuted: z.boolean().default(false),
      mode: z.string().default('master'),
      name: z.string().default(''),
      pairId: z.unknown().default(null),
      revision: z.number().default(100),
      slaveChannel: z.string().default('front_right'),
      slaveId: z.string().default(''),
      slaveVolume: z.number().default(100),
      volume: z.number().default(100)
    }),
    telegram: z.object({
      revision: z.number().default(100),
      telegramAuth: z.boolean().default(false),
      telegramPhone: z.string().default(''),
      telegramUsername: z.string().default('')
    }),
    vkCalls: z.object({
      available: z.boolean().default(true),
      enabled: z.boolean().default(true),
      revision: z.number().default(100),
      ringVolume: z.number().default(40),
      speechVolume: z.number().default(40)
    }),
  }),
  vkAccountInfo: z.object({
    accessToken: z.string().default(`vk1.a.${randomBytes(32).toString('hex')}`),
    bdate: z.string().default('1.1.2001'),
    created: z.number().default(new Date(2010, 0, 1).getTime() / 1000),
    email: z.string().nullable().default(null),
    expiresIn: z.number().default(0),
    firstName: z.string().default('Test'),
    lastName: z.string().default('Test'),
    mobilePhone: z.string().default('78005553535'),
    sex: z.number().default(2),
    userId: z.number().default(Math.floor(100_000_000 + Math.random() * 100_000_000)),
  })
})

const NO_DEFAULT = Symbol('NO_DEFAULT')
type NoDefault = typeof NO_DEFAULT

function deepDefault<T extends z.ZodType> (schema: T): T {
  return transform(schema).schema as unknown as T
}

function rebuild (schema: z.ZodType): {
  default: NoDefault | unknown;
  schema: z.ZodType;
} {
  if (schema instanceof z.ZodDefault) {
    const inner = transform(schema.unwrap() as z.ZodType)
    const raw = schema.def.defaultValue
    const value = typeof raw === 'function' ? (raw as () => unknown)() : raw
    return { default: value, schema: inner.schema.default(value) }
  }

  if (schema instanceof z.ZodOptional) {
    const inner = transform(schema.unwrap() as z.ZodType)
    return { default: undefined, schema: inner.schema.optional() }
  }

  if (schema instanceof z.ZodNullable) {
    const inner = transform(schema.unwrap() as z.ZodType)
    return { default: inner.default, schema: inner.schema.nullable() }
  }

  if (schema instanceof z.ZodObject) {
    const newShape: Record<string, z.ZodType> = {}
    const computed: Record<string, unknown> = {}
    let allDefaultable = true

    for (const [k, v] of Object.entries(schema.shape)) {
      const child = transform(v as z.ZodType)
      newShape[k] = child.schema
      if (child.default === NO_DEFAULT) {
        allDefaultable = false
      } else if (child.default !== undefined) {
        computed[k] = child.default
      }
    }

    const object = z.object(newShape)
    return allDefaultable
      ? { default: computed, schema: object.default(computed) }
      : { default: NO_DEFAULT, schema: object }
  }

  if (schema instanceof z.ZodArray) {
    const element = transform(schema.element as z.ZodType)
    return { default: NO_DEFAULT, schema: z.array(element.schema) }
  }

  return { default: NO_DEFAULT, schema }
}

function transform (schema: z.ZodType): {
  default: NoDefault | unknown;
  schema: z.ZodType;
} {
  const result = rebuild(schema)
  const meta = schema.meta?.()
  if (meta) result.schema = result.schema.meta(meta)
  return result
}

export const deviceConfig = deepDefault(rawDeviceConfig)

export type DeviceConfig = z.infer<typeof deviceConfig>
