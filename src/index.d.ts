import { DeviceInfo } from './types'

declare global {
  namespace Express {
    export interface Request {
      deviceInfo?: DeviceInfo
    }
  }
}
