import { getTraceData, Span, startInactiveSpan } from '@sentry/node'
import { WebSocket } from 'ws'

import { parseAudioData } from '../../codecs/audio'
import { getLogger } from '../../logger'
import { STTBackend, STTBackendSession } from '../backend'

interface GigaAMMessage {
  end_of_utt: boolean;
  text: string;
}

class GigaAMSTTSession extends STTBackendSession {
  private firstChunkSent = false
  private readonly logger = getLogger<GigaAMSTTSession>()

  constructor (private readonly webSocket: WebSocket, private readonly span?: Span) {
    super()
    webSocket.on('message', (message) => {
      const simplifiedMessage = Array.isArray(message) ? Buffer.concat(message) : Buffer.from(message as ArrayBuffer)
      const response = JSON.parse(simplifiedMessage.toString('utf8')) as GigaAMMessage
      this.chunkTranscribed({
        endOfUtt: response.end_of_utt,
        text: response.text
      })
    })
  }

  close (): void {
    this.span?.end()
    this.webSocket.close()
  }

  async transcribeChunk (chunk: Buffer, format: string): Promise<void> {
    const [sampleRate, data] = parseAudioData(chunk, format)

    if (!this.firstChunkSent) {
      await new Promise<void>((resolve, reject) => {
        if (this.webSocket.readyState !== this.webSocket.OPEN) {
          this.logger.warn('Trying to send data to closed socket (sampleRate)')
          resolve()
          return
        }
        this.webSocket.send(JSON.stringify({
          sample_rate: sampleRate
        }), {
          binary: false
        }, error => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
    }

    await new Promise<void>((resolve, reject) => {
      if (this.webSocket.readyState !== this.webSocket.OPEN) {
        this.logger.warn('Trying to send data to closed socket (data)')
        resolve()
        return
      }
      this.webSocket.send(data, {
        binary: true
      }, error => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }
}

export class GigaAMSTTBackend implements STTBackend {
  constructor (private readonly endpoint: string) {}

  startTranscribing (parentSpan?: Span): Promise<STTBackendSession> {
    let span: Span | undefined
    if (parentSpan) {
      span = startInactiveSpan({
        name: 'GigaAM STT transcribing',
        op: 'gigaam-stt',
        parentSpan
      })
    }
    const webSocket = new WebSocket(this.endpoint, span
      ? {
          headers: {
            ...getTraceData({
              span: startInactiveSpan({
                name: 'GigaAM STT transcribing connection',
                op: 'gigaam-stt-connection',
                parentSpan: span
              })
            })
          }
        }
      : {})
    return new Promise((resolve, reject) => {
      webSocket.on('error', error => {
        reject(error)
      })
      webSocket.on('close', () => {
        reject(new Error('Unexpected close'))
      })
      webSocket.on('open', () => {
        resolve(new GigaAMSTTSession(webSocket, span))
      })
    })
  }
}
