const express = require('express')
const { createServer } = require('http')
const { join } = require('path')
const { Server } = require('socket.io')

const app = express()
const server = createServer(app)
const io = new Server(server, { maxHttpBufferSize: 1e8 })

app.use(express.static('public'))

app.get('/:id', (req, res) => {
  if (req.params.id === 'io') {
    const ipAddress = [
      req.headers['x-forwarded-for'],
      req.socket.remoteAddress,
      req.ip
    ].join(';')
    const userAgent = req.headers['user-agent']
    console.log(new Date().toLocaleString(), ipAddress, userAgent)
    res.sendFile(join(__dirname, 'static/index.html'))
  } else if (req.params.id === 'tcs') {
    res.sendFile(join(__dirname, 'static/snake.html'))
  } else if (req.params.id === 'data') {
    res.sendFile(join(__dirname, 'static/channel.html'))
  } else {
    res.sendStatus(500)
  }
})

let owner = ''

io.on('connection', socket => {
  io.emit('count', io.engine.clientsCount)

  socket.on('disconnect', reason => {
    if (owner === socket.id) owner = ''
    io.emit('count', io.engine.clientsCount)
  })
  socket.on('text', msg => {
    io.emit('text', msg)
  })
  socket.on('send-chunk', data => {
    socket.broadcast.emit('chunk-send', data)
  })
  socket.on('chunk-received', data => {
    socket.broadcast.emit('next-chunk', data)
  })
  socket.on('chunk-retry', data => {
    socket.broadcast.emit('retry-chunk', data)
  })
  socket.on('join', () => {
    if (!owner) owner = socket.id
    socket.emit('join', owner === socket.id)
  })
  socket.on('food', data => {
    socket.broadcast.emit('food', data)
  })
  socket.on('rival', data => {
    socket.broadcast.emit('rival', { id: socket.id, data })
  })
  socket.on('result', data => {
    socket.broadcast.emit('result', data)
  })
  socket.on('channel', data => {
    socket.broadcast.emit('channel', socket.id)
  })
  socket.on('signal', ({ to, message }) => {
    io.to(to).emit('signal', { from: socket.id, message })
  })
})

// Retrieves the port number from environment variable `LEANCLOUD_APP_PORT`.
// LeanEngine runtime will assign a port and set the environment variable automatically.
const PORT = parseInt(
  process.env.LEANCLOUD_APP_PORT || process.env.PORT || 3000
)

server.listen(PORT, err => {
  console.log('Node app is running on port:', PORT)

  // Registers a global exception handler for uncaught exceptions.
  process.on('uncaughtException', err => {
    console.error('Caught exception:', err.stack)
  })
  process.on('unhandledRejection', (reason, p) => {
    console.error(
      'Unhandled Rejection at: Promise ',
      p,
      ' reason: ',
      reason.stack
    )
  })
})
