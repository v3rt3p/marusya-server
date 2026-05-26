import 'dotenv/config'
import { z } from 'zod'

const environmentType = z.object({
  API_PORT: z.string().default('31105').transform(Number),

  AUDIO_METADATA_URLS: z.string().default('http://speaker-identifier:9010/audio-metadata').transform(urls => urls.split(',').filter(Boolean)),

  DATABASE_URL: z.string().default(''),
  PORT: z.string().default('666').transform(Number),

  PROCESSOR_BASIC_URL: z.url().default('http://quasar.int.bksp.in:17003/process'),

  STT_GIGAAM_URL: z.url().default('ws://ru-lnsk-hpc-gpu.int.bksp.in:8081'),
  TTS_OPENAI_API_KEY: z.string().default('test'),
  // TTS_OPENAI_BASE_URL: z.url().default('http://localhost:8081'),
  TTS_OPENAI_BASE_URL: z.url().default('http://quasar.int.bksp.in:17006'),
  TTS_OPENAI_MODEL: z.string().default(''),
  TTS_OPENAI_SPEED: z.string().default('1').transform(Number),

  TTS_OPENAI_VOICE: z.string().default('IVONA 2 Tatyana OEM')
})

export type Environment = z.infer<typeof environmentType>

export function getEnvironment (): Environment {
  return environmentType.parse(process.env)
}
