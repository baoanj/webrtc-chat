const myCanvas = document.getElementById('myCanvas')
const result = document.getElementById('result')
const ctx = myCanvas.getContext('2d')

const socket = io()

class Snake {
  constructor(bound, count, speed) {
    this.bound = bound
    this.count = count
    this.size = this.bound / this.count
    this.speed = speed
    this.body = [[10, 10]]
    this.food = []
    this.direction = 'r'
    this.rivalBody = {}
    this.role = ''
    this.timer = null
  }
  run() {
    console.log('run', this.role)
    window.addEventListener('keydown', evt => {
      if (evt.code === 'ArrowUp') this.direction = 'u'
      if (evt.code === 'ArrowRight') this.direction = 'r'
      if (evt.code === 'ArrowDown') this.direction = 'd'
      if (evt.code === 'ArrowLeft') this.direction = 'l'
    })
    if (this.role === 'owner') {
      this.setFood()
      socket.emit('food', this.food)
    }
    this.render()
    this.timer = setInterval(() => {
      let x = 0,
        y = 0
      if (this.direction === 'u') y = -1
      if (this.direction === 'r') x = 1
      if (this.direction === 'd') y = 1
      if (this.direction === 'l') x = -1
      const next = [
        (this.body[0][0] + x + this.count) % this.count,
        (this.body[0][1] + y + this.count) % this.count
      ]
      if (next[0] === this.food[0] && next[1] === this.food[1]) {
        this.body = [this.food].concat(this.body)
        this.setFood()
        socket.emit('food', this.food)
      } else {
        this.body = [next].concat(this.body.slice(0, this.body.length - 1))
      }
      if (this.body.length > 10 && !result.textContent) {
        result.textContent = '你赢了'
        socket.emit('result')
        this.stop()
      }
      socket.emit('rival', this.body)
      this.render()
    }, this.speed)
  }
  stop() {
    clearInterval(this.timer)
    this.timer = null
    socket.disconnect()
  }
  setFood(val) {
    this.food = val || [
      Math.floor(Math.random() * this.count),
      Math.floor(Math.random() * this.count)
    ]
    console.log('food', this.food)
  }
  drawRect(arr, fill) {
    if (fill) {
      ctx.fillRect(arr[0] * this.size, arr[1] * this.size, this.size, this.size)
    }
    ctx.strokeRect(arr[0] * this.size, arr[1] * this.size, this.size, this.size)
  }
  setStyle(color) {
    ctx.fillStyle = color
    ctx.strokeStyle = color
  }
  render() {
    ctx.clearRect(0, 0, this.bound, this.bound)
    this.setStyle('#ccc')
    Object.keys(this.rivalBody).forEach(k => {
      this.rivalBody[k].forEach((item, index) => {
        this.drawRect(item, index === 0)
      })
    })
    this.setStyle('black')
    this.body.forEach((item, index) => {
      this.drawRect(item, index === 0)
    })
    this.setStyle('red')
    this.drawRect(this.food, true)
  }
  setDirection(v) {
    this.direction = v
  }
  setRival({ id, data }) {
    this.rivalBody[id] = data
  }
  setRole(val) {
    this.role = val
    document.title = 'Snake-' + this.role
  }
}

let width = document.body.clientWidth - 22
if (width > 600) width = 600
myCanvas.width = width
myCanvas.height = width

const snake = new Snake(width, 30, 200)

socket.emit('join')

socket.on('join', val => {
  snake.setRole(val ? 'owner' : 'player')
  snake.run()
})
socket.on('rival', val => {
  snake.setRival(val)
})
socket.on('food', val => {
  snake.setFood(val)
})
socket.on('result', val => {
  if (!result.textContent) {
    snake.stop()
    result.textContent = '你输了'
  }
})

function setDir(v) {
  snake.setDirection(v)
}
