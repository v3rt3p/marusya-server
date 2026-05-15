/**
 * Multipart Parser (Finite State Machine)
 * usage:
 * const multipart = require('./multipart.js');
 * const body = multipart.DemoData(); // raw body
 * const body = Buffer.from(event['body-json'].toString(),'base64'); // AWS case
 * const boundary = multipart.getBoundary(event.params.header['content-type']);
 * const parts = multipart.Parse(body,boundary);
 * each part is:
 * { filename: 'A.txt', type: 'text/plain', data: <Buffer 41 41 41 41 42 42 42 42> }
 *  or { name: 'key', data: <Buffer 41 41 41 41 42 42 42 42> }
 */

enum ParsingState {
  INIT,
  READING_HEADERS,
  READING_DATA,
  READING_PART_SEPARATOR
}

type Input = {
  data: Buffer
  filename?: string
  name?: string
  type: string
}

type Part = {
  contentDispositionHeader: string
  contentTypeHeader: string
  part: number[]
}

export function DemoData (): { body: Buffer; boundary: string } {
  let body = 'trash1\r\n'
  body += '------WebKitFormBoundaryvef1fLxmoUdYZWXp\r\n'
  body += 'Content-Type: text/plain\r\n'
  body +=
    'Content-Disposition: form-data; name="uploads[]"; filename="A.txt"\r\n'
  body += '\r\n'
  body += '@11X'
  body += '111Y\r\n'
  body += '111Z\rCCCC\nCCCC\r\nCCCCC@\r\n\r\n'
  body += '------WebKitFormBoundaryvef1fLxmoUdYZWXp\r\n'
  body += 'Content-Type: text/plain\r\n'
  body +=
    'Content-Disposition: form-data; name="uploads[]"; filename="B.txt"\r\n'
  body += '\r\n'
  body += '@22X'
  body += '222Y\r\n'
  body += '222Z\r222W\n2220\r\n666@\r\n'
  body += '------WebKitFormBoundaryvef1fLxmoUdYZWXp\r\n'
  body += 'Content-Disposition: form-data; name="input1"\r\n'
  body += '\r\n'
  body += 'value1\r\n'
  body += '------WebKitFormBoundaryvef1fLxmoUdYZWXp--\r\n'
  return {
    body: Buffer.from(body),
    boundary: '----WebKitFormBoundaryvef1fLxmoUdYZWXp'
  }
}

//  read the boundary from the content-type header sent by the http client
//  this value may be similar to:
//  'multipart/form-data; boundary=----WebKitFormBoundaryvm5A9tzU1ONaGP5B',
export function getBoundary (header: string): string {
  const items = header.split(';')
  if (items) {
    for (const item_ of items) {
      const item = String(item_).trim()
      if (item.includes('boundary')) {
        const k = item.split('=')
        return String(k[1]).trim().replaceAll(/^["']|["']$/g, '')
      }
    }
  }
  return ''
}

export function parse (multipartBodyBuffer: Buffer, boundary: string): Input[] {
  let lastline = ''
  let contentDispositionHeader = ''
  let contentTypeHeader = ''
  let state: ParsingState = ParsingState.INIT
  let buffer: number[] = []
  const allParts: Input[] = []

  let currentPartHeaders: string[] = []

  for (let index = 0; index < multipartBodyBuffer.length; index++) {
    const oneByte: number = multipartBodyBuffer[index] ?? 0
    const previousByte: null | number = index > 0 ? (multipartBodyBuffer[index - 1] ?? null) : null
    // 0x0a => \n
    // 0x0d => \r
    const newLineDetected: boolean = oneByte === 0x0A && previousByte === 0x0D
    const newLineChar: boolean = oneByte === 0x0A || oneByte === 0x0D

    if (!newLineChar) lastline += String.fromCodePoint(oneByte)
    if (ParsingState.INIT === state && newLineDetected) {
      // searching for boundary
      if ('--' + boundary === lastline) {
        state = ParsingState.READING_HEADERS // found boundary. start reading headers
      }
      lastline = ''
    } else if (ParsingState.READING_HEADERS === state && newLineDetected) {
      if (lastline.length > 0) {
        currentPartHeaders.push(lastline)
      } else {
        // found empty line. search for the headers we want and set the values
        for (const h of currentPartHeaders) {
          if (h.toLowerCase().startsWith('content-disposition:')) {
            contentDispositionHeader = h
          } else if (h.toLowerCase().startsWith('content-type:')) {
            contentTypeHeader = h
          }
        }
        state = ParsingState.READING_DATA
        buffer = []
      }
      lastline = ''
    } else if (ParsingState.READING_DATA === state) {
      // parsing data
      if (lastline.length > boundary.length + 4) {
        lastline = '' // mem save
      }
      if ('--' + boundary === lastline) {
        const index = buffer.length - lastline.length
        const part = buffer.slice(0, index - 1)

        allParts.push(
          process({ contentDispositionHeader, contentTypeHeader, part })
        )
        buffer = []
        currentPartHeaders = []
        lastline = ''
        state = ParsingState.READING_PART_SEPARATOR
        contentDispositionHeader = ''
        contentTypeHeader = ''
      } else {
        buffer.push(oneByte)
      }
      if (newLineDetected) {
        lastline = ''
      }
    } else if (ParsingState.READING_PART_SEPARATOR === state && newLineDetected) {
      state = ParsingState.READING_HEADERS
    }
  }
  return allParts
}

function process (part: Part): Input {
  // will transform this object:
  // { header: 'Content-Disposition: form-data; name="uploads[]"; filename="A.txt"',
  // info: 'Content-Type: text/plain',
  // part: 'AAAABBBB' }
  // into this one:
  // { filename: 'A.txt', type: 'text/plain', data: <Buffer 41 41 41 41 42 42 42 42> }
  const object = function (string_: string) {
    const k = string_.split('=')
    const a = k[0]?.trim()

    const b = JSON.parse(k[1]?.trim() ?? '')
    const o = {}
    Object.defineProperty(o, a ?? '', {
      configurable: true,
      enumerable: true,
      value: b,
      writable: true
    })
    return o
  }
  const header = part.contentDispositionHeader.split(';')

  const filenameData = header[2]
  let input = {}
  if (filenameData) {
    input = object(filenameData)
  }
  if (part.contentTypeHeader) {
    const contentType = part.contentTypeHeader.split(':')[1]?.trim()
    Object.defineProperty(input, 'type', {
      configurable: true,
      enumerable: true,
      value: contentType,
      writable: true
    })
  }
  // always process the name field
  Object.defineProperty(input, 'name', {
    configurable: true,
    enumerable: true,
    value: header[1]?.split('=')[1]?.replaceAll('"', ''),
    writable: true
  })

  Object.defineProperty(input, 'data', {
    configurable: true,
    enumerable: true,
    value: Buffer.from(part.part),
    writable: true
  })
  return input as Input
}
