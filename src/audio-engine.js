/**
 * CafeVibe — 音频引擎核心模块
 *
 * 基于 Tone.js 封装，纯前端 Web Audio API 驱动，零后端依赖。
 *
 * ── 信号路由 ──
 *   主音乐: Player → Gain("volume") → PitchShift → Filter(lowpass) → Destination
 *   背景音: Noise → Filter → Gain → Gain("bgVolume") → Destination
 *
 * ── 使用示例 ──
 *   import { AudioEngine } from './audio-engine.js'
 *   const engine = new AudioEngine()
 *   await engine.init()                 // 初始化（需用户手势触发）
 *   engine.loadMusic('audio/song.mp3')  // 加载并播放音乐
 *   engine.loadBgNoise()                // 生成并循环播放环境噪音
 *   engine.setLofiIntensity(0.6)        // 调节 Lofi 强度
 *   engine.setBgVolume(-10)             // 调节背景音量（dB）
 */
import * as Tone from 'tone'

export class AudioEngine {
  constructor() {
    // ─── 主音乐信号链节点 ───
    /** 主音乐播放器 */
    this.player = null
    /** 主音乐音量控制 */
    this.volumeNode = null
    /** 变调效果器（核心卖点：变奏） */
    this.pitchShift = null
    /** 低通滤波器（核心卖点：Lofi 闷感） */
    this.filter = null

    // ─── 暂停/恢复状态 ───
    /** 累计已播放的位置（秒），用于暂停后恢复 */
    this._musicPosition = 0
    /** 最近一次调用 start() 时的 AudioContext 时间戳 */
    this._musicStartTime = 0
    /** 当前是否正在播放 */
    this._isPlaying = false

    // ─── 背景音信号链节点 ───
    /** 背景音播放器（音频文件） */
    this.bgPlayer = null
    /** 背景音音量控制 */
    this.bgVolumeNode = null
    /** 程序生成的环境噪音节点合集 */
    this._bgNoiseNodes = null

    // ─── 即兴生成音乐状态 ───
    /** 是否正在播放生成音乐 */
    this._isGenerating = false
    /** 生成音乐的音源/序列引用，用于停止时清理 */
    this._genNodes = null

    /** 是否已初始化 */
    this.initialized = false
  }

  // ══════════════════════════════════════════
  //  初始化
  // ══════════════════════════════════════════

  /**
   * 启动音频上下文并搭建整个信号路由拓扑。
   * 必须在用户手势（click / touch）回调中调用，否则浏览器会拒绝 AudioContext。
   *
   * @returns {Promise<boolean>} 是否首次成功初始化
   */
  async init() {
    if (this.initialized) {
      console.log('ℹ️ AudioEngine 已初始化，跳过重复调用')
      return false
    }

    // 1. 启动 Tone.js 底层 AudioContext
    await Tone.start()
    console.log('🔊 AudioContext 已启动')

    // ─── 2. 搭建主音乐信号链 ───
    //
    // 音量 → 变调(变奏) → 低通滤波(Lofi) → 输出
    //

    this.volumeNode = new Tone.Gain(0.8).toDestination()

    this.pitchShift = new Tone.PitchShift({
      pitch: 0,        // 半音偏移量，0 表示不偏移
      windowSize: 0.1, // 窗口大小（秒），越小响应越快
    })

    this.filter = new Tone.Filter({
      type: 'lowpass',    // 低通滤波器
      frequency: 20000,   // 初始截止频率（接近全通）
      rolloff: -24,       // 衰减斜率 -24dB/oct，更陡峭的 Lofi 感
      Q: 0.5,             // 共振峰，轻微强调截止点附近
    })

    // 串联：player → volumeNode → pitchShift → filter → Destination
    this.volumeNode.disconnect()
    this.volumeNode.chain(this.pitchShift, this.filter, Tone.Destination)
    // 注意：player 会在 loadMusic 时动态连接到 volumeNode

    // ─── 3. 搭建背景音信号链 ───
    this.bgVolumeNode = new Tone.Gain(-20).toDestination() // 默认 -20dB，不喧宾夺主
    // bgPlayer / 噪音节点会在加载时动态连接到这里

    this.initialized = true
    console.log('✅ AudioEngine 信号路由已搭建')
    return true
  }

  // ══════════════════════════════════════════
  //  主音乐 — 加载 & 播放控制
  // ══════════════════════════════════════════

  /**
   * 加载一段音乐。加载完成后可调用 play() 开始播放。
   * 如果已存在音乐，会自动停止并销毁旧实例。
   *
   * @param {string} url       音频文件路径（http URL 或 blob: URL 均可）
   * @param {object} [options] 可选配置
   * @param {number} [options.fadeIn=2] 渐入时长（秒）
   * @returns {Promise<void>}
   */
  async loadMusic(url, options = {}) {
    const { fadeIn = 2 } = options

    // 如果正在播放生成音乐，先停掉
    this.stopGenerativeMusic()
    // 释放上一次的播放器
    this._disposePlayer()
    this._musicPosition = 0
    this._isPlaying = false

    // 用 Promise 包装，等 onload 触发才返回（确保 buffer 真正就绪）
    return new Promise((resolve, reject) => {
      try {
        this.player = new Tone.Player({
          url,
          loop: false,
          fadeIn,
          onload: () => {
            console.log(`🎶 音乐已加载`)
            resolve()
          },
        })

        // 连接到音量节点（后面就是 pitchShift → filter → Destination）
        this.player.connect(this.volumeNode)

        // 如果 buffer 同步加载完成了（极少情况），手动 resolve
        if (this.player.loaded) resolve()
      } catch (err) {
        console.error('❌ 加载音乐失败:', err)
        this._disposePlayer()
        reject(err)
      }
    })
  }

  /**
   * 开始或恢复主音乐播放。
   * 从上次暂停的位置继续，首次播放从头开始。
   */
  play() {
    if (!this.player || this._isPlaying) return

    Tone.Transport.start()
    this.player.start(undefined, this._musicPosition)
    this._musicStartTime = Tone.now()
    this._isPlaying = true
    console.log('▶️ 主音乐播放')
  }

  /**
   * 暂停主音乐，记录当前播放位置。
   */
  pause() {
    if (!this.player || !this._isPlaying) return

    // 计算本次播放时段经过的秒数，累加到总位置中
    const elapsed = Tone.now() - this._musicStartTime
    this._musicPosition += Math.max(0, elapsed)
    this.player.stop()
    this._isPlaying = false
    console.log(`⏸ 主音乐暂停 (位置: ${this._musicPosition.toFixed(1)}s)`)
  }

  /**
   * 切换播放/暂停状态。
   */
  togglePlay() {
    if (this._isPlaying) {
      this.pause()
    } else {
      this.play()
    }
  }

  /**
   * 停止主音乐并重置位置到头。
   */
  stopMusic() {
    if (this.player) {
      this.player.stop()
    }
    this._isPlaying = false
    this._musicPosition = 0
    console.log('⏹ 主音乐已停止')
  }

  /** 当前主音乐是否正在播放 */
  get isPlaying() {
    return this._isPlaying
  }

  // ══════════════════════════════════════════
  //  背景音 — 程序生成环境噪音
  // ══════════════════════════════════════════

  /**
   * 用 Web Audio API 程序生成背景环境噪音（无需外部音频文件）。
   *
   * 使用 Tone.Noise("brown")（布朗噪音）经过低通滤波，模拟雨声/环境底噪。
   * 优点：即时可用、无需加载、循环无接缝。
   *
   * @param {'brown'|'pink'|'white'} [type='brown'] 噪音类型
   *   - 'brown'：低频丰富，模拟雨声最自然（默认）
   *   - 'pink'： 更均匀，适合粉红噪音
   *   - 'white'：全频白噪音，较尖锐
   * @param {object} [options] 可选参数
   * @param {number} [options.filterFreq=1200] 低通滤波器截止频率，越低声音越闷
   * @param {number} [options.gain=0.3]        噪音增益
   */
  loadBgNoise(type = 'brown', options = {}) {
    const { filterFreq = 1200, gain = 0.3 } = options

    // 释放旧噪音
    this._disposeBgNoise()

    // 布朗噪音 → 低通 → 音量 → bgVolumeNode → Destination
    const noise = new Tone.Noise(type)
    const filter = new Tone.Filter(filterFreq, 'lowpass')
    const gainNode = new Tone.Gain(gain)

    noise.chain(filter, gainNode, this.bgVolumeNode)

    // 保存引用以便后续销毁
    this._bgNoiseNodes = { noise, filter, gain: gainNode }

    Tone.Transport.start()
    noise.start()
    console.log(`🌧 环境噪音已启动 (${type}, 滤波 ${filterFreq}Hz)`)
  }

  /**
   * 停止程序生成的环境噪音。
   */
  stopBgNoise() {
    this._disposeBgNoise()
  }

  /**
   * 停止背景音（同时兼容文件播放器和噪音）。
   */
  stopBg() {
    this.stopBgNoise()
    if (this.bgPlayer) {
      this.bgPlayer.stop()
      this.bgPlayer.dispose()
      this.bgPlayer = null
    }
  }

  // ══════════════════════════════════════════
  //  即兴音乐生成 — 无文件也能出声
  // ══════════════════════════════════════════

  /**
   * 启动一段即兴咖啡馆背景音乐（Tone.js 合成器实时生成）。
   *
   * 用内置合成器实时演奏一段舒缓的爵士和弦循环 + 轻 Lo-fi 鼓点，
   * 走与上传文件相同的效果链（pitchShift → filter），所以
   * setLofiIntensity() 对生成音乐同样生效。
   *
   * 调用后会自动停掉已上传文件的播放。
   */
  startGenerativeMusic() {
    // 停止之前正在生成的音乐
    this.stopGenerativeMusic()
    // 停止已上传文件的播放
    if (this.player) { this.stopMusic() }

    // ─── 参数 ───
    const bpm = 75
    Tone.Transport.bpm.value = bpm

    // ─── 和弦进行 (C大调 爵士旅馆经典走向) ───
    //   Cmaj7 → Am7 → Dm7 → G7
    // 每和弦持续 2 小节 = 8 拍
    const progression = [
      { chords: ['C3', 'E3', 'G3', 'B3'], root: 'C2' },
      { chords: ['A2', 'C3', 'E3', 'G3'], root: 'A2' },
      { chords: ['D3', 'F3', 'A3', 'C4'], root: 'D2' },
      { chords: ['G2', 'B2', 'D3', 'F3'], root: 'G2' },
    ]

    // ─── ① 和弦垫 (PolySynth) ───
    const padSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 1.5,
      modulationIndex: 1.2,
      carrier: { partials: [1, 0.3, 0.1] },
      modulation: { partials: [1, 0.2] },
      volume: -12,
    }).connect(this.volumeNode)

    // 每个和弦持续 2 小节，循环播放
    let chordIndex = 0
    const chordInterval = '2m'
    const chordEvent = Tone.Transport.scheduleRepeat((time) => {
      const { chords } = progression[chordIndex % progression.length]
      padSynth.triggerAttackRelease(chords, '1m', time)
      chordIndex++
    }, chordInterval)

    // ─── ② 贝斯根音 (Synth) ───
    const bassSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.2, release: 0.5 },
      volume: -16,
    }).connect(this.volumeNode)

    let bassIndex = 0
    const bassEvent = Tone.Transport.scheduleRepeat((time) => {
      const { root } = progression[bassIndex % progression.length]
      // 每个根音弹两个长音
      bassSynth.triggerAttackRelease(root, '1n', time)
      bassIndex++
    }, '2m')

    // ─── ③ 底鼓 (MembraneSynth) ───
    const kick = new Tone.MembraneSynth({
      pitchDecay: 0.04,
      octaves: 4,
      envelope: { attack: 0.001, decay: 0.3, sustain: 0 },
      volume: -8,
    }).connect(this.volumeNode)

    const kickSeq = new Tone.Sequence(
      (time, beat) => {
        if (beat % 2 === 0) {
          kick.triggerAttackRelease('D1', '8n', time)
        }
      },
      [0, 1, 2, 3],  // 4 拍
      '1n',
    )

    // ─── ④ 开镲/闭镲 (NoiseSynth) ───
    const hat = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
      volume: -22,
    }).connect(this.volumeNode)

    const hatSeq = new Tone.Sequence(
      (time, step) => {
        // 8 分音符，step 0-7
        hat.triggerAttackRelease('16n', time)
      },
      [0, 1, 2, 3, 4, 5, 6, 7],
      '8n',
    )

    // ─── 启动 ───
    kickSeq.start(0)
    hatSeq.start(0)
    Tone.Transport.start()

    // 保存引用供停止时清理
    this._genNodes = {
      padSynth, bassSynth, kick, hat,
      chordEvent, bassEvent, kickSeq, hatSeq,
      chordIndex: 0, bassIndex: 0,
    }
    this._isGenerating = true
    console.log(`🎹 即兴音乐生成已启动 (${bpm} BPM · C大调)`)
  }

  /**
   * 停止即兴音乐生成，释放合成器/序列。
   */
  stopGenerativeMusic() {
    if (!this._genNodes) return

    const { padSynth, bassSynth, kick, hat, bassEvent, chordEvent, kickSeq, hatSeq } = this._genNodes

    try { chordEvent?.dispose() } catch (_) {}
    try { bassEvent?.dispose() } catch (_) {}
    try { kickSeq?.dispose() } catch (_) {}
    try { hatSeq?.dispose() } catch (_) {}
    try { padSynth?.dispose() } catch (_) {}
    try { bassSynth?.dispose() } catch (_) {}
    try { kick?.dispose() } catch (_) {}
    try { hat?.dispose() } catch (_) {}

    this._genNodes = null
    this._isGenerating = false
    console.log('⏹ 即兴音乐生成已停止')
  }

  /** 当前是否正在播放即兴生成音乐 */
  get isGenerating() {
    return this._isGenerating
  }

  // ══════════════════════════════════════════
  //  核心调节函数
  // ══════════════════════════════════════════

  /**
   * 设置 Lofi 强度（0 ~ 1）。
   *
   * 强度越高，效果越明显：
   *   - 低通滤波器截止频率从 20000Hz ↘ 300Hz（声音更闷）
   *   - 播放速度从 1.0 ↘ 0.85（略微放慢，更有慵懒感）
   *
   * 映射曲线采用二次缓入（ease-in），让低强度区域变化更平滑，
   * 高强度区域变化更明显，手感更自然。
   *
   * @param {number} intensity 0.0 ~ 1.0
   */
  setLofiIntensity(intensity) {
    const i = Math.max(0, Math.min(1, intensity))

    // ─── 截止频率映射（20000 → 300 Hz，对数映射） ───
    const minFreq = 300
    const maxFreq = 20000
    const curve = i * i
    const freq = maxFreq * Math.pow(minFreq / maxFreq, curve)
    this.filter.frequency.rampTo(freq, 0.1)

    // ─── 播放速度映射（1.0 → 0.85） ───
    if (this.player) {
      const playbackRate = 1.0 - i * 0.15
      this.player.playbackRate = playbackRate
    }
  }

  /**
   * 设置背景环境音的音量。
   *
   * @param {number} volume 音量值（dB，范围 -60 ~ 0）
   *                        0 = 最大音量，-60 ≈ 静音
   *                        推荐值：-25 ~ -10（不要盖过主音乐）
   */
  setBgVolume(volume) {
    if (this.bgVolumeNode) {
      const clamped = Math.max(-60, Math.min(0, volume))
      this.bgVolumeNode.gain.rampTo(Tone.dbToGain(clamped), 0.1)
    }
  }

  /**
   * 获取当前 Lofi 强度的推断值（根据滤波器的当前截止频率反算）。
   * 主要用于 UI 状态恢复，精度为近似值。
   *
   * @returns {number} 0.0 ~ 1.0
   */
  getCurrentLofiIntensity() {
    if (!this.filter) return 0
    const freq = this.filter.frequency.value
    const minFreq = 300
    const maxFreq = 20000
    const rawRatio = Math.log(freq / maxFreq) / Math.log(minFreq / maxFreq)
    return Math.sqrt(Math.max(0, Math.min(1, rawRatio)))
  }

  // ══════════════════════════════════════════
  //  内部工具
  // ══════════════════════════════════════════

  /** 释放文件播放器 */
  _disposePlayer() {
    if (this.player) {
      try { this.player.stop() } catch (_) { /* 还没开始 */ }
      this.player.dispose()
      this.player = null
    }
  }

  /** 释放程序噪音节点 */
  _disposeBgNoise() {
    if (this._bgNoiseNodes) {
      try { this._bgNoiseNodes.noise.stop() } catch (_) {}
      this._bgNoiseNodes.noise.dispose()
      this._bgNoiseNodes.filter.dispose()
      this._bgNoiseNodes.gain.dispose()
      this._bgNoiseNodes = null
    }
  }

  /**
   * 彻底销毁引擎，释放所有 Web Audio 资源。
   * 调用后该实例不再可用，需要重新 new。
   */
  dispose() {
    this.stopGenerativeMusic()
    this._disposePlayer()
    this._disposeBgNoise()
    if (this.bgPlayer) {
      try { this.bgPlayer.stop() } catch (_) {}
      this.bgPlayer.dispose()
      this.bgPlayer = null
    }
    this.volumeNode?.dispose()
    this.pitchShift?.dispose()
    this.filter?.dispose()
    this.bgVolumeNode?.dispose()
    this.initialized = false
    console.log('🧹 AudioEngine 已释放')
  }
}
