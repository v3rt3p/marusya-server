import { Sema } from 'async-sema'

import { AudioMetadataBackend, AudioMetadataBackendSession, ProcessorBackend, ProcessorSession, STTBackend, STTBackendSession, TTSBackend } from './backend/backend'
import { getLogger } from './logger'
import { Notifier } from './notifier'

enum DialogState {
  READY_TO_START_VOICE,
  STARTING_VOICE_PROCESSING,
  PROCESSING_VOICE,
  PROCESSING_TEXT,
  CLOSED
}

export interface DialogProperties {
  audioMetadata: AudioMetadataBackend
  processor: ProcessorBackend,
  stt: STTBackend,
  tts: TTSBackend
}

export type DialogResult = ({
  finished: false
} | {
  finished: true,
  shouldListen: boolean
}) & {
  speech: Buffer
  text: string,
}

export class Dialog {
  private audioMetadataSession: AudioMetadataBackendSession | undefined

  private readonly chunkProcessingLock = new Sema(1)

  private readonly indexUpdatedNotifier = new Notifier()

  private lastProcessedChunk: number = -1

  private lastText: string = ''

  private readonly logger = getLogger<Dialog>()

  private openSessionPromise: Promise<ProcessorSession> | undefined

  private processorSesssion: ProcessorSession | undefined

  private responsesQueue: DialogResult[] = []

  private state: DialogState = DialogState.READY_TO_START_VOICE

  private sttSession: STTBackendSession | undefined

  private voiceChunks: [Buffer, string, number][] = []

  private voiceFinished: boolean = false

  constructor (private properties: DialogProperties) {}

  close (): void {
    this.sttSession?.close()
    this.audioMetadataSession?.close()
    this.processorSesssion?.close()
    this.lastProcessedChunk = -1
    this.state = DialogState.CLOSED
  }

  getLastAsrResult (): string {
    return this.lastText
  }

  getNextResult (): DialogResult | null {
    if (this.responsesQueue.length === 0) {
      return null
    }
    const item = this.responsesQueue[0]
    this.responsesQueue = this.responsesQueue.slice(1)
    return item ?? null
  }

  async handleStartVoice (): Promise<void> {
    if (this.state !== DialogState.READY_TO_START_VOICE) {
      throw new Error('not in a state to start voice')
    }
    this.state = DialogState.STARTING_VOICE_PROCESSING

    this.voiceFinished = false

    const [audioMetadataSession, sttSession] = await Promise.all([
      this.properties.audioMetadata.startCapturing(),
      this.properties.stt.startTranscribing()
    ])

    this.audioMetadataSession = audioMetadataSession
    this.sttSession = sttSession

    this.sttSession.setCallback(result => {
      if (result.endOfUtt) {
        this.processText(result.text).catch(error => {
          this.logger.warn('failed to process text: ', error)
        })
      }
    })

    for (const [chunk, format, index] of this.voiceChunks) {
      this.processChunk(chunk, format, index).catch(error => {
        this.logger.error('failed to process audio chunk: ', error)
      })
    }
    this.voiceChunks = []

    this.state = DialogState.PROCESSING_VOICE
  }

  handleVoiceChunk (chunk: Buffer, format: string, index: number): boolean {
    if (this.state === DialogState.STARTING_VOICE_PROCESSING) {
      this.voiceChunks.push([chunk, format, index])
      return false
    }

    if (this.state === DialogState.PROCESSING_TEXT) {
      return true
    }

    if (this.state !== DialogState.PROCESSING_VOICE || !this.audioMetadataSession || !this.sttSession) {
      throw new Error('not in a state to handle voice chunk')
    }

    this.processChunk(chunk, format, index).catch(error => {
      this.logger.error('failed to process audio chunk: ', error)
    })

    return this.voiceFinished
  }

  init (): void {
    this.openSessionPromise = this.properties.processor.openSession().then(async session => {
      await session.prepare()
      return session
    })
  }

  async processChunk (chunk: Buffer, format: string, index: number): Promise<void> {
    if (!this.audioMetadataSession || !this.sttSession) {
      throw new Error('not in a state to handle voice chunk')
    }

    while (index !== this.lastProcessedChunk + 1) {
      this.logger.debug(`Waiting for new index: ${index} != ${this.lastProcessedChunk + 1}`)
      await this.indexUpdatedNotifier.wait()
    }

    await this.chunkProcessingLock.acquire()
    try {
      await Promise.all([this.audioMetadataSession.processChunk(chunk, format),
        this.sttSession.transcribeChunk(chunk, format)])
      this.logger.debug(`Processed chunk ${index}`)
      this.lastProcessedChunk = index
      this.indexUpdatedNotifier.notifyAll()
    } finally {
      this.chunkProcessingLock.release()
    }
  }

  private async processText (text: string): Promise<void> {
    this.state = DialogState.PROCESSING_TEXT
    this.sttSession?.close()
    this.sttSession = undefined
    const metadata = await this.audioMetadataSession?.finish() ?? {}
    this.audioMetadataSession = undefined
    this.lastProcessedChunk = -1

    let processorSession = this.processorSesssion

    if (!processorSession) {
      if (!this.openSessionPromise) {
        throw new Error('no processor session created?')
      }

      processorSession = await this.openSessionPromise

      processorSession.addListener('close', () => {
        if (this.state !== DialogState.CLOSED) {
          this.state = DialogState.CLOSED
          this.responsesQueue.push({
            finished: true,
            shouldListen: false,
            speech: Buffer.from([]),
            text: ''
          })
        }
      })

      processorSession.addListener('partialResponse', partialResponse => {
        if (partialResponse.finished) {
          if (partialResponse.requireMoreInput) {
            this.state = DialogState.READY_TO_START_VOICE
          } else {
            this.state = DialogState.CLOSED
            this.close()
          }
        }
        this.properties.tts.synthesize({
          text: partialResponse.text
        }).then(result => {
          this.responsesQueue.push({
            finished: partialResponse.finished,
            shouldListen: partialResponse.finished ? partialResponse.requireMoreInput : false,
            speech: Buffer.from(result.voiceOutput),
            text: partialResponse.text
          })
        }).catch(error => {
          this.logger.error('failed to synthesize: ', error)
          this.responsesQueue.push({
            finished: partialResponse.finished,
            shouldListen: partialResponse.finished ? partialResponse.requireMoreInput : false,
            speech: Buffer.from([]),
            text: partialResponse.text
          })
        })
      })
    }

    this.processorSesssion = processorSession

    await processorSession.process({
      metadata,
      text,
    })
  }
}
