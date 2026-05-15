import { decode } from 'node-wav'

import { parseOggFile } from './opus-processor'

export function parseAudioData (chunk: Buffer, format: string): [number, Buffer] {
  if (format.startsWith('audio/ogg')) {
    const parsed = parseOggFile(chunk)
    if (parsed.head.channelCount !== 1 || parsed.head.sampleRate !== 16_000) {
      throw new Error(`invalid head: ${JSON.stringify(parsed.head)}`)
    }
    return [parsed.head.sampleRate, parsed.data]
  }
  if (format.startsWith('audio/wav')) {
    const parsed = decode(chunk)
    if (parsed.sampleRate !== 16_000 || parsed.channelData.length !== 1) {
      throw new Error(`invalid samplerate or channel count: ${parsed.sampleRate}/${parsed.channelData.length}`)
    }
    const result = new Int16Array((parsed.channelData[0] ?? []).length)
    for (let index = 0; index < result.length; index++) {
      let value = Math.max(-1, Math.min((parsed.channelData[0] ?? [])[index] ?? 0, 1))
      value = (value < 0) ? value * 32_768 : value * 32_767
      result[index] = value
    }
    return [parsed.sampleRate, Buffer.from(result.buffer, result.byteOffset, result.byteLength)]
  }
  throw new Error(`invalid format: ${format}`)
}
