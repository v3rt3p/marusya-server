import { encode } from 'node-wav'
import { promises as fsPromises } from 'node:fs'
import path from 'node:path'

import { parseAudioData } from '../../codecs/audio'
import { getLogger } from '../../logger'
import { AudioMetadataBackend, AudioMetadataBackendSession } from '../backend'

class LoggingAudioMetadataBackendSession extends AudioMetadataBackendSession {
  private readonly buffers: Buffer[] = []
  private readonly logger = getLogger<LoggingAudioMetadataBackendSession>()

  private sampleRate: null | number = null

  close (): void {}

  async finish (): Promise<object> {
    if (this.sampleRate == null) {
      return {}
    }
    const totalBuffer = Buffer.concat(this.buffers)

    const data = encode([[...new Int16Array(totalBuffer.buffer, totalBuffer.byteOffset,
      totalBuffer.length / Int16Array.BYTES_PER_ELEMENT)].map(item => item < 0 ? item / 32_768 : item / 32_767)], {
      sampleRate: this.sampleRate
    })
    await fsPromises.mkdir(path.join(process.cwd(), 'logs'), {
      recursive: true
    })
    const filePath = path.join(process.cwd(), 'logs', new Date().toISOString().replaceAll(/:.-/ig, '_') + '.wav')
    await fsPromises.writeFile(filePath,
      data
    )
    this.logger.info(`Saved log to '${filePath}'`)

    return {}
  }

  async processChunk (chunk: Buffer, format: string): Promise<void> {
    const [sampleRate, buffer] = parseAudioData(chunk, format)
    if (this.sampleRate !== null && this.sampleRate !== sampleRate) {
      throw new Error(`invalid samplerate: ${sampleRate}`)
    }
    this.sampleRate = sampleRate
    this.buffers.push(buffer)
  }
}

export class LoggingAudioMetadataBackend implements AudioMetadataBackend {
  async startCapturing (): Promise<AudioMetadataBackendSession> {
    return new LoggingAudioMetadataBackendSession()
  }
}
