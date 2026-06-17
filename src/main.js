/**
 * CafeVibe — 业务拼装层
 *
 * 职责：
 *   - 导入 AudioEngine 并管理其生命周期
 *   - 绑定 DOM 控件 ↔ 引擎参数的双向同步
 *   - 处理用户拖拽/点击上传音频文件
 *   - 初始化时自动启动程序生成的环境噪音
 */
import './style.css'
import { AudioEngine } from './audio-engine.js'

// ══════════════════════════════════════════
//  状态
// ══════════════════════════════════════════

/** 音频引擎单例 */
const engine = new AudioEngine()

/** 引擎是否已完成初始化 */
let isInitialized = false

// ══════════════════════════════════════════
//  DOM 引用
// ══════════════════════════════════════════

const $ = (sel) => document.querySelector(sel)

const uploadZone       = $('#uploadZone')
const fileInput        = $('#fileInput')
const uploadPlaceholder = $('#uploadPlaceholder')
const uploadFileInfo   = $('#uploadFileInfo')
const fileNameDisplay  = $('#fileNameDisplay')
const changeFileBtn    = $('#changeFileBtn')

const trackName   = $('#trackName')
const trackIcon   = $('#trackIcon')
const playStatus  = $('#playStatus')
const playBtn     = $('#playBtn')
const playIcon    = $('#playIcon')

const lofiSlider  = $('#lofiSlider')
const lofiValue   = $('#lofiValue')
const bgSlider    = $('#bgVolumeSlider')
const bgValue     = $('#bgVolumeValue')

// ══════════════════════════════════════════
//  引擎初始化（用户首次点击页面任意处触发）
// ══════════════════════════════════════════

async function ensureInit() {
  if (isInitialized) return
  await engine.init()
  isInitialized = true

  // 启动程序生成的布朗噪音作为默认环境音
  engine.loadBgNoise('brown', { filterFreq: 1200, gain: 0.3 })

  // 恢复滑块到引擎状态（默认值）
  engine.setLofiIntensity(Number(lofiSlider.value))
  engine.setBgVolume(Number(bgSlider.value))

  console.log('☕ CafeVibe — 一切就绪，可以上传音乐了')
}

// 用户首次交互时初始化（点击、触摸、键盘 Tab 皆可）
const initOnInteraction = async () => {
  await ensureInit()
  document.removeEventListener('pointerdown', initOnInteraction)
  document.removeEventListener('keydown', initOnInteraction)
}
document.addEventListener('pointerdown', initOnInteraction, { once: false })
document.addEventListener('keydown', initOnInteraction, { once: false })

// ══════════════════════════════════════════
//  文件上传
// ══════════════════════════════════════════

/**
 * 读取用户上传的音频文件并通过引擎加载。
 */
async function handleFile(file) {
  // 检查文件类型
  if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|m4a|flac)$/i)) {
    alert('请上传音频文件（mp3 / wav / ogg 等）')
    return
  }

  // 确保引擎已初始化（如果用户直接拖拽文件，可能还没点击过页面）
  await ensureInit()

  // 显示文件名
  fileNameDisplay.textContent = file.name
  uploadPlaceholder.classList.add('hidden')
  uploadFileInfo.classList.remove('hidden')

  // 更新曲目信息
  trackName.textContent = file.name
  trackIcon.textContent = '🎵'

  // 创建 blob URL 并加载到引擎
  const blobUrl = URL.createObjectURL(file)
  await engine.loadMusic(blobUrl, { fadeIn: 2 })

  // 自动播放
  engine.play()
  updatePlayUI(true)
  playStatus.textContent = '▶ 播放中'

  // 启用播放按钮
  playBtn.disabled = false

  // 还原 Lofi 滑块对当前音乐的生效
  engine.setLofiIntensity(Number(lofiSlider.value))

  console.log(`📂 已加载: ${file.name}`)
}

// ─── 点击上传区触发文件选择 ───
uploadZone.addEventListener('click', () => {
  fileInput.click()
})

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0]
  if (file) handleFile(file)
  // 重置 input 使同一文件可重复选择
  fileInput.value = ''
})

// ─── 更换文件按钮 ───
changeFileBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  fileInput.click()
})

// ─── 拖拽上传 ───
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  uploadZone.classList.add('drag-over')
})

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over')
})

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault()
  uploadZone.classList.remove('drag-over')
  const file = e.dataTransfer.files[0]
  if (file) handleFile(file)
})

// ══════════════════════════════════════════
//  播放 / 暂停
// ══════════════════════════════════════════

playBtn.addEventListener('click', async () => {
  await ensureInit()
  engine.togglePlay()
  const playing = engine.isPlaying
  updatePlayUI(playing)
  playStatus.textContent = playing ? '▶ 播放中' : '⏸ 已暂停'
})

/** 同步播放按钮图标和样式 */
function updatePlayUI(playing) {
  playIcon.textContent = playing ? '⏸' : '▶'
  playBtn.classList.toggle('play-btn-glow', playing)
}

// ══════════════════════════════════════════
//  Lofi 浓度滑块
// ══════════════════════════════════════════

lofiSlider.addEventListener('input', () => {
  const val = Number(lofiSlider.value)
  lofiValue.textContent = `${Math.round(val * 100)}%`
  if (isInitialized) {
    engine.setLofiIntensity(val)
  }
})

// ══════════════════════════════════════════
//  环境白噪音音量滑块
// ══════════════════════════════════════════

bgSlider.addEventListener('input', () => {
  const val = Number(bgSlider.value)
  bgValue.textContent = `${val} dB`
  if (isInitialized) {
    engine.setBgVolume(val)
  }
})

// ══════════════════════════════════════════
//  启动日志
// ══════════════════════════════════════════

console.log('☕ CafeVibe — UI 就绪，等待用户交互')
