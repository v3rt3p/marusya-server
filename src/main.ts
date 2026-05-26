import { openapi } from '@elysia/openapi'
import { node } from '@elysiajs/node'
import bodyParser from 'body-parser'
import { Elysia, t } from 'elysia'
import express, { Request } from 'express'
import OpenAI from 'openai'
import z from 'zod'

import { BufferedAudioMetadataBackend } from './backend/audio-metadata/buffered'
import { BasicProcessorBackend } from './backend/processors/basic'
import { GigaAMSTTBackend } from './backend/stt/gigaam'
import { OpenAITTSBackend } from './backend/tts/openai'
import { getEnvironment } from './environment'
import { getLogger } from './logger'
import { DeviceStorage } from './storage/database'
import { deviceConfig } from './storage/types'
import { RequestDeviceInfo } from './types'
import { registerVCApiRoutes, VCConnection } from './vc-api'

const logger = getLogger()
const environment = getEnvironment()

const storage = new DeviceStorage(environment.DATABASE_URL)

const backends = {
  audioMetadata: new BufferedAudioMetadataBackend(environment.AUDIO_METADATA_URLS),
  // audioMetadata: new LoggingAudioMetadataBackend(),
  processor: new BasicProcessorBackend(environment.PROCESSOR_BASIC_URL),
  stt: new GigaAMSTTBackend(environment.STT_GIGAAM_URL),
  tts: new OpenAITTSBackend(new OpenAI({
    apiKey: environment.TTS_OPENAI_API_KEY,
    baseURL: environment.TTS_OPENAI_BASE_URL
  }), {
    model: environment.TTS_OPENAI_MODEL,
    speed: environment.TTS_OPENAI_SPEED,
    voice: environment.TTS_OPENAI_VOICE
  })
}

// eslint-disable-next-line unicorn/prefer-top-level-await
storage.init().catch(error => logger.fatal('failed to connect to database: ', error))

const app = express()

app.use((request, _, next) => {
  logger.debug(`${request.method} ${request.url} ${request.headers['content-type']}`)
  next()
})

app.use(bodyParser.json({
  type: message => message.headers['content-type'] === 'application/json' || !message.headers['content-type']
}))
app.use(bodyParser.raw({
  type: ['audio/*', 'multipart/form-data']
}))

function parseDeviceInfoIfAny (request: Request): RequestDeviceInfo | undefined {
  if (request.query['device_id']) {
    return {
      deviceId: String(Array.isArray(request.query['device_id'])
        ? request.query['device_id'][0]
        : request.query['device_id']),
      deviceVersion: request.query['device_ver'] ? String(request.query['device_ver']) : undefined,
      sessionId: request.query['session_id'] ? String(request.query['session_id']) : undefined
    }
  }
  return undefined
}

app.use((request, _, next) => {
  request.deviceInfo = parseDeviceInfoIfAny(request)
  next()
})

const server = app.listen(environment.PORT, error => {
  if (error) {
    logger.fatal(`failed to start server on :${environment.PORT}`)
    return
  }
  logger.info(`server started on :${environment.PORT}`)
})

const vcRouter = registerVCApiRoutes(app, server, storage, backends)

const apiServer = new Elysia({
  adapter: node()
}).use(openapi({
  documentation: {
    info: {
      title: 'Marusya API',
      version: '1.4.6'
    }
  },
  mapJsonSchema: {
    zod: z.toJSONSchema
  }
}))

function runForConnections (deviceIdOrAll: string, action: (connection: VCConnection) => void) {
  for (const connection of vcRouter.connections) {
    if (deviceIdOrAll === 'all' || deviceIdOrAll === connection.deviceId) {
      action(connection)
    }
  }
}

apiServer.get('/devices', async () => {
  const infos = await storage.getAll()
  return infos.map(info => ({
    config: info.config,
    id: info.id,
    name: info.name
  }))
}, {
  detail: {
    summary: 'Get list of devices',
    tags: ['device']
  },
  response: z.array(z.object({
    config: deviceConfig.describe('voice-agent\'s config'),
    id: z.string().describe('Device ID'),
    name: z.string().describe('Name')
  }))
})

apiServer.post('/devices/:deviceId/push', async ({ body, params: { deviceId } }) => {
  runForConnections(deviceId, connection => {
    connection.pushEvent(body.eventText)
      .catch(error => logger.warn(`Failed to push event to VC connection: ${error}`))
  })

  return {}
}, {
  body: t.Object({
    eventText: t.String({
      description: 'Event text to be pushed to LLM'
    })
  }),
  detail: {
    summary: 'Push event to LLM to be processed',
    tags: ['device']
  },
  params: t.Object({
    deviceId: t.String({
      description: "Device ID or 'all' for all devices"
    })
  }),
  response: t.Object({})
})

apiServer.post('/devices/:deviceId/push-raw', async ({ body, params: { deviceId } }) => {
  runForConnections(deviceId, connection => {
    connection.pushTts(body.eventText)
      .catch(error => logger.warn(`Failed to push raw event to VC connection: ${error}`))
  })

  return {}
}, {
  body: t.Object({
    eventText: t.String({
      description: 'Event text to be pushed to TTS'
    })
  }),
  detail: {
    summary: 'Push event text to be TTSed',
    tags: ['device']
  },
  params: t.Object({
    deviceId: t.String({
      description: "Device ID or 'all' for all devices"
    })
  }),
  response: t.Object({})
})

apiServer.post('/devices/:deviceId/push-directive', async ({ body, params: { deviceId } }) => {
  runForConnections(deviceId, connection => {
    connection.pushRawDirective(body.command, body.control)
      .catch(error => logger.warn(`Failed to push raw directive to VC connection: ${error}`))
  })

  return {}
}, {
  body: t.Object({
    command: t.Unknown({
      description: 'Raw voice-agent directive "command" (optional)',
    }),
    control: t.Unknown({
      description: 'Raw voice-agent directive "control" (optional)',
    })
  }),
  detail: {
    summary: 'Push directive to the device',
    tags: ['device']
  },
  params: t.Object({
    deviceId: t.String({
      description: "Device ID or 'all' for all devices"
    })
  }),
  response: t.Object({})
})

apiServer.patch('/devices/:deviceId', async ({ body, params: { deviceId } }) => {
  const info = await storage.updateNameAndConfig(deviceId, body.name, body.config)

  runForConnections(deviceId, connection => {
    connection.updateConfig()
      .catch(error =>
        logger.warn(`Failed to push config update to VC connection: ${error}`))
  })

  return {
    config: info.config,
    id: info.id,
    name: info.name
  }
}, {
  body: z.object({
    config: deviceConfig.optional().describe('voice-agent\'s config'),
    name: z.string().optional().describe('Name')
  }),
  detail: {
    summary: 'Update device config',
    tags: ['device']
  },
  params: t.Object({
    deviceId: t.String({
      description: 'Device ID'
    })
  }),
  response: z.object({
    config: deviceConfig.describe('voice-agent\'s maind config'),
    id: z.string().describe('Device ID'),
    name: z.string().describe('Name')
  })
})

try {
  apiServer.listen(environment.API_PORT, () => {
    logger.info(`API started on :${environment.API_PORT}`)
  })
} catch (error) {
  logger.error(`API failed to start on :${environment.API_PORT}: ${error}`)
}
