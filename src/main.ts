import bodyParser from 'body-parser'
import express, { Request } from 'express'
import { randomBytes, randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import z from 'zod'

import { BufferedAudioMetadataBackend } from './backend/audio-metadata/buffered'
import { BasicProcessorBackend } from './backend/processors/basic'
import { GigaAMSTTBackend } from './backend/stt/gigaam'
import { OpenAITTSBackend } from './backend/tts/openai'
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

app.use(bodyParser.json())
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
      deviceId: String(request.query['device_id']),
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
          result = [{
            calendar: device.config.settings.contentPrivacy.calendar,
            id: request.deviceInfo.deviceId,
            mail: device.config.settings.contentPrivacy.mail,
            revision: 1,
            telegram: device.config.settings.contentPrivacy.telegram,
            vk_messages: device.config.settings.contentPrivacy.vkMessages,
            vk_messages_notifications: device.config.settings.contentPrivacy.vkMessagesNotifications
          }]
          break
        }
        case 'general': {
          result = [{
            alarm_volume: device.config.settings.general.alarmVolume,
            allow_music_from_app: device.config.settings.general.allowMusicFromApp,
            baby_monitor_calls_available: device.config.settings.general.babyMonitorCallsAvailable,
            blackbox_depth: device.config.settings.general.blackboxDepth,
            bt_handsfree: device.config.settings.general.btHandsfree,
            children_mode: device.config.settings.general.childrenMode,
            clock_brightness: device.config.settings.general.clockBrightness,
            clock_enabled: device.config.settings.general.clockEnabled,
            clock_night_brightness: device.config.settings.general.clockNightBrightness,
            coordinates: device.config.settings.general.coordinates,
            demomode_enabled_at: device.config.settings.general.demomodeEnabledAt,
            groups: device.config.settings.general.groups,
            home_id: device.config.settings.general.homeId,
            id: request.deviceInfo.deviceId,
            is_blocked: device.config.settings.general.isBlocked,
            keyword_sound: device.config.settings.general.keywordSound,
            master_volume: device.config.settings.general.masterVolume,
            name: device.name,
            reminder_sync: device.config.settings.general.reminderSync,
            revision: 59,
            room_id: device.config.settings.general.roomId,
            skillserver_type: device.config.settings.general.skillserverType,
            speaker_calls_available: device.config.settings.general.speakerCallsAvailable,
            timezone: device.config.settings.general.timezone,
            upnp_discovery: device.config.settings.general.upnpDiscovery
          }]
          break
        }
        case 'night_light': {
          result = []
          break
        }
        case 'night_mode': {
          result = [{
            enabled: device.config.settings.nightMode.enabled,
            id: request.deviceInfo.deviceId,
            revision: 1,
            scheduled: device.config.settings.nightMode.scheduled,
            start_at: device.config.settings.nightMode.startAt,
            stop_at: device.config.settings.nightMode.stopAt
          }]
          break
        }
        case 'safe_mode': {
          result = [{
            enabled: device.config.settings.safeMode.enabled,
            id: request.deviceInfo.deviceId,
            revision: 1
          }]
          break
        }
        case 'spotify': {
          result = [{
            enabled: device.config.settings.spotify.enabled,
            id: request.deviceInfo.deviceId,
            revision: 1
          }]
          break
        }
        case 'stereo': {
          result = [{
            auto_reconnect: device.config.settings.stereo.autoReconnect,
            channel: device.config.settings.stereo.channel,
            enabled: false,
            id: request.deviceInfo.deviceId,
            master_id: device.config.settings.stereo.masterId,
            mic_muted: device.config.settings.stereo.micMuted,
            mode: device.config.settings.stereo.mode,
            name: device.config.settings.stereo.name,
            pair_id: device.config.settings.stereo.pairId,
            revision: 1,
            slave_channel: device.config.settings.stereo.slaveChannel,
            slave_id: device.config.settings.stereo.slaveId,
            slave_volume: device.config.settings.stereo.slaveVolume,
            volume: device.config.settings.stereo.volume
          }]
          break
        }
        case 'telegram': {
          result = [{
            id: request.deviceInfo.deviceId,
            revision: 1,
            telegram_auth: device.config.settings.telegram.telegramAuth,
            telegram_phone: device.config.settings.telegram.telegramPhone,
            telegram_username: device.config.settings.telegram.telegramUsername
          }]
          break
        }
        case 'vk_calls': {
          result = [{
            available: device.config.settings.vkCalls.available,
            enabled: device.config.settings.vkCalls.enabled,
            id: request.deviceInfo.deviceId,
            revision: 2,
            ring_volume: device.config.settings.vkCalls.ringVolume,
            speech_volume: device.config.settings.vkCalls.speechVolume
          }]
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

  if (result.finished) {
    if (!result.shouldListen) {
      dialog.close()
      dialogIdToDialogMap.delete(dialogId)
      deviceIdToActiveDialogIdMap.delete(request.deviceInfo.deviceId)
    }
    response.status(200).json({
      qid: randomBytes(16).toString('hex'),
      result: {
        commands: [{
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
        }, ...(result.shouldListen
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
          : [])]
      }
    })
    return
  }

  response.status(200).json({
    qid: randomBytes(16).toString('hex'),
    result: {
      commands: [{
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
      }],
      page_token: randomUUID()
    }
  })
})

app.get('/connect', (_, response) => {
  response.status(500).end()
})

app.listen(environment.PORT, error => {
  if (error) {
    logger.fatal(`failed to start server on :${environment.PORT}`)
    return
  }
  logger.info(`server started on :${environment.PORT}`)
})
