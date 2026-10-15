import Matter from 'matter-js'
import { playSound } from './audio'
import type { BabyType } from './engine'

export type MobKind = 'walker' | 'flyer' | 'bouncer'
export type ItemKind = 'ice' | 'fire' | 'hole'

export type EndlessEvent =
  | { type: 'stat'; kills: number; score: number; rage: number; rageOn: boolean; rageLeft: number; slowOn: boolean; hp: number }
  | { type: 'over'; kills: number; score: number; time: number }
  | { type: 'phase'; phase: 'aiming' | 'dragging' | 'flying'; baby: BabyType }

const W = 1280
const H = 720
const GROUND = 640
const SLING = { x: 205, y: 540 }
const MAX_PULL = 150
const LAUNCH_K = 0.1
const GRAVITY = 0.55
const FAIL_X = 130 // 怪物越过此线 = 失败
const RAGE_MAX = 50
const RAGE_TICKS = 600 // 10 秒
const MOB_CAP = 40

const { Engine, Bodies, Body, Composite, Events, Vector } = Matter

const BABY_CONF: Record<BabyType, { r: number; density: number; img: string }> = {
  normal: { r: 26, density: 0.0022, img: '/assets/baby_normal.png' },
  bomb: { r: 26, density: 0.0022, img: '/assets/baby_bomb.png' },
  speed: { r: 24, density: 0.0017, img: '/assets/baby_speed.png' },
  giant: { r: 37, density: 0.0045, img: '/assets/baby_giant.png' },
}
const BABY_CYCLE: BabyType[] = ['normal', 'bomb', 'speed', 'giant']

const MOB_SPEED: Record<MobKind, number> = { walker: 0.9, flyer: 1.4, bouncer: 1.2 }
const ITEM_IMG: Record<ItemKind, string> = {
  ice: '/assets/item_ice.png',
  fire: '/assets/item_fire.png',
  hole: '/assets/item_hole.png',
}

interface Particle {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number; size: number; color: string; grav: number
}
interface TextPop { x: number; y: number; text: string; life: number; color: string }
interface HoleEffect { x: number; y: number; left: number }

export class EndlessEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private engine: Matter.Engine
  private onEvent: (e: EndlessEvent) => void
  private raf = 0
  private destroyed = false
  private images: Record<string, HTMLImageElement> = {}

  private phase: 'aiming' | 'dragging' | 'flying' = 'aiming'
  private baby: Matter.Body | null = null // 弹弓上待发射的奶蛙
  private babyType: BabyType = 'normal'
  private flying: Matter.Body | null = null // 空中飞行的奶蛙
  private flyingType: BabyType = 'normal'
  private flyingAge = 0
  private flyingStill = 0
  private babyIdx = 0
  private abilityUsed = false
  private boostTrail = 0
  private extras: { body: Matter.Body; age: number; type: BabyType }[] = []

  private tick = 0
  private kills = 0
  private score = 0
  private hp = 3
  private flash = 0
  private rage = 0
  private rageLeft = 0
  private slowUntil = 0
  private spawnAcc = 0
  private nextItemAt = 400
  private holes: HoleEffect[] = []
  private particles: Particle[] = []
  private texts: TextPop[] = []
  private shake = 0
  private gameOver = false

  constructor(canvas: HTMLCanvasElement, onEvent: (e: EndlessEvent) => void) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.onEvent = onEvent
    this.engine = Engine.create()
    this.engine.gravity.y = GRAVITY
    this.loadImages()
    this.buildWorld()
    Events.on(this.engine, 'collisionStart', this.onCollision)
    canvas.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    this.spawnBaby()
    this.loop()
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    Events.off(this.engine, 'collisionStart', this.onCollision)
    this.canvas.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    Composite.clear(this.engine.world, false)
    Engine.clear(this.engine)
  }

  /** 怒气满了由 UI 按钮调用 */
  activateRage() {
    if (this.rage < RAGE_MAX || this.rageLeft > 0 || this.gameOver) return
    this.rage = 0
    this.rageLeft = RAGE_TICKS
    playSound('explode')
    this.shake = 10
    this.texts.push({ x: W / 2, y: 180, text: '怒气爆发！！', life: 0, color: '#ff5f2e' })
    this.emitStat()
  }

  // ---------- setup ----------

  private loadImages() {
    const files: Record<string, string> = { bg: '/assets/bg.jpg', mob: '/assets/enemy.png' }
    for (const t of Object.keys(BABY_CONF) as BabyType[]) files[t] = BABY_CONF[t].img
    for (const k of Object.keys(ITEM_IMG) as ItemKind[]) files[`item_${k}`] = ITEM_IMG[k]
    for (const [k, src] of Object.entries(files)) {
      const im = new Image()
      im.src = src
      this.images[k] = im
    }
  }

  private buildWorld() {
    const ground = Bodies.rectangle(W / 2, GROUND + 60, W + 600, 120, { isStatic: true, label: 'ground', friction: 0.9 })
    const ceiling = Bodies.rectangle(W / 2, -560, W + 600, 60, { isStatic: true, label: 'wall' })
    Composite.add(this.engine.world, [ground, ceiling])
  }

  // ---------- babies ----------

  private spawnBaby() {
    this.babyType = BABY_CYCLE[this.babyIdx % BABY_CYCLE.length]
    this.babyIdx++
    const conf = BABY_CONF[this.babyType]
    // 弹弓上的奶蛙是静态传感器：怪物可以穿过去直奔防线，不会被弹弓挡住
    this.baby = Bodies.circle(SLING.x, SLING.y, conf.r, {
      label: 'baby', density: conf.density, restitution: 0.35, friction: 0.6, frictionAir: 0.008,
      isSensor: true,
    })
    Body.setStatic(this.baby, true)
    ;(this.baby as unknown as { visualScale: number }).visualScale = 1
    Composite.add(this.engine.world, this.baby)
    this.phase = 'aiming'
    this.emitPhase()
  }

  private emitPhase() {
    // 空中有未放技能的奶蛙时，UI 显示飞行提示；否则显示弹弓状态
    if (this.flying && !this.abilityUsed) {
      this.onEvent({ type: 'phase', phase: 'flying', baby: this.flyingType })
    } else {
      this.onEvent({ type: 'phase', phase: this.phase === 'dragging' ? 'dragging' : 'aiming', baby: this.babyType })
    }
  }

  private launchVelocity(pull: Matter.Vector) {
    const ratio = Math.min(Vector.magnitude(pull) / MAX_PULL, 1)
    const k = LAUNCH_K * (0.75 + 0.75 * ratio) * (this.rageLeft > 0 ? 1.6 : 1)
    return { x: pull.x * k, y: pull.y * k }
  }

  private launch() {
    if (!this.baby) return
    const pull = Vector.sub(SLING, this.baby.position)
    const v0 = this.launchVelocity(pull)
    const launched = this.baby
    Body.setStatic(launched, false)
    launched.isSensor = false
    Body.setVelocity(launched, v0)
    // 发射后立刻补充下一只；空中的这只继续飞
    // 若上一只还在飞，移入 extras 由统一清理逻辑接管，防止泄漏
    if (this.flying) this.extras.push({ body: this.flying, age: 0, type: this.flyingType })
    this.flying = launched
    this.flyingType = this.babyType
    this.flyingAge = 0
    this.flyingStill = 0
    this.abilityUsed = false
    this.baby = null
    playSound('launch')
    // 怒气爆发：朝同一方向散射三只（主弹 ±0.38 rad 两只副弹）
    if (this.rageLeft > 0) {
      for (const a of [-0.38, 0.38]) {
        const cos = Math.cos(a)
        const sin = Math.sin(a)
        const v = { x: v0.x * cos - v0.y * sin, y: v0.x * sin + v0.y * cos }
        const conf = BABY_CONF[this.flyingType]
        const extra = Bodies.circle(launched.position.x, launched.position.y, conf.r, {
          label: 'baby', density: conf.density, restitution: 0.35, friction: 0.6, frictionAir: 0.008,
        })
        ;(extra as unknown as { visualScale: number }).visualScale = 1
        Composite.add(this.engine.world, extra)
        Body.setVelocity(extra, v)
        this.extras.push({ body: extra, age: 0, type: this.flyingType })
      }
    }
    this.spawnBaby() // 立刻补充
  }

  private retireFlying() {
    if (this.flying) {
      Composite.remove(this.engine.world, this.flying)
      this.flying = null
    }
    this.emitPhase()
  }

  // ---------- mobs ----------

  private spawnMob() {
    const alive = Composite.allBodies(this.engine.world).filter((b) => b.label === 'mob').length
    if (alive >= MOB_CAP) return
    const roll = Math.random()
    // 减少飞行的怪：走 50% / 弹 38% / 飞 12%
    const kind: MobKind = roll < 0.5 ? 'walker' : roll < 0.88 ? 'bouncer' : 'flyer'
    let body: Matter.Body
    if (kind === 'flyer') {
      const baseY = 170 + Math.random() * 230
      body = Bodies.circle(W + 40, baseY, 20, { label: 'mob', isStatic: true })
      ;(body as unknown as { mobKind: MobKind; baseY: number; phase: number }).mobKind = kind
      ;(body as unknown as { baseY: number }).baseY = baseY
      ;(body as unknown as { phase: number }).phase = Math.random() * Math.PI * 2
    } else {
      body = Bodies.circle(W + 40, GROUND - 23, 23, {
        label: 'mob', density: 0.0014, friction: 0.4, restitution: 0.25, frictionAir: 0.004,
      })
      ;(body as unknown as { mobKind: MobKind }).mobKind = kind
    }
    Composite.add(this.engine.world, body)
  }

  private mobSpeed() {
    // 怪物速度随时间递增（每分钟约 +35%，上限 2.5 倍）；冰冻期间统一减速
    if (this.tick < this.slowUntil) return 0.45
    return Math.min(2.5, 1 + (this.tick / 3600) * 0.35)
  }

  private moveMobs() {
    const slow = this.mobSpeed()
    for (const b of Composite.allBodies(this.engine.world)) {
      if (b.label !== 'mob') continue
      const kind = (b as unknown as { mobKind: MobKind }).mobKind
      if (kind === 'flyer') {
        const meta = b as unknown as { baseY: number; phase: number }
        Body.setPosition(b, {
          x: b.position.x - MOB_SPEED.flyer * slow,
          y: meta.baseY + Math.sin(this.tick * 0.04 + meta.phase) * 26,
        })
      } else if (kind === 'walker') {
        Body.setVelocity(b, { x: -MOB_SPEED.walker * slow, y: b.velocity.y })
      } else {
        // bouncer：着地就起跳
        const onGround = b.position.y > GROUND - 27 && Math.abs(b.velocity.y) < 0.6
        if (onGround) Body.setVelocity(b, { x: -MOB_SPEED.bouncer * slow, y: -6.5 })
        else Body.setVelocity(b, { x: -MOB_SPEED.bouncer * slow, y: b.velocity.y })
      }
      if (b.position.x < FAIL_X && !this.gameOver) {
        // 怪物突破防线：扣 1 滴血（共 3 滴）
        this.burst(b.position.x, b.position.y, 14, '#ff5f5f', 5)
        Composite.remove(this.engine.world, b)
        this.hp--
        this.flash = 25
        this.shake = 10
        playSound('hit')
        this.emitStat()
        if (this.hp <= 0) this.lose()
      }
    }
  }

  private killMob(body: Matter.Body, silent = false) {
    if (!Composite.get(this.engine.world, body.id, 'body')) return
    Composite.remove(this.engine.world, body)
    this.kills++
    this.score += 100
    if (this.rageLeft === 0) this.rage = Math.min(this.rage + 1, RAGE_MAX)
    if (!silent) {
      playSound('poof')
      this.texts.push({ x: body.position.x, y: body.position.y - 20, text: '+100', life: 0, color: '#ffdd33' })
      this.burst(body.position.x, body.position.y, 12, '#9fdc7a', 4)
    }
    this.emitStat()
  }

  // ---------- items ----------

  private spawnItem() {
    const kinds: ItemKind[] = ['ice', 'fire', 'hole']
    const kind = kinds[Math.floor(Math.random() * kinds.length)]
    const x = 420 + Math.random() * 780
    const body = Bodies.circle(x, -30, 18, {
      label: 'item', density: 0.0006, restitution: 0.35, friction: 0.6, frictionAir: 0.03,
    })
    ;(body as unknown as { itemKind: ItemKind; born: number }).itemKind = kind
    ;(body as unknown as { born: number }).born = this.tick
    Composite.add(this.engine.world, body)
  }

  private triggerItem(body: Matter.Body) {
    if (!Composite.get(this.engine.world, body.id, 'body')) return
    const kind = (body as unknown as { itemKind: ItemKind }).itemKind
    const p = { ...body.position }
    Composite.remove(this.engine.world, body)
    playSound('ability')
    if (kind === 'ice') {
      this.slowUntil = this.tick + 360 // 6 秒减速
      this.texts.push({ x: p.x, y: p.y - 30, text: '冰冻减速！', life: 0, color: '#7ec8ff' })
      this.burst(p.x, p.y, 18, '#aee6ff', 4)
    } else if (kind === 'fire') {
      this.texts.push({ x: p.x, y: p.y - 30, text: '火球分裂！', life: 0, color: '#ff9d2e' })
      this.burst(p.x, p.y, 16, '#ff9d2e', 5)
      // 分裂出 5 个追踪火苗
      for (let i = 0; i < 5; i++) {
        const shard = Bodies.circle(p.x, p.y, 9, {
          label: 'shard', density: 0.0005, frictionAir: 0.02, isSensor: false,
        })
        ;(shard as unknown as { born: number }).born = this.tick
        Composite.add(this.engine.world, shard)
        const a = -Math.PI / 2 + (i - 2) * 0.5
        Body.setVelocity(shard, { x: Math.cos(a) * 6, y: Math.sin(a) * 6 })
      }
    } else {
      this.holes.push({ x: p.x, y: p.y, left: 100 })
      this.texts.push({ x: p.x, y: p.y - 30, text: '黑洞吞噬！', life: 0, color: '#c9a0ff' })
      playSound('explode')
    }
    this.emitStat()
  }

  private stepItems() {
    // 火苗追踪最近的怪
    for (const b of Composite.allBodies(this.engine.world)) {
      if (b.label === 'shard') {
        const born = (b as unknown as { born: number }).born
        if (this.tick - born > 240) {
          Composite.remove(this.engine.world, b)
          continue
        }
        let nearest: Matter.Body | null = null
        let nd = Infinity
        for (const m of Composite.allBodies(this.engine.world)) {
          if (m.label !== 'mob') continue
          const d = Vector.magnitude(Vector.sub(m.position, b.position))
          if (d < nd) { nd = d; nearest = m }
        }
        if (nearest) {
          const dir = Vector.normalise(Vector.sub(nearest.position, b.position))
          Body.setVelocity(b, { x: dir.x * 9, y: dir.y * 9 })
        }
        this.particles.push({
          x: b.position.x, y: b.position.y, vx: 0, vy: 0,
          life: 0, maxLife: 12, size: 5, color: 'rgba(255,157,46,0.8)', grav: 0,
        })
      } else if (b.label === 'item') {
        const born = (b as unknown as { born: number }).born
        if (this.tick - born > 900) {
          this.burst(b.position.x, b.position.y, 6, '#ffffff', 3)
          Composite.remove(this.engine.world, b)
        }
      }
    }
    // 黑洞吞噬
    for (const h of this.holes) {
      h.left--
      for (const m of Composite.allBodies(this.engine.world)) {
        if (m.label !== 'mob') continue
        const d = Vector.magnitude(Vector.sub(m.position, h))
        if (d < 240) {
          const dir = Vector.normalise({ x: h.x - m.position.x, y: h.y - m.position.y })
          if (m.isStatic) Body.setPosition(m, { x: m.position.x + dir.x * 4.5, y: m.position.y + dir.y * 4.5 })
          else Body.setVelocity(m, { x: dir.x * 5, y: dir.y * 5 })
          if (d < 55) this.killMob(m)
        }
      }
      if (Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2
        this.particles.push({
          x: h.x + Math.cos(a) * 70, y: h.y + Math.sin(a) * 70,
          vx: -Math.cos(a) * 2.5, vy: -Math.sin(a) * 2.5,
          life: 0, maxLife: 22, size: 4, color: '#8a5fd6', grav: 0,
        })
      }
    }
    this.holes = this.holes.filter((h) => h.left > 0)
  }

  // ---------- collisions ----------

  private onCollision = (ev: Matter.IEventCollision<Matter.Engine>) => {
    for (const pair of ev.pairs) {
      const { bodyA, bodyB } = pair
      const rel = Vector.magnitude(Vector.sub(bodyA.velocity, bodyB.velocity))
      const labels = [bodyA.label, bodyB.label]
      // 道具被奶蛙/火苗击中
      if (labels.includes('item') && (labels.includes('baby') || labels.includes('shard'))) {
        const item = bodyA.label === 'item' ? bodyA : bodyB
        this.triggerItem(item)
        continue
      }
      // 怪物被奶蛙撞击 / 火苗命中
      if (labels.includes('mob')) {
        const mob = bodyA.label === 'mob' ? bodyA : bodyB
        const other = mob === bodyA ? bodyB : bodyA
        if (other.label === 'shard') {
          Composite.remove(this.engine.world, other)
          this.killMob(mob)
        } else if (other.label === 'baby' && rel > 3.5 && Vector.magnitude(other.velocity) > 2) {
          // 只有飞行中的奶蛙（有速度）才能击杀；弹弓上待发射的不算
          this.killMob(mob)
          playSound('hit')
        }
      }
    }
  }

  private explode(p: { x: number; y: number }) {
    const R = 235
    playSound('explode')
    this.shake = 18
    for (const body of Composite.allBodies(this.engine.world)) {
      if (body.label === 'baby') continue
      const d = Vector.magnitude(Vector.sub(body.position, p))
      if (d > R) continue
      if (body.label === 'mob') { this.killMob(body); continue }
      if (body.label === 'item') { this.triggerItem(body); continue }
      if (body.isStatic) continue
      const f = 1 - d / R
      const dir = Vector.normalise(Vector.sub(body.position, p))
      Body.setVelocity(body, { x: body.velocity.x + dir.x * f * 16, y: body.velocity.y + dir.y * f * 16 - 4 })
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 2 + Math.random() * 7
      this.particles.push({
        x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
        life: 0, maxLife: 30 + Math.random() * 20, size: 6 + Math.random() * 10,
        color: ['#ff9d2e', '#ff5f2e', '#ffd94d', '#555'][Math.floor(Math.random() * 4)], grav: -0.05,
      })
    }
  }

  // ---------- abilities ----------

  private triggerAbility() {
    if (!this.flying || this.abilityUsed || this.gameOver) return
    this.abilityUsed = true
    playSound('ability')
    const b = this.flying
    if (this.flyingType === 'bomb') {
      this.explode(b.position)
      Composite.remove(this.engine.world, b)
      this.flying = null
      this.emitPhase()
    } else if (this.flyingType === 'speed') {
      const v = b.velocity
      const sp = Math.max(Vector.magnitude(v), 1)
      const boost = Math.max(sp * 2.4, 18)
      Body.setVelocity(b, { x: (v.x / sp) * boost, y: (v.y / sp) * boost })
      this.boostTrail = 26
      this.burst(b.position.x, b.position.y, 10, '#7ec8ff', 4)
      this.emitPhase()
    } else if (this.flyingType === 'giant') {
      Body.scale(b, 1.45, 1.45)
      Body.setDensity(b, 0.007)
      ;(b as unknown as { visualScale: number }).visualScale = 1.45
      this.shake = 8
      this.burst(b.position.x, b.position.y, 14, '#c9a0ff', 5)
      this.emitPhase()
    } else {
      this.burst(b.position.x, b.position.y, 6, '#ffd94d', 3)
      this.emitPhase()
    }
  }

  // ---------- input ----------

  private toWorld(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  private onDown = (e: PointerEvent) => {
    if (this.gameOver) return
    const p = this.toWorld(e)
    // 按住弹弓上的奶蛙 → 拖拽瞄准；否则空中有奶蛙 → 放技能
    if (this.baby && Vector.magnitude(Vector.sub(p, this.baby.position)) < 75) {
      this.phase = 'dragging'
      this.emitPhase()
    } else if (this.flying && !this.abilityUsed) {
      this.triggerAbility()
    }
  }

  private onMove = (e: PointerEvent) => {
    if (this.phase !== 'dragging' || !this.baby) return
    const p = this.toWorld(e)
    const d = Vector.sub(p, SLING)
    const len = Vector.magnitude(d)
    const clamped = len > MAX_PULL ? Vector.mult(Vector.normalise(d), MAX_PULL) : d
    Body.setPosition(this.baby, Vector.add(SLING, clamped))
    if (len > 20 && Math.random() < 0.3) playSound('stretch')
  }

  private onUp = () => {
    if (this.phase !== 'dragging' || !this.baby) return
    const pull = Vector.magnitude(Vector.sub(SLING, this.baby.position))
    if (pull < 14) {
      Body.setPosition(this.baby, SLING)
      this.phase = 'aiming'
      this.emitPhase()
      return
    }
    this.launch()
  }

  // ---------- flow ----------

  private lose() {
    this.gameOver = true
    playSound('lose')
    this.onEvent({ type: 'over', kills: this.kills, score: this.score, time: Math.floor(this.tick / 60) })
  }

  private emitStat() {
    this.onEvent({
      type: 'stat', kills: this.kills, score: this.score,
      rage: this.rage, rageOn: this.rageLeft > 0,
      rageLeft: Math.ceil(this.rageLeft / 60),
      slowOn: this.tick < this.slowUntil,
      hp: this.hp,
    })
  }

  private burst(x: number, y: number, n: number, color: string, size: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 1 + Math.random() * 4
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
        life: 0, maxLife: 24 + Math.random() * 18, size: size * (0.6 + Math.random() * 0.8), color, grav: 0.12,
      })
    }
  }

  // ---------- main loop ----------

  private loop = () => {
    if (this.destroyed) return
    this.step()
    this.render()
    this.raf = requestAnimationFrame(this.loop)
  }

  private step() {
    if (this.gameOver) {
      this.updateFx()
      return
    }
    this.tick++
    Engine.update(this.engine, 1000 / 60)

    // 出怪：频率逐渐加快，封顶 10 只/秒
    const interval = Math.max(0.1, 2.4 - (this.tick / 60) * 0.011)
    this.spawnAcc += 1 / 60
    while (this.spawnAcc >= interval) {
      this.spawnAcc -= interval
      this.spawnMob()
    }
    this.moveMobs()

    // 道具：每 5~8 秒掉落
    if (this.tick >= this.nextItemAt) {
      this.spawnItem()
      this.nextItemAt = this.tick + (300 + Math.random() * 180) | 0
    }
    this.stepItems()

    // 空中奶蛙生命周期（弹弓上的新奶蛙不影响它）
    if (this.flying) {
      this.flyingAge++
      const b = this.flying
      if (this.boostTrail > 0) {
        this.boostTrail--
        this.particles.push({
          x: b.position.x, y: b.position.y, vx: -b.velocity.x * 0.15, vy: -b.velocity.y * 0.15,
          life: 0, maxLife: 18, size: 8, color: 'rgba(126,200,255,0.8)', grav: 0,
        })
      }
      const sp = Vector.magnitude(b.velocity)
      const out = b.position.x > W + 200 || b.position.y > H + 150 || b.position.x < -150
      if (out || this.flyingAge > 480) this.retireFlying()
      else if (sp < 0.45 && this.flyingAge > 40) {
        this.flyingStill++
        if (this.flyingStill > 50) this.retireFlying()
      } else this.flyingStill = 0
    }

    // 怒气散射的副弹清理
    for (const ex of this.extras) {
      ex.age++
      const b = ex.body
      const sp = Vector.magnitude(b.velocity)
      if (ex.age > 360 || b.position.x > W + 200 || b.position.y > H + 150 || (sp < 0.4 && ex.age > 50)) {
        Composite.remove(this.engine.world, b)
        ex.age = 99999
      }
    }
    this.extras = this.extras.filter((e) => e.age < 99999)

    if (this.rageLeft > 0) {
      this.rageLeft--
      if (this.rageLeft % 30 === 0) this.emitStat()
    }
    this.updateFx()
  }

  private updateFx() {
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
    if (this.flash > 0) this.flash--
    if (this.shake > 0.3) this.shake *= 0.88
    else this.shake = 0
  }

  // ---------- render ----------

  private render() {
    const { ctx } = this
    ctx.save()
    ctx.clearRect(0, 0, W, H)
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake)

    const bg = this.images.bg
    if (bg && bg.complete && bg.naturalWidth > 0) {
      const scale = Math.max(W / bg.naturalWidth, H / bg.naturalHeight)
      const bw = bg.naturalWidth * scale
      const bh = bg.naturalHeight * scale
      ctx.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh)
    } else {
      ctx.fillStyle = '#a8dcf7'
      ctx.fillRect(0, 0, W, H)
    }
    ctx.fillStyle = 'rgba(90,60,35,0.9)'
    ctx.fillRect(0, GROUND + 6, W, H - GROUND)
    ctx.fillStyle = 'rgba(120,200,90,0.95)'
    ctx.fillRect(0, GROUND, W, 8)

    // 左侧防线
    ctx.strokeStyle = 'rgba(255,80,60,0.55)'
    ctx.lineWidth = 4
    ctx.setLineDash([12, 10])
    ctx.beginPath()
    ctx.moveTo(FAIL_X, 0)
    ctx.lineTo(FAIL_X, GROUND)
    ctx.stroke()
    ctx.setLineDash([])

    this.drawSling()

    for (const body of Composite.allBodies(this.engine.world)) {
      if (body.label === 'mob') this.drawMob(body)
      else if (body.label === 'item') this.drawItem(body)
      else if (body.label === 'shard') this.drawShard(body)
    }
    for (const ex of this.extras) this.drawBaby(ex.body, ex.type)
    if (this.flying) this.drawBaby(this.flying, this.flyingType)
    if (this.baby) this.drawBaby(this.baby, this.babyType)
    if (this.phase === 'dragging' && this.baby) this.drawTrajectory()

    // 黑洞
    for (const h of this.holes) {
      const r = 45 + Math.sin(this.tick * 0.2) * 8
      const g = ctx.createRadialGradient(h.x, h.y, 4, h.x, h.y, r)
      g.addColorStop(0, '#1a0b2e')
      g.addColorStop(0.7, '#4b2a85')
      g.addColorStop(1, 'rgba(75,42,133,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(h.x, h.y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    // 减速滤镜提示
    if (this.tick < this.slowUntil) {
      ctx.fillStyle = 'rgba(126,200,255,0.10)'
      ctx.fillRect(0, 0, W, H)
    }

    // 掉血红闪
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,40,40,${(this.flash / 25) * 0.28})`
      ctx.fillRect(0, 0, W, H)
    }

    // 怒气激活边框
    if (this.rageLeft > 0) {
      ctx.strokeStyle = `rgba(255,95,46,${0.5 + Math.sin(this.tick * 0.15) * 0.3})`
      ctx.lineWidth = 8
      ctx.strokeRect(4, 4, W - 8, H - 8)
    }

    // particles & texts
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
    ctx.restore()
  }

  private drawSling() {
    const { ctx } = this
    ctx.strokeStyle = '#7a4a21'
    ctx.lineCap = 'round'
    ctx.lineWidth = 9
    ctx.beginPath()
    ctx.moveTo(SLING.x - 4, GROUND + 4)
    ctx.lineTo(SLING.x - 14, SLING.y - 16)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(SLING.x - 2, GROUND + 4)
    ctx.lineTo(SLING.x + 14, SLING.y - 12)
    ctx.stroke()
    if (this.baby && (this.phase === 'aiming' || this.phase === 'dragging')) {
      ctx.strokeStyle = '#3d2b1a'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(SLING.x - 14, SLING.y - 16)
      ctx.lineTo(this.baby.position.x, this.baby.position.y)
      ctx.stroke()
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

  private drawMob(body: Matter.Body) {
    const { ctx } = this
    const im = this.images.mob
    const kind = (body as unknown as { mobKind?: MobKind }).mobKind ?? 'walker'
    const size = kind === 'flyer' ? 50 : 58
    ctx.save()
    ctx.translate(body.position.x, body.position.y)
    if (kind !== 'flyer') ctx.rotate(body.angle)
    // 面向左（朝防线走）
    ctx.scale(-1, 1)
    if (im && im.complete && im.naturalWidth > 0) {
      ctx.drawImage(im, -size / 2, -size / 2, size, size * (im.naturalHeight / im.naturalWidth))
    } else {
      ctx.fillStyle = '#3d6b35'
      ctx.beginPath()
      ctx.arc(0, 0, 23, 0, Math.PI * 2)
      ctx.fill()
    }
    // 减速中的怪画个雪花标记
    if (this.tick < this.slowUntil) {
      ctx.scale(-1, 1)
      ctx.font = '16px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText('❄️', 0, -size / 2 - 4)
    }
    ctx.restore()
  }

  private drawItem(body: Matter.Body) {
    const { ctx } = this
    const kind = (body as unknown as { itemKind: ItemKind }).itemKind
    const im = this.images[`item_${kind}`]
    const size = 46 + Math.sin(this.tick * 0.1) * 3
    ctx.save()
    ctx.translate(body.position.x, body.position.y)
    ctx.shadowColor = 'rgba(255,255,255,0.9)'
    ctx.shadowBlur = 14
    if (im && im.complete && im.naturalWidth > 0) ctx.drawImage(im, -size / 2, -size / 2, size, size)
    else {
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(0, 0, 18, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private drawShard(body: Matter.Body) {
    const { ctx } = this
    ctx.save()
    ctx.translate(body.position.x, body.position.y)
    ctx.fillStyle = '#ff9d2e'
    ctx.shadowColor = '#ff5f2e'
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.arc(0, 0, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
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
}
