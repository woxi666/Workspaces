import Matter from 'matter-js'
import { playSound } from './audio'

export type BabyType = 'normal' | 'bomb' | 'speed' | 'giant'
export interface BlockDef { x: number; y: number; w: number; h: number; kind: 'wood' | 'ice' | 'stone' }
export interface LevelDef {
  name: string
  babies: BabyType[]
  blocks: BlockDef[]
  enemies: { x: number; y: number }[]
  starScores: [number, number]
}
export type GameEvent =
  | { type: 'score'; score: number }
  | { type: 'queue'; queue: BabyType[] }
  | { type: 'phase'; phase: Phase; baby?: BabyType }
  | { type: 'win'; score: number }
  | { type: 'lose' }

export type Phase = 'aiming' | 'dragging' | 'flying' | 'settling'

export const W = 1280
export const H = 720
const GROUND = 640
const SLING = { x: 205, y: 540 }
const MAX_PULL = 150
const LAUNCH_K = 0.1
const GRAVITY = 0.55

const { Engine, Bodies, Body, Composite, Events, Vector } = Matter

const BABY_CONF: Record<BabyType, { r: number; density: number; img: string }> = {
  normal: { r: 26, density: 0.0022, img: '/assets/baby_normal.png' },
  bomb: { r: 26, density: 0.0022, img: '/assets/baby_bomb.png' },
  speed: { r: 24, density: 0.0017, img: '/assets/baby_speed.png' },
  giant: { r: 37, density: 0.0045, img: '/assets/baby_giant.png' },
}

const BLOCK_STYLE = {
  wood: { fill: '#c08245', edge: '#8f5a28', density: 0.0011 },
  ice: { fill: 'rgba(168,220,246,0.92)', edge: '#e4f5ff', density: 0.0008 },
  stone: { fill: '#9a9aa5', edge: '#686872', density: 0.0026 },
} as const

interface Particle {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number
  size: number; color: string; grav: number
}
interface TextPop { x: number; y: number; text: string; life: number; color: string }

export class GameEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private engine: Matter.Engine
  private level: LevelDef
  private onEvent: (e: GameEvent) => void
  private raf = 0
  private destroyed = false

  private images: Record<string, HTMLImageElement> = {}
  private phase: Phase = 'aiming'
  private queue: BabyType[] = []
  private baby: Matter.Body | null = null
  private babyType: BabyType = 'normal'
  private babyAge = 0
  private stillFrames = 0
  private abilityUsed = false
  private boostTrail = 0
  private score = 0
  private settleTimer = 0
  private settleStuck = 0
  private winTimer = -1
  private shake = 0
  private cam = { x: 0, y: 0 }
  private shotsUsed = 0
  private crushTimers = new Map<number, number>()
  private pressured = new Set<number>()
  private particles: Particle[] = []
  private texts: TextPop[] = []

  constructor(canvas: HTMLCanvasElement, level: LevelDef, onEvent: (e: GameEvent) => void) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.level = level
    this.onEvent = onEvent
    this.engine = Engine.create()
    this.engine.gravity.y = GRAVITY
    this.loadImages()
    this.buildWorld()
    this.queue = [...level.babies]
    Events.on(this.engine, 'collisionStart', this.onCollision)
    Events.on(this.engine, 'collisionActive', this.onCrush)
    canvas.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    this.spawnNextBaby()
    this.loop()
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    Events.off(this.engine, 'collisionStart', this.onCollision)
    Events.off(this.engine, 'collisionActive', this.onCrush)
    this.canvas.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    Composite.clear(this.engine.world, false)
    Engine.clear(this.engine)
  }

  // ---------- setup ----------

  private loadImages() {
    const files: Record<string, string> = {
      bg: '/assets/bg.jpg',
      enemy: '/assets/enemy.png',
    }
    for (const t of Object.keys(BABY_CONF) as BabyType[]) files[t] = BABY_CONF[t].img
    for (const [k, src] of Object.entries(files)) {
      const im = new Image()
      im.src = src
      this.images[k] = im
    }
  }

  private buildWorld() {
    const world = this.engine.world
    const ground = Bodies.rectangle(W / 2, GROUND + 60, W + 600, 120, {
      isStatic: true, label: 'ground', friction: 0.9,
    })
    const leftWall = Bodies.rectangle(-80, H / 2, 60, H * 2, { isStatic: true, label: 'wall' })
    // 空气墙：右侧 + 高空顶棚，防止怪物/奶蛙飞出地图
    const rightWall = Bodies.rectangle(W + 60, H / 2 - 600, 60, H * 3, { isStatic: true, label: 'wall' })
    const ceiling = Bodies.rectangle(W / 2, -560, W + 600, 60, { isStatic: true, label: 'wall' })
    Composite.add(world, [ground, leftWall, rightWall, ceiling])

    for (const b of this.level.blocks) {
      const s = BLOCK_STYLE[b.kind]
      const body = Bodies.rectangle(b.x, b.y, b.w, b.h, {
        label: 'block', density: s.density, friction: 0.55, restitution: 0.05,
      })
      ;(body as unknown as { kind: string }).kind = b.kind
      Composite.add(world, body)
    }
    for (const e of this.level.enemies) {
      const body = Bodies.circle(e.x, e.y, 23, {
        label: 'enemy', density: 0.0014, friction: 0.5, restitution: 0.25,
      })
      Composite.add(world, body)
    }
  }

  // ---------- baby lifecycle ----------

  private spawnNextBaby() {
    // 奶蛙无限使用：队列用尽后按本关配置循环补给
    if (this.queue.length === 0) this.queue = [...this.level.babies]
    const next = this.queue[0]
    if (!next) return
    this.babyType = next
    const conf = BABY_CONF[next]
    // 注意：必须先创建动态体再 setStatic(true)，否则 _original 不会被保存，
    // 之后 setStatic(false) 无法恢复质量，奶蛙坐标会变 NaN（空中消失）
    this.baby = Bodies.circle(SLING.x, SLING.y, conf.r, {
      label: 'baby', density: conf.density, restitution: 0.35,
      friction: 0.6, frictionAir: 0.008,
    })
    Body.setStatic(this.baby, true)
    ;(this.baby as unknown as { visualScale: number }).visualScale = 1
    Composite.add(this.engine.world, this.baby)
    this.phase = 'aiming'
    this.abilityUsed = false
    this.babyAge = 0
    this.stillFrames = 0
    this.emitPhase()
    this.onEvent({ type: 'queue', queue: [...this.queue] })
  }

  // 非线性发射曲线：轻拉柔和（瞄准精准），拉到底初速度提升 50%
  private launchVelocity(pull: Matter.Vector) {
    const ratio = Math.min(Vector.magnitude(pull) / MAX_PULL, 1)
    const k = LAUNCH_K * (0.75 + 0.75 * ratio)
    return { x: pull.x * k, y: pull.y * k }
  }

  private launch() {
    if (!this.baby) return
    const pull = Vector.sub(SLING, this.baby.position)
    Body.setStatic(this.baby, false)
    Body.setVelocity(this.baby, this.launchVelocity(pull))
    this.queue.shift()
    this.shotsUsed++
    this.phase = 'flying'
    this.babyAge = 0
    playSound('launch')
    this.emitPhase()
    this.onEvent({ type: 'queue', queue: [...this.queue] })
  }

  private removeBaby() {
    if (this.baby) {
      Composite.remove(this.engine.world, this.baby)
      this.baby = null
    }
    this.phase = 'settling'
    this.settleTimer = 0
    this.settleStuck = 0
    this.emitPhase()
  }

  private emitPhase() {
    this.onEvent({ type: 'phase', phase: this.phase, baby: this.babyType })
  }

  // ---------- abilities ----------

  private triggerAbility() {
    if (!this.baby || this.abilityUsed || this.phase !== 'flying') return
    this.abilityUsed = true
    playSound('ability')
    const b = this.baby
    if (this.babyType === 'bomb') {
      this.explode(b.position)
      Composite.remove(this.engine.world, b)
      this.baby = null
      this.phase = 'settling'
      this.settleTimer = 0
      this.settleStuck = 0
      this.emitPhase()
    } else if (this.babyType === 'speed') {
      const v = b.velocity
      const sp = Math.max(Vector.magnitude(v), 1)
      const boost = Math.max(sp * 2.4, 20)
      Body.setVelocity(b, { x: (v.x / sp) * boost, y: (v.y / sp) * boost })
      this.boostTrail = 26
      this.burst(b.position.x, b.position.y, 10, '#7ec8ff', 4)
    } else if (this.babyType === 'giant') {
      Body.scale(b, 1.45, 1.45)
      Body.setDensity(b, 0.007)
      ;(b as unknown as { visualScale: number }).visualScale = 1.45
      this.shake = 8
      this.burst(b.position.x, b.position.y, 14, '#c9a0ff', 5)
    } else {
      this.burst(b.position.x, b.position.y, 6, '#ffd94d', 3)
    }
  }

  private explode(p: { x: number; y: number }) {
    const R = 235
    playSound('explode')
    this.shake = 20
    for (const body of Composite.allBodies(this.engine.world)) {
      if (body.isStatic) continue
      const d = Vector.magnitude(Vector.sub(body.position, p))
      if (d > R) continue
      const f = 1 - d / R
      if (body.label === 'enemy') {
        this.killEnemy(body)
        continue
      }
      if (body.label === 'block' && (body as unknown as { kind: string }).kind === 'ice') {
        this.breakIce(body)
        continue
      }
      const dir = Vector.normalise(Vector.sub(body.position, p))
      const imp = f * 18.5
      Body.setVelocity(body, {
        x: body.velocity.x + dir.x * imp,
        y: body.velocity.y + dir.y * imp - 4.5,
      })
    }
    // fire + smoke
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 2 + Math.random() * 7
      this.particles.push({
        x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
        life: 0, maxLife: 30 + Math.random() * 20,
        size: 6 + Math.random() * 10,
        color: ['#ff9d2e', '#ff5f2e', '#ffd94d', '#555'][Math.floor(Math.random() * 4)],
        grav: -0.05,
      })
    }
  }

  // ---------- collisions ----------

  private onCollision = (ev: Matter.IEventCollision<Matter.Engine>) => {
    for (const pair of ev.pairs) {
      const { bodyA, bodyB } = pair
      const rel = Vector.magnitude(Vector.sub(bodyA.velocity, bodyB.velocity))
      for (const b of [bodyA, bodyB]) {
        if (b.label === 'enemy') {
          const other = b === bodyA ? bodyB : bodyA
          const enemySpeed = Vector.magnitude(b.velocity)
          const otherSpeed = Vector.magnitude(other.velocity)
          // 奶蛙直接命中
          const hitByBaby = other.label === 'baby' && rel > 4.5
          // 积木砸死：积木必须在运动中（砸落/倒塌），轻轻碰到不死
          const smashedByBlock = other.label === 'block' && otherSpeed > 3.0 && rel > 3.5
          // 高处摔落或被崩飞撞到地面/墙（约 110px 以上落差致命）
          const slammed = other.isStatic && enemySpeed > 5.0
          // 自身高速撞到任何东西（如被爆炸崩飞）
          const flying = enemySpeed > 7 && rel > 6
          if (hitByBaby || smashedByBlock || slammed || flying) this.killEnemy(b)
        } else if (b.label === 'block' && (b as unknown as { kind: string }).kind === 'ice' && rel > 9) {
          this.breakIce(b)
        } else if (b.label === 'baby' && rel > 4) {
          playSound('hit')
        }
      }
    }
  }

  // 积木压住怪：collisionActive 每帧触发，记录被上方积木压住的敌人
  private onCrush = (ev: Matter.IEventCollision<Matter.Engine>) => {
    for (const pair of ev.pairs) {
      const { bodyA, bodyB } = pair
      const enemy = bodyA.label === 'enemy' ? bodyA : bodyB.label === 'enemy' ? bodyB : null
      const other = enemy ? (enemy === bodyA ? bodyB : bodyA) : null
      if (enemy && other && other.label === 'block' && other.position.y < enemy.position.y - 4) {
        this.pressured.add(enemy.id)
      }
    }
  }

  private killEnemy(body: Matter.Body) {
    if (!Composite.get(this.engine.world, body.id, 'body')) return
    Composite.remove(this.engine.world, body)
    this.score += 500
    this.onEvent({ type: 'score', score: this.score })
    playSound('poof')
    this.texts.push({ x: body.position.x, y: body.position.y - 20, text: '+500', life: 0, color: '#ffdd33' })
    this.burst(body.position.x, body.position.y, 16, '#9fdc7a', 5)
    const left = Composite.allBodies(this.engine.world).filter((b) => b.label === 'enemy').length
    if (left === 0) this.winTimer = 70
  }

  private breakIce(body: Matter.Body) {
    if (!Composite.get(this.engine.world, body.id, 'body')) return
    Composite.remove(this.engine.world, body)
    this.score += 100
    this.onEvent({ type: 'score', score: this.score })
    playSound('hit')
    this.texts.push({ x: body.position.x, y: body.position.y, text: '+100', life: 0, color: '#aee6ff' })
    this.burst(body.position.x, body.position.y, 8, '#cfefff', 3)
  }

  private burst(x: number, y: number, n: number, color: string, size: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 1 + Math.random() * 4
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
        life: 0, maxLife: 24 + Math.random() * 18,
        size: size * (0.6 + Math.random() * 0.8), color, grav: 0.12,
      })
    }
  }

  // ---------- input ----------

  private toWorld(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * W + this.cam.x,
      y: ((e.clientY - r.top) / r.height) * H + this.cam.y,
    }
  }

  private onDown = (e: PointerEvent) => {
    const p = this.toWorld(e)
    if (this.phase === 'aiming' && this.baby) {
      if (Vector.magnitude(Vector.sub(p, this.baby.position)) < 75) {
        this.phase = 'dragging'
        this.emitPhase()
      }
    } else if (this.phase === 'flying') {
      this.triggerAbility()
    }
  }

  private onMove = (e: PointerEvent) => {
    if (this.phase !== 'dragging' || !this.baby) return
    const p = this.toWorld(e)
    const d = Vector.sub(p, SLING)
    const len = Vector.magnitude(d)
    const clamped = len > MAX_PULL ? Vector.mult(Vector.normalise(d), MAX_PULL) : d
    const pos = Vector.add(SLING, clamped)
    Body.setPosition(this.baby, pos)
    if (len > 20 && Math.random() < 0.3) playSound('stretch')
  }

  private onUp = () => {
    if (this.phase !== 'dragging' || !this.baby) return
    const pull = Vector.magnitude(Vector.sub(SLING, this.baby.position))
    if (pull < 14) {
      // too weak — snap back
      Body.setPosition(this.baby, SLING)
      this.phase = 'aiming'
      this.emitPhase()
      return
    }
    this.launch()
  }

  // ---------- update ----------

  private loop = () => {
    if (this.destroyed) return
    this.step()
    this.render()
    this.raf = requestAnimationFrame(this.loop)
  }

  private step() {
    Engine.update(this.engine, 1000 / 60)

    // baby in flight bookkeeping
    if (this.baby && this.phase === 'flying') {
      this.babyAge++
      const b = this.baby
      if (this.boostTrail > 0) {
        this.boostTrail--
        this.particles.push({
          x: b.position.x, y: b.position.y, vx: -b.velocity.x * 0.15, vy: -b.velocity.y * 0.15,
          life: 0, maxLife: 18, size: 8, color: 'rgba(126,200,255,0.8)', grav: 0,
        })
      }
      const sp = Vector.magnitude(b.velocity)
      const out = b.position.x > W + 200 || b.position.y > H + 150
      if (out || this.babyAge > 600) this.removeBaby()
      else if (sp < 0.45 && this.babyAge > 40) {
        this.stillFrames++
        if (this.stillFrames > 75) this.removeBaby()
      } else this.stillFrames = 0
    }

    // 积木压住怪：持续受压 ~0.7 秒后压死；压力解除则快速恢复
    for (const id of this.pressured) {
      const t = (this.crushTimers.get(id) ?? 0) + 1
      this.crushTimers.set(id, t)
      if (t > 40) {
        const body = Composite.get(this.engine.world, id, 'body') as Matter.Body | null
        if (body && body.label === 'enemy') this.killEnemy(body)
        this.crushTimers.delete(id)
      }
    }
    for (const id of [...this.crushTimers.keys()]) {
      if (!this.pressured.has(id)) {
        const t = (this.crushTimers.get(id) ?? 0) - 3
        if (t <= 0) this.crushTimers.delete(id)
        else this.crushTimers.set(id, t)
      }
    }
    this.pressured.clear()

    // cleanup escaped bodies; enemies leaving screen die
    for (const body of Composite.allBodies(this.engine.world)) {
      if (body.isStatic || body === this.baby) continue
      if (body.position.x > W + 250 || body.position.y > H + 200 || body.position.x < -250) {
        if (body.label === 'enemy') this.killEnemy(body)
        else Composite.remove(this.engine.world, body)
      }
    }

    // settling → 下一只奶蛙（无限补给，永不失败）
    if (this.phase === 'settling' && this.winTimer < 0) {
      const moving = Composite.allBodies(this.engine.world).some(
        (b) => !b.isStatic && Vector.magnitude(b.velocity) > 0.7,
      )
      if (!moving) this.settleTimer++
      else this.settleTimer = 0
      this.settleStuck++
      if (this.settleTimer > 30 || this.settleStuck > 600) {
        this.settleStuck = 0
        this.settleTimer = 0
        this.spawnNextBaby() // 队列空时会自动循环补给
      }
    }

    if (this.winTimer > 0) {
      this.winTimer--
      if (this.winTimer === 0) {
        // 奖励：用次数少于本关标配才有加分
        const bonus = Math.max(0, this.level.babies.length - this.shotsUsed) * 200
        this.score += bonus
        if (bonus > 0) this.texts.push({ x: W / 2, y: 200, text: `节省奶蛙奖励 +${bonus}`, life: 0, color: '#ffd94d' })
        playSound('win')
        this.onEvent({ type: 'win', score: this.score })
      }
    }

    // particles
    for (const p of this.particles) {
      p.life++
      p.x += p.vx
      p.y += p.vy
      p.vy += p.grav
    }
    this.particles = this.particles.filter((p) => p.life < p.maxLife)
    for (const t of this.texts) {
      t.life++
      t.y -= 0.8
    }
    this.texts = this.texts.filter((t) => t.life < 60)
    if (this.shake > 0.3) this.shake *= 0.88
    else this.shake = 0

    // 镜头跟随：奶蛙飞行时平滑跟随，其余时间回到原位
    let tx = 0
    let ty = 0
    if (this.baby && this.phase === 'flying') {
      tx = Math.min(Math.max(this.baby.position.x - W * 0.38, 0), 120)
      ty = Math.min(Math.max(this.baby.position.y - H * 0.42, -340), 0)
    }
    this.cam.x += (tx - this.cam.x) * 0.08
    this.cam.y += (ty - this.cam.y) * 0.08
  }

  // ---------- render ----------

  private render() {
    const { ctx } = this
    ctx.save()
    ctx.clearRect(0, 0, W, H)
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake)
    ctx.translate(-this.cam.x, -this.cam.y)

    // 天空底色（镜头上移时露出背景图上方的区域）
    const sky = ctx.createLinearGradient(0, this.cam.y, 0, H)
    sky.addColorStop(0, '#5eb8f0')
    sky.addColorStop(1, '#a8dcf7')
    ctx.fillStyle = sky
    ctx.fillRect(this.cam.x, this.cam.y, W, H)

    // background (cover)
    const bg = this.images.bg
    if (bg && bg.complete && bg.naturalWidth > 0) {
      const scale = Math.max(W / bg.naturalWidth, H / bg.naturalHeight)
      const bw = bg.naturalWidth * scale
      const bh = bg.naturalHeight * scale
      ctx.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh)
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#8ed1f7')
      g.addColorStop(1, '#d8f2c8')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }
    // dirt strip under ground line (加宽加高，覆盖镜头移动范围)
    ctx.fillStyle = 'rgba(90,60,35,0.9)'
    ctx.fillRect(-100, GROUND + 6, W + 400, H - GROUND + 400)
    ctx.fillStyle = 'rgba(120,200,90,0.95)'
    ctx.fillRect(-100, GROUND, W + 400, 8)

    this.drawSlingBack()

    for (const body of Composite.allBodies(this.engine.world)) {
      if (body.label === 'block') this.drawBlock(body)
      else if (body.label === 'enemy') this.drawEnemy(body)
    }
    if (this.baby) this.drawBaby(this.baby, this.babyType)
    if (this.phase === 'dragging' && this.baby) this.drawTrajectory()

    this.drawSlingFront()
    this.drawParticles()
    ctx.restore()
  }

  private drawSlingBack() {
    const { ctx } = this
    ctx.strokeStyle = '#7a4a21'
    ctx.lineCap = 'round'
    ctx.lineWidth = 9
    ctx.beginPath()
    ctx.moveTo(SLING.x - 4, GROUND + 4)
    ctx.lineTo(SLING.x - 14, SLING.y - 16)
    ctx.stroke()
    if (this.baby && (this.phase === 'dragging' || this.phase === 'aiming')) {
      ctx.strokeStyle = '#3d2b1a'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(SLING.x - 14, SLING.y - 16)
      ctx.lineTo(this.baby.position.x, this.baby.position.y)
      ctx.stroke()
    }
  }

  private drawSlingFront() {
    const { ctx } = this
    ctx.strokeStyle = '#8f5a28'
    ctx.lineCap = 'round'
    ctx.lineWidth = 9
    ctx.beginPath()
    ctx.moveTo(SLING.x - 2, GROUND + 4)
    ctx.lineTo(SLING.x + 14, SLING.y - 12)
    ctx.stroke()
    if (this.baby && (this.phase === 'dragging' || this.phase === 'aiming')) {
      ctx.strokeStyle = '#4a3520'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(SLING.x + 14, SLING.y - 12)
      ctx.lineTo(this.baby.position.x, this.baby.position.y)
      ctx.stroke()
    }
  }

  private drawBaby(body: Matter.Body, type: BabyType) {
    const { ctx } = this
    const im = this.images[type]
    const conf = BABY_CONF[type]
    const vs = (body as unknown as { visualScale?: number }).visualScale ?? 1
    const size = conf.r * 2.55 * vs
    ctx.save()
    ctx.translate(body.position.x, body.position.y)
    ctx.rotate(body.angle)
    if (im && im.complete && im.naturalWidth > 0) {
      ctx.drawImage(im, -size / 2, -size / 2, size, size * (im.naturalHeight / im.naturalWidth))
    } else {
      ctx.fillStyle = '#ffd94d'
      ctx.beginPath()
      ctx.arc(0, 0, conf.r * vs, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private drawEnemy(body: Matter.Body) {
    const { ctx } = this
    const im = this.images.enemy
    const size = 60
    ctx.save()
    ctx.translate(body.position.x, body.position.y)
    ctx.rotate(body.angle)
    if (im && im.complete && im.naturalWidth > 0) {
      ctx.drawImage(im, -size / 2, -size / 2, size, size * (im.naturalHeight / im.naturalWidth))
    } else {
      ctx.fillStyle = '#7a9a5a'
      ctx.beginPath()
      ctx.arc(0, 0, 23, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private drawBlock(body: Matter.Body) {
    const { ctx } = this
    const kind = (body as unknown as { kind: keyof typeof BLOCK_STYLE }).kind
    const s = BLOCK_STYLE[kind]
    const w = (body.bounds.max.x - body.bounds.min.x)
    const h = (body.bounds.max.y - body.bounds.min.y)
    // use stored shape dims via vertices extent along axes — simpler: render rectangle from angle & part dims
    const dims = this.blockDims(body, w, h)
    ctx.save()
    ctx.translate(body.position.x, body.position.y)
    ctx.rotate(body.angle)
    ctx.fillStyle = s.fill
    ctx.strokeStyle = s.edge
    ctx.lineWidth = 3
    this.roundRect(-dims.w / 2, -dims.h / 2, dims.w, dims.h, Math.min(5, dims.h / 2))
    ctx.fill()
    ctx.stroke()
    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    this.roundRect(-dims.w / 2 + 3, -dims.h / 2 + 2, dims.w - 6, Math.max(3, dims.h * 0.28), 3)
    ctx.fill()
    ctx.restore()
  }

  private blockDims(body: Matter.Body, w: number, h: number): { w: number; h: number } {
    // bounds are axis-aligned; swap back when rotated ~90°
    if (Math.abs(Math.sin(body.angle)) > 0.7) return { w: h, h: w }
    return { w, h }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const { ctx } = this
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  private drawTrajectory() {
    if (!this.baby) return
    const { ctx } = this
    const pull = Vector.sub(SLING, this.baby.position)
    const v = this.launchVelocity(pull)
    const p = { x: SLING.x, y: SLING.y }
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    for (let i = 0; i < 42; i++) {
      p.x += v.x
      p.y += v.y
      v.x *= 0.992
      v.y = v.y * 0.992 + 0.278 * GRAVITY
      if (i % 3 === 0) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, Math.max(2, 5 - i * 0.08), 0, Math.PI * 2)
        ctx.fill()
      }
      if (p.y > GROUND) break
    }
  }

  private drawParticles() {
    const { ctx } = this
    for (const p of this.particles) {
      const t = 1 - p.life / p.maxLife
      ctx.globalAlpha = t
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.textAlign = 'center'
    ctx.font = 'bold 22px system-ui, sans-serif'
    for (const t of this.texts) {
      ctx.globalAlpha = 1 - t.life / 60
      ctx.fillStyle = t.color
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'
      ctx.lineWidth = 3
      ctx.strokeText(t.text, t.x, t.y)
      ctx.fillText(t.text, t.x, t.y)
    }
    ctx.globalAlpha = 1
  }
}
