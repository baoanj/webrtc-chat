const socket = io()

const list = document.querySelector('#list')
const text = document.querySelector('#text')
const attach = document.querySelector('#attach')

const peerConnections = new Map()
const dataChannels = new Map()

const CHUNK_SIZE = 16 * 1024 // 16 KB
const MAX_BUFFERED = 8 * 1024 * 1024 // 8 MB
const LOW_WATERMARK = 4 * 1024 * 1024 // 4 MB

let writable
let uploadChunk
let channelFile = {
  buffer: null,
  id: null,
  size: 0,
  progress: 0,
  name: ''
}

socket.on('channel', id => {
  if (!peerConnections.get(id)) {
    createPeerConnection(id, true)
  }
})

socket.on('signal', async ({ from, message }) => {
  console.log(from, message.type)
  if (!peerConnections.get(from)) {
    await createPeerConnection(from)
  }
  const pc = peerConnections.get(from)
  if (message.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(message.data))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    socket.emit('signal', {
      to: from,
      message: { type: 'answer', data: pc.localDescription }
    })
  } else if (message.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(message.data))
  } else if (message.type === 'candidate') {
    await pc.addIceCandidate(new RTCIceCandidate(message.data))
  }
})

socket.emit('channel')
// const DEFAULT_CONFIG = {
// 	iceServers: [
// 		{ urls: "stun:stun.l.google.com:19302" },
// 		{
// 			urls: [
// 				"turn:eu-0.turn.peerjs.com:3478",
// 				"turn:us-0.turn.peerjs.com:3478",
// 			],
// 			username: "peerjs",
// 			credential: "peerjsp",
// 		},
// 	],
// 	sdpSemantics: "unified-plan",
// };
async function createPeerConnection(id, isOffer) {
  console.log(id, 'createPeerConnection', isOffer)
  // const iceConfig = {
  //   iceServers: [
  //     { urls: 'stun:freestun.net:3478' },
  //     { urls: 'turn:freestun.net:3478', username: 'free', credential: 'free' }
  //   ]
  // }
  // STUN 用于 NAT 穿透。
  // TURN 在 P2P 失败时转为中继。
  // iceTransportPolicy: 'all' 保证优先使用 P2P，失败时回退到 TURN。
  const iceConfig = {
    iceServers: [
      { urls: 'stun:stun.qq.com:3478' }, // 腾讯 STUN
      { urls: 'stun:stun.l.google.com:19302' }, // Google STUN
      { urls: 'stun:stun1.l.google.com:19302' } // 备用 Google STUN
    ],
    iceTransportPolicy: 'all' // 确保尝试所有可用的 ICE 候选
  }
  if (localStorage.getItem('turn')) {
    iceConfig.iceServers.push({
      urls: [
        'turn:eu-0.turn.peerjs.com:3478',
        'turn:us-0.turn.peerjs.com:3478'
      ],
      username: 'peerjs',
      credential: 'peerjsp'
    })
  }
  const pc = new RTCPeerConnection(iceConfig)
  pc.onicecandidate = ({ candidate }) => {
    console.log(id, 'onicecandidate')
    if (candidate) {
      socket.emit('signal', {
        to: id,
        message: { type: 'candidate', data: candidate }
      })
    }
  }
  pc.ondatachannel = event => {
    console.log(id, 'ondatachannel')
    setupDataChannel(event.channel, id)
  }
  peerConnections.set(id, pc)
  if (isOffer) {
    const dataChannel = pc.createDataChannel('fileTransfer', { ordered: true })
    dataChannel.bufferedAmountLowThreshold = LOW_WATERMARK
    console.log(id, 'createDataChannel')
    setupDataChannel(dataChannel, id)
    const offer = await pc.createOffer()
    // 先 createDataChannel 再 setLocalDescription
    await pc.setLocalDescription(offer)
    console.log(id, 'createOffer')
    socket.emit('signal', {
      to: id,
      message: { type: 'offer', data: offer }
    })
  }
}

function setupDataChannel(dataChannel, peerId) {
  dataChannel.onmessage = async ({ data }) => {
    // console.log(peerId, 'Received message:', data)
    if (typeof data === 'string') {
      const { type, id, name, size } = JSON.parse(data)
      console.log(peerId, 'Received message:', type, name)
      if (type === 'text') {
        appendMsg(name)
      } else if (type === 'file-start') {
        channelFile.id = id
        channelFile.size = size
        channelFile.progress = 0
        channelFile.name = name
        appendMsg('接收文件: ' + name)
        if (size > 10 * 1024 * 1024) {
          appendMsg(`文件大小${Math.ceil(size / 1024 / 1024)}MB，请直接 `, {
            filename: name,
            saveFile: true
          })
        } else {
          channelFile.buffer = []
          sendChannel(
            JSON.stringify({
              type: 'file-next'
            })
          )
        }
      } else if (type === 'file-end') {
        if (writable) {
          writable.close()
          appendMsg(`文件已保存: ${channelFile.name}`)
        } else if (channelFile.buffer) {
          appendMsg('文件: ', {
            blob: new Blob(channelFile.buffer),
            filename: name
          })
          channelFile.buffer = null
        }
      } else if (type === 'file-next') {
        uploadChunk?.()
      }
    } else if (data instanceof ArrayBuffer) {
      console.log(peerId, 'Received ArrayBuffer:', data.byteLength)
      if (writable) {
        await writable.write(new Uint8Array(data))
      } else if (channelFile.buffer) {
        channelFile.buffer.push(data)
      } else {
        return
      }
      // sendChannel(
      //   JSON.stringify({
      //     type: 'file-next'
      //   })
      // )
      channelFile.progress += data.byteLength
      appendMsg(
        `接收进度: ${Math.floor(
          (channelFile.progress / channelFile.size) * 100
        )}%`,
        {
          id: channelFile.id
        }
      )
    }
  }
  dataChannel.onopen = () => {
    console.log(peerId, 'DataChannel opened')
    appendMsg(peerId + ' DataChannel opened')
  }
  dataChannel.onclose = () => {
    console.log(peerId, 'DataChannel closed')
    appendMsg(peerId + ' DataChannel closed')
  }
  dataChannel.onerror = err => {
    console.log(peerId, 'DataChannel error:', err)
    appendMsg(peerId + ' DataChannel error:' + err)
  }
  dataChannels.set(peerId, dataChannel)
  dataChannel.binaryType = 'arraybuffer'
}

async function sendChannel(val) {
  for (let [id, dataChannel] of dataChannels) {
    if (dataChannel.readyState === 'open') {
      if (
        val instanceof ArrayBuffer &&
        dataChannel.bufferedAmount > MAX_BUFFERED
      ) {
        console.log('bufferedAmount', dataChannel.bufferedAmount, Date.now())
        await new Promise(resolve => {
          dataChannel.onbufferedamountlow = resolve
        })
        console.log(
          'bufferedAmount low',
          dataChannel.bufferedAmount,
          Date.now()
        )
      }
      dataChannel.send(val)
    }
  }
}

function send() {
  if (text.value) {
    sendChannel(
      JSON.stringify({
        type: 'text',
        name: text.value
      })
    )
    text.value = ''
  }
  if (!uploadChunk && attach.files[0]) {
    const file = attach.files[0]
    const id = Math.random().toString(36).slice(2)
    const name = file.name
    const size = file.size
    let offset = 0

    uploadChunk = retry => {
      if (offset > size - 1) {
        sendChannel(
          JSON.stringify({
            type: 'file-end',
            id,
            name,
            size
          })
        )
        appendMsg('发送完成: ' + name)
        uploadChunk = null
        attach.value = null
        return
      }
      const slice = file.slice(offset, offset + CHUNK_SIZE)
      const reader = new FileReader()

      reader.onload = async e => {
        // 发送每个切片
        await sendChannel(e.target.result)
        offset += CHUNK_SIZE
        const percent = Math.floor((offset / size) * 100)
        appendMsg(`发送进度: ${percent > 100 ? 100 : percent}%`, { id })
        uploadChunk?.()
      }

      reader.readAsArrayBuffer(slice) // 读取切片为 ArrayBuffer
    }

    appendMsg('等待接收', { id })

    sendChannel(
      JSON.stringify({
        type: 'file-start',
        id,
        name,
        size
      })
    )
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

function appendMsg(msg, arg = {}) {
  const { id, blob, filename, saveFile } = arg
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
  if (saveFile) {
    const button = document.createElement('button')
    button.textContent = '保存文件'
    button.onclick = async () => {
      await chooseFile(filename)
      sendChannel(
        JSON.stringify({
          type: 'file-next'
        })
      )
      button.disabled = true
    }
    div.appendChild(button)
  }
  list.appendChild(div)
}

async function chooseFile(suggestedName) {
  const fileHandle = await window.showSaveFilePicker({
    suggestedName
  })
  const fileData = await fileHandle.getFile()
  channelFile.name = fileData.name
  writable = await fileHandle.createWritable({ keepExistingData: true })
}
