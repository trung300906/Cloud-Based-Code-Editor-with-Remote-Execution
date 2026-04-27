const net = require('net')

const TYPE = {
  AUTH:   0x01,
  EDIT:   0x02,
  RUN:    0x03,
  CURSOR: 0x04,
  CHAT:   0x05,
  RESULT: 0x06,
  ERR:    0x00,
}

let buffer = Buffer.alloc(0)
let heartbeatTimer = null
let pongTimer = null
let reconnectDelay = 1000

const client = new net.Socket()

function connect() {
  client.connect(8080, '127.0.0.1', () => {
    console.log('Kết nối Gateway thành công')
    reconnectDelay = 1000
    startHeartbeat()
  })
}

function send(type, payload) {
  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(5)
  header.writeUInt32BE(payloadBuf.length, 0)
  header.writeUInt8(type, 4)
  client.write(Buffer.concat([header, payloadBuf]))
}

client.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (buffer.length >= 5) {
    const len  = buffer.readUInt32BE(0)
    const type = buffer.readUInt8(4)
    if (buffer.length < 5 + len) break
    const payload = buffer.slice(5, 5 + len)
    buffer = buffer.slice(5 + len)
    dispatch(type, JSON.parse(payload.toString('utf8')))
  }
})

function dispatch(type, payload) {
  if (type === TYPE.RESULT) handleResult(payload)
  if (type === TYPE.EDIT)   handleEdit(payload)
  if (type === TYPE.CURSOR) handleCursor(payload)
  if (type === TYPE.ERR)    handleError(payload)
  if (type === 0xFF)        handlePong()
}

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    send(0xFF, { ping: Date.now() })
    pongTimer = setTimeout(() => {
      console.warn('Không nhận pong → mất kết nối')
      client.destroy()
    }, 5000)
  }, 15000)
}

function handlePong() {
  clearTimeout(pongTimer)
}

function handleResult(payload) {
  console.log('Kết quả chạy code:', payload)
}

function handleEdit(payload) {
  console.log('OT diff từ server:', payload)
}

function handleCursor(payload) {
  console.log('Cursor người khác:', payload)
}

function handleError(payload) {
  console.error('Lỗi từ server:', payload)
}

client.on('close', () => {
  clearInterval(heartbeatTimer)
  clearTimeout(pongTimer)
  console.log(`Mất kết nối — reconnect sau ${reconnectDelay}ms`)
  setTimeout(() => {
    connect()
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
  }, reconnectDelay)
})

client.on('error', (err) => {
  console.error('Socket error:', err.message)
})

connect()

module.exports = { send, TYPE }