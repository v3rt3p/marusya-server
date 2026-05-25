import { Directive } from '@v3rt3p/types/directives'

export function convertToMarusyaCommandDirective (directive: Directive): unknown {
  switch (directive.type) {
    case 'bluetoothDisable': {
      return {
        turn_on: false,
        type: 'bluetooth_pair'
      }
    }
    case 'bluetoothEnable': {
      return {
        turn_on: true,
        type: 'bluetooth_pair'
      }
    }
    case 'customMarusya': {
      return directive.data
    }
    case 'customQuasar': {
      throw new Error('Custom Quasar directives are not supported')
    }
    case 'soundLouder': {
      return null
    }
    case 'soundQuieter': {
      return null
    }
    case 'soundSetLevel': {
      return {
        level: directive.level * 10,
        type: 'volume_control'
      }
    }
  }
}
