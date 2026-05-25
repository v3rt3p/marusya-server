import bodyParser from 'body-parser'
import express, { Request } from 'express'
import { randomBytes, randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { WebSocketServer } from 'ws'
import z from 'zod'

import { BufferedAudioMetadataBackend } from './backend/audio-metadata/buffered'
import { BasicProcessorBackend } from './backend/processors/basic'
import { GigaAMSTTBackend } from './backend/stt/gigaam'
import { OpenAITTSBackend } from './backend/tts/openai'
import { convertContentPrivacyConfig, convertGeneralConfig, convertNightModeConfig, convertSafeModeConfig, convertSpotifyConfig, convertStereoConfig, convertTelegramConfig, convertVkCallsConfig } from './config'
import { Dialog } from './dialog'
import { getEnvironment } from './environment'
import { getLogger } from './logger'
import { getBoundary, parse } from './multipart'
import { DeviceStorage } from './storage/database'
import { getDefaultDeviceConfig } from './storage/defaults'
import { RequestDeviceInfo } from './types'

const logger = getLogger()
const environment = getEnvironment()

const storage = new DeviceStorage(environment.DATABASE_URL)

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

function getQueryOrThrow (request: Request, id: string): string {
  const field = request.query[id]
  if (!field) {
    throw new Error(`no '${id}' in query`)
  }
  return String(field)
}

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

app.get('/account/settings/v1/reminders', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  response.status(200).json({
    qid: randomBytes(16).toString('hex'),
    result: []
  })
})

app.get('/global_settings', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  storage.getOrCreate(request.deviceInfo.deviceId,
    getDefaultDeviceConfig())
    .then(device => {
      response.status(200).json({
        qid: randomBytes(16).toString('hex'),
        result: {
          vk_domain: device.config.global.vkDomain
        }
      })
    })
    .catch(error => {
      logger.error('failed to get config: ', error)
      response.status(500).end()
    })
})

app.get('/device/settings/v1/:device_id/:settings_id', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  if (request.deviceInfo.deviceId !== request.params['device_id']) {
    response.status(401).end()
    return
  }

  let result: unknown

  storage.getOrCreate(request.deviceInfo.deviceId,
    getDefaultDeviceConfig())
    .then(device => {
      switch (request.params['settings_id']) {
        case 'alarm_music': {
          result = []
          break
        }
        case 'alarms': {
          result = []
          break
        }
        case 'content_privacy': {
          result = [convertContentPrivacyConfig(request.deviceInfo.deviceId,
            device.config.settings.contentPrivacy)]
          break
        }
        case 'general': {
          result = [convertGeneralConfig(request.deviceInfo.deviceId, device.name,
            device.config.settings.general)]
          break
        }
        case 'night_light': {
          result = []
          break
        }
        case 'night_mode': {
          result = [convertNightModeConfig(request.deviceInfo.deviceId,
            device.config.settings.nightMode)]
          break
        }
        case 'safe_mode': {
          result = [convertSafeModeConfig(request.deviceInfo.deviceId, device.config.settings.safeMode)]
          break
        }
        case 'spotify': {
          result = [convertSpotifyConfig(request.deviceInfo.deviceId, device.config.settings.spotify)]
          break
        }
        case 'stereo': {
          result = [convertStereoConfig(request.deviceInfo.deviceId, device.config.settings.stereo)]
          break
        }
        case 'telegram': {
          result = [convertTelegramConfig(request.deviceInfo.deviceId, device.config.settings.telegram)]
          break
        }
        case 'vk_calls': {
          result = [convertVkCallsConfig(request.deviceInfo.deviceId, device.config.settings.vkCalls)]
          break
        }
        default: {
          result = []
          break
        }
      }

      response.status(200).json({
        qid: randomBytes(16).toString('hex'),
        result
      })
    })
    .catch(error => {
      logger.error('failed to get config: ', error)
      response.status(500).end()
    })
})

const generalConfigType = z.object({
  master_volume: z.number().optional()
})

app.put('/device/settings/v1/:device_id/:settings_id/:device_id_2', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  if (request.deviceInfo.deviceId !== request.params['device_id']) {
    response.status(401).end()
    return
  }

  let result: unknown

  storage.getOrCreate(request.deviceInfo.deviceId,
    getDefaultDeviceConfig())
    .then(device => {
      const oldConfig = structuredClone(device.config)

      switch (request.params['settings_id']) {
        case 'alarm_music': {
          break
        }
        case 'alarms': {
          break
        }
        case 'content_privacy': {
          device.config.settings.contentPrivacy.revision++

          result = {
            new: convertContentPrivacyConfig(request.deviceInfo.deviceId, device.config.settings.contentPrivacy),
            old: convertContentPrivacyConfig(request.deviceInfo.deviceId, oldConfig.settings.contentPrivacy)
          }
          break
        }
        case 'general': {
          const update = generalConfigType.parse(request.body)
          if (update.master_volume) {
            device.config.settings.general.masterVolume = update.master_volume
          }

          device.config.settings.general.revision++

          result = {
            new: convertGeneralConfig(request.deviceInfo.deviceId, device.name, device.config.settings.general),
            old: convertGeneralConfig(request.deviceInfo.deviceId, device.name, oldConfig.settings.general)
          }
          break
        }
        case 'night_light': {
          break
        }
        case 'night_mode': {
          device.config.settings.nightMode.revision++

          result = {
            new: convertNightModeConfig(request.deviceInfo.deviceId, device.config.settings.nightMode),
            old: convertNightModeConfig(request.deviceInfo.deviceId, oldConfig.settings.nightMode)
          }
          break
        }
        case 'safe_mode': {
          device.config.settings.safeMode.revision++

          result = {
            new: convertSafeModeConfig(request.deviceInfo.deviceId, device.config.settings.safeMode),
            old: convertSafeModeConfig(request.deviceInfo.deviceId, oldConfig.settings.safeMode)
          }
          break
        }
        case 'spotify': {
          device.config.settings.spotify.revision++

          result = {
            new: convertSpotifyConfig(request.deviceInfo.deviceId, device.config.settings.spotify),
            old: convertSpotifyConfig(request.deviceInfo.deviceId, oldConfig.settings.spotify)
          }
          break
        }
        case 'stereo': {
          device.config.settings.stereo.revision++

          result = {
            new: convertStereoConfig(request.deviceInfo.deviceId, device.config.settings.stereo),
            old: convertStereoConfig(request.deviceInfo.deviceId, oldConfig.settings.stereo)
          }
          break
        }
        case 'telegram': {
          device.config.settings.telegram.revision++

          result = {
            new: convertTelegramConfig(request.deviceInfo.deviceId, device.config.settings.telegram),
            old: convertTelegramConfig(request.deviceInfo.deviceId, oldConfig.settings.telegram)
          }
          break
        }
        case 'vk_calls': {
          device.config.settings.vkCalls.revision++

          result = {
            new: convertVkCallsConfig(request.deviceInfo.deviceId, device.config.settings.vkCalls),
            old: convertVkCallsConfig(request.deviceInfo.deviceId, oldConfig.settings.vkCalls)
          }
          break
        }
        default: {
          break
        }
      }

      storage.saveConfig(device)
        .then(() => logger.debug('config saved'))
        .catch(error => logger.error('failed to save config: ', error))

      response.status(200).json({
        qid: randomBytes(16).toString('hex'),
        result
      })
    })
    .catch(error => {
      logger.error('failed to get config: ', error)
      response.status(500).end()
    })
})

app.post('/rt_logs/send', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  response.status(500).end()
})

app.get('/account/vk/info', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  storage.getOrCreate(request.deviceInfo.deviceId,
    getDefaultDeviceConfig())
    .then(device => {
      response.status(200).json({
        qid: randomBytes(16).toString('hex'),
        result: {
          access_token: device.config.vkAccountInfo.accessToken,
          bdate: device.config.vkAccountInfo.bdate,
          created: device.config.vkAccountInfo.created,
          email: device.config.vkAccountInfo.email,
          expires_in: 0,
          first_name: device.config.vkAccountInfo.firstName,
          last_name: device.config.vkAccountInfo.lastName,
          mobile_phone: device.config.vkAccountInfo.mobilePhone,
          sex: device.config.vkAccountInfo.sex,
          user_id: device.config.vkAccountInfo.userId
        }
      })
    })
    .catch(error => {
      logger.error('failed to get config: ', error)
      response.status(500).end()
    })
})

app.post('/device/toggles', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  response.status(200).json({
    qid: randomBytes(16).toString('hex'),
    result: {
      config: {},
      revision: null,
      splits: ''
    }
  })
})

app.post('/phrase/create/event', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  const event = getQueryOrThrow(request, 'event')
  logger.info(`Received event: ${event}, ${JSON.stringify(request.body)}`)
  response.status(200).json({
    qid: randomBytes(16).toString('hex'),
    result: {
      phrase_id: randomUUID(),
      phrase_result: {
        asr_text: null,
        commands: [],
        controls: [],
        intent: 'radioegor146',
        secure: false,
        skill: 'radioegor146'
      }
    }
  })
})

const parametersType = z.object({
  callback_data: z.string().optional(),
})

const listenCallbackData = z.object({
  dialogId: z.uuid()
})

const phraseIdToDialogIdMap: Map<string, string> = new Map()
const dialogIdToDialogMap: Map<string, Dialog> = new Map()
const deviceIdToActiveDialogIdMap: Map<string, string> = new Map()

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

enum PhraseResult {
  OKAY_GO_ON = 1,
  KEYWORD_CONFIRMED = 2,
  KEYWORD_NOT_CONFIRMED = 3,
  END_OF_PHRASE = 4,
  ERROR_OCCURRED = 5,
  PHRASE_RECOGNISED = 6,
}

app.post('/phrase/create/0chunk', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  const boundary = getBoundary(String(request.headers['content-type']))
  const parts = parse(request.body, boundary)

  const rawParameters = parts.find(part => part.name === 'params')
  const rawChunk = parts.find(part => part.name === 'chunk')

  if (!rawParameters) {
    throw new Error('params or chunk not found')
  }

  let dialogId: string = randomUUID()

  const parameters = parametersType.parse(JSON.parse(rawParameters.data.toString('utf8')))
  if (parameters.callback_data) {
    dialogId = listenCallbackData.parse(JSON.parse(parameters.callback_data)).dialogId
  }

  const activeDialogId = deviceIdToActiveDialogIdMap.get(request.deviceInfo.deviceId)
  if (activeDialogId && dialogId !== activeDialogId) {
    dialogIdToDialogMap.get(activeDialogId)?.close()
    dialogIdToDialogMap.delete(activeDialogId)
    deviceIdToActiveDialogIdMap.delete(request.deviceInfo.deviceId)
  }

  const dialog = dialogIdToDialogMap.get(dialogId) ?? (() => {
    const newDialog = new Dialog(backends)
    newDialog.init()
    return newDialog
  })()
  dialogIdToDialogMap.set(dialogId, dialog)

  dialog.handleStartVoice().then(() => {
    if (rawChunk) {
      dialog.handleVoiceChunk(rawChunk.data, rawChunk.type, 0)
    }
  }).catch(error => {
    logger.error('failed to handleStartVoice: ', error)
    dialogIdToDialogMap.delete(dialogId)
  })

  const phraseId = randomUUID()
  phraseIdToDialogIdMap.set(phraseId, dialogId)

  response.status(200).json({
    qid: randomBytes(16).toString('hex'),
    result: {
      chunk_length_hint: 80,
      phrase_id: phraseId,
      status: PhraseResult.OKAY_GO_ON
    }
  })
})

app.post('/phrase/add', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  const chunkNumber = Number.parseInt(getQueryOrThrow(request, 'chunk_num'))

  const phraseId = getQueryOrThrow(request, 'phrase_id')
  const dialogId = phraseIdToDialogIdMap.get(phraseId)
  if (!dialogId) {
    response.status(500).end()
    return
  }

  const dialog = dialogIdToDialogMap.get(dialogId)
  if (!dialog) {
    response.status(500).end()
    return
  }

  const finished = dialog.handleVoiceChunk(request.body, request.headers['content-type'] ?? 'unknown', chunkNumber)

  response.status(200).json({
    qid: randomBytes(16).toString('hex'),
    result: {
      chunk_length_hint: 80,
      status: finished ? PhraseResult.PHRASE_RECOGNISED : PhraseResult.KEYWORD_CONFIRMED
    }
  })
})

app.get('/phrase/result', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  const phraseId = getQueryOrThrow(request, 'phrase_id')
  const dialogId = phraseIdToDialogIdMap.get(phraseId)
  if (!dialogId) {
    response.status(500).end()
    return
  }

  const dialog = dialogIdToDialogMap.get(dialogId)
  if (!dialog) {
    response.status(500).end()
    return
  }

  response.status(200).json({
    qid: randomBytes(16).toString('hex'),
    result: {
      asr_text: '',
      commands: [],
      controls: [],
      intent: 'radioegor146',
      page_token: randomUUID(),
      secure: false,
      skill: 'radioegor146'
    }
  })
})

app.get('/stream', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  const streamId = getQueryOrThrow(request, 'stream_id')
  const buffer = streamIdToSpeechBuffer.get(streamId)
  streamIdToSpeechBuffer.delete(streamId)

  if (buffer) {
    response.status(200).header({
      'content-type': 'audio/ogg'
    }).end(buffer)
    return
  }

  response.status(500).end()
})

const streamIdToSpeechBuffer: Map<string, Buffer> = new Map()

app.post('/phrase/commands', (request, response) => {
  if (!request.deviceInfo) {
    response.status(500).end()
    return
  }

  const phraseId = getQueryOrThrow(request, 'phrase_id')
  const dialogId = phraseIdToDialogIdMap.get(phraseId)
  if (!dialogId) {
    response.status(500).end()
    return
  }

  const dialog = dialogIdToDialogMap.get(dialogId)
  if (!dialog) {
    response.status(500).end()
    return
  }

  const result = dialog.getNextResult()
  if (!result) {
    setTimeout(() => {
      response.status(200).json({
        qid: randomBytes(16).toString('hex'),
        result: {
          commands: [],
          page_token: randomUUID()
        }
      })
    }, 500)
    return
  }

  const streamId = randomUUID()
  streamIdToSpeechBuffer.set(streamId, result.speech)

  if (result.finished && !result.shouldListen) {
    dialog.close()
    dialogIdToDialogMap.delete(dialogId)
    deviceIdToActiveDialogIdMap.delete(request.deviceInfo.deviceId)
  }

  storage.getOrCreate(request.deviceInfo.deviceId,
    getDefaultDeviceConfig())
    .then(device => {
      const directives: unknown[] = []

      let needConfigUpdate = false

      for (const directive of result.directives) {
        switch (directive.type) {
          case 'bluetoothDisable': {
            directives.push({
              turn_on: false,
              type: 'bluetooth_pair'
            })
            break
          }
          case 'bluetoothEnable': {
            directives.push({
              turn_on: true,
              type: 'bluetooth_pair'
            })
            break
          }
          case 'customMarusya': {
            directives.push(directive.data)
            break
          }
          case 'customQuasar': {
            continue
          }
          case 'soundLouder': {
            needConfigUpdate = true
            device.config.settings.general.masterVolume =
              Math.min(100, device.config.settings.general.masterVolume + 10)
            device.config.settings.general.revision++
            storage.saveConfig(device)
              .then(() => logger.debug('config saved'))
              .catch(error => logger.error('failed to save config: ', error))
            directives.push({
              level: device.config.settings.general.masterVolume,
              type: 'volume_control'
            })
            break
          }
          case 'soundQuieter': {
            needConfigUpdate = true
            device.config.settings.general.masterVolume = Math.max(10, device.config.settings.general.masterVolume - 10)
            device.config.settings.general.revision++
            storage.saveConfig(device)
              .then(() => logger.debug('config saved'))
              .catch(error => logger.error('failed to save config: ', error))
            directives.push({
              level: device.config.settings.general.masterVolume,
              type: 'volume_control'
            })
            break
          }
          case 'soundSetLevel': {
            needConfigUpdate = true
            device.config.settings.general.masterVolume = directive.level * 10
            device.config.settings.general.revision++
            storage.saveConfig(device)
              .then(() => logger.debug('config saved'))
              .catch(error => logger.error('failed to save config: ', error))
            directives.push({
              level: device.config.settings.general.masterVolume,
              type: 'volume_control'
            })
            continue
          }
        }
      }

      if (needConfigUpdate) {
        directives.push({
          settings: convertGeneralConfig(request.deviceInfo.deviceId, device.name, device.config.settings.general),
          type: 'general_settings_v1'
        })
      }

      response.status(200).json({
        qid: randomBytes(16).toString('hex'),
        result: {
          ...(result.finished
            ? {}
            : {
                page_token: randomUUID()
              }),
          commands: [
            ...directives,
            ...(result.text === null
              ? []
              : [{
                  blocking: true,
                  encoder: 'opus',
                  encoder_bitrate: null,
                  encoder_frame_size: null,
                  force_say: false,
                  kws_skip: null,
                  long_reader_request: false,
                  model_name: 'tts',
                  normalize: true,
                  speed: 1,
                  stream_hls: false,
                  stream_id: streamId,
                  text: result.text,
                  type: 'tts'
                }]),
            ...(result.finished && result.shouldListen
              ? [
                  {
                    blocking: true,
                    callback_data: JSON.stringify({
                      dialogId
                    }),
                    min_waiting_time: 4,
                    mute_activation_sound: false,
                    type: 'listen'
                  }
                ]
              : [])],
        }
      })
    })
    .catch(error => {
      logger.error('failed to fetch config: ', error)
      response.status(500).end()
    })
})

const server = app.listen(environment.PORT, error => {
  if (error) {
    logger.fatal(`failed to start server on :${environment.PORT}`)
    return
  }
  logger.info(`server started on :${environment.PORT}`)
})

const wsServer = new WebSocketServer({
  noServer: true
})

server.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/connect')) {
    wsServer.handleUpgrade(request, socket, head, client => {
      wsServer.emit('connection', client, request)
    })
    return
  }
  socket.destroy()
})

wsServer.addListener('connection', (connection, request) => {
  connection.addEventListener('open', () => {
    logger.info('WS opened')
  })
  connection.addEventListener('close', reason => {
    logger.info('WS closed: ', reason.code)
  })
  connection.addEventListener('error', error => {
    logger.warn('WS error: ', error)
  })
  connection.addEventListener('message', message => {
    logger.debug(`WS message: ${message.data}`)
  })
})
