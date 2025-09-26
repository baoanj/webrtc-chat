const socket = io()

const list = document.querySelector('#list')
const text = document.querySelector('#text')
const attach = document.querySelector('#attach')

const files = {}
let uploadChunk

socket.on('connect', () => {
  appendMsg('connect')
  if (uploadChunk) {
    uploadChunk(true)
    appendMsg('重试')
  }
  Object.keys(files).forEach(k => {
    if (files[k]) {
      socket.emit('chunk-retry')
      appendMsg('重试')
    }
  })
})

socket.on('disconnect', reason => {
  appendMsg('disconnect: ' + reason)
  if (reason === 'io server disconnect') {
    // the disconnection was initiated by the server, you need to reconnect manually
    socket.connect()
  }
  // else the socket will automatically try to reconnect
})

socket.on('count', val => {
  appendMsg('在线人数: ' + val)
})

socket.on('text', appendMsg)

socket.on('retry-chunk', () => {
  uploadChunk && uploadChunk(true)
})

socket.on('chunk-send', ({ id, name, data, idx, total }) => {
  if (!files[id]) {
    files[id] = Array(total).fill()
    appendMsg('接收文件: ' + name)
  }
  appendMsg(`接收进度: ${idx}/${total}`, { id })
  files[id][idx] = data
  socket.emit('chunk-received')
  if (files[id].every(e => e)) {
    appendMsg('文件: ', { blob: new Blob(files[id]), filename: name })
    files[id] = null
  }
})

socket.on('next-chunk', () => {
  uploadChunk && uploadChunk()
})

function appendMsg(msg, arg = {}) {
  const { id, blob, filename } = arg
  if (id && document.getElementById(id)) {
    document.getElementById(id).textContent = msg
    return
  }
  const div = document.createElement('div')
  if (id) div.id = id
  div.classList.add('msg-text')
  div.setAttribute('data-time', new Date().toLocaleString())
  div.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg)
  if (blob) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename // 设置下载文件名
    a.textContent = filename
    div.appendChild(a)
  }
  list.appendChild(div)
}

function send() {
  if (text.value) {
    socket.emit('text', text.value)
    text.value = ''
  }
  if (!uploadChunk && attach.files[0]) {
    const file = attach.files[0]
    const chunkSize = 512 * 1024 // 512 KB
    const total = Math.ceil(file.size / chunkSize)
    const id = Math.random().toString(36).slice(2)
    const name = file.name
    let idx = -1

    uploadChunk = retry => {
      if (!retry) {
        if (idx < total - 1) {
          idx++
        } else {
          appendMsg('发送完成: ' + name)
          uploadChunk = null
          attach.value = null
          return
        }
      }

      const end = Math.min(idx * chunkSize + chunkSize, file.size)
      const slice = file.slice(idx * chunkSize, end)
      const reader = new FileReader()

      reader.onload = e => {
        // 发送每个切片
        socket.emit('send-chunk', {
          id,
          name,
          data: e.target.result,
          idx,
          total
        })
        appendMsg(`发送进度: ${idx}/${total}`, { id })
      }

      reader.readAsArrayBuffer(slice) // 读取切片为 ArrayBuffer
    }

    uploadChunk() // 开始上传
  }
}

text.addEventListener('paste', event => {
  const clipboardData = event.clipboardData || window.clipboardData
  const items = clipboardData.items

  // 查找剪贴板中的图像数据
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.type.indexOf('image') === 0) {
      const file = item.getAsFile()
      // 将图片转为 File 对象
      // 这里的 file 已经是一个 File 对象，可以用于上传或其他处理
      console.log(file)
      // 创建一个FileList对象并赋值给input
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file) // 将图片添加到文件列表中
      attach.files = dataTransfer.files // 设置input的files属性
    }
  }
})

window.onerror = function (message, source, line, col, error) {
  appendMsg({ message, source, line, col })
}
window.addEventListener(
  'error',
  function (error) {
    appendMsg({
      ins: [].toString.call(error),
      name: error.name,
      type: error.type,
      message: error.message
    })
    if (error.target instanceof HTMLElement) {
      appendMsg(error.target.src || error.target.href)
    }
  },
  true
)
window.addEventListener('unhandledrejection', function (error) {
  appendMsg(error.message)
})
