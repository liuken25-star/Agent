// 最小化 WebSocket 伺服器實作（RFC 6455）
// 使用 Node.js 內建 crypto 模組，無需外部依賴

import { createHash } from 'crypto';

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// 完成 WebSocket 握手，回傳 true 表示成功
export function handshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers['upgrade']?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return false;
  }

  const accept = createHash('sha1')
    .update(key + WS_MAGIC)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );
  return true;
}

// 解碼一個 WebSocket 幀，buffer 不夠時回傳 null
function decodeFrame(buf) {
  if (buf.length < 2) return null;

  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] >> 7) & 1;
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  if (masked) {
    if (buf.length < offset + 4 + payloadLen) return null;
  } else {
    if (buf.length < offset + payloadLen) return null;
  }

  let payload = buf.slice(offset + (masked ? 4 : 0), offset + (masked ? 4 : 0) + payloadLen);
  if (masked) {
    const mask = buf.slice(offset, offset + 4);
    payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  }

  return {
    opcode,
    payload,
    totalBytes: offset + (masked ? 4 : 0) + payloadLen,
  };
}

// 編碼一個 WebSocket 文字幀（伺服器端不加 mask）
function encodeFrame(data, opcode = 0x1) {
  const payload = typeof data === 'string'
    ? Buffer.from(data, 'utf-8')
    : (Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data), 'utf-8'));
  const len = payload.length;

  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

// WebSocket 連線封裝類別
export class WSClient {
  constructor(socket) {
    this.socket = socket;
    this._buf = Buffer.alloc(0);
    this._handlers = {};

    socket.on('data', (data) => this._onData(data));
    socket.on('close', () => this._emit('close'));
    socket.on('error', () => this._emit('close'));
  }

  on(event, fn) { this._handlers[event] = fn; return this; }
  once(event, fn) {
    const wrapper = (...args) => { delete this._handlers[`once_${event}`]; fn(...args); };
    this._handlers[`once_${event}`] = wrapper;
    return this;
  }

  _emit(event, ...args) {
    this._handlers[`once_${event}`]?.(...args);
    this._handlers[event]?.(...args);
  }

  _onData(data) {
    this._buf = Buffer.concat([this._buf, data]);

    while (true) {
      const frame = decodeFrame(this._buf);
      if (!frame) break;
      this._buf = this._buf.slice(frame.totalBytes);

      switch (frame.opcode) {
        case 0x1: // text
        case 0x2: // binary
          this._emit('message', frame.payload.toString('utf-8'));
          break;
        case 0x8: // close
          this.socket.end(encodeFrame(Buffer.alloc(0), 0x8));
          this._emit('close');
          break;
        case 0x9: // ping → pong
          if (!this.socket.destroyed) this.socket.write(encodeFrame(frame.payload, 0xA));
          break;
      }
    }
  }

  // 傳送文字或 JSON 物件
  send(data) {
    if (this.socket.destroyed) return;
    const str = typeof data === 'object' ? JSON.stringify(data) : String(data);
    this.socket.write(encodeFrame(str));
  }

  close() {
    if (!this.socket.destroyed) this.socket.end(encodeFrame(Buffer.alloc(0), 0x8));
  }
}
