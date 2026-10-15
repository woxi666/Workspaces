import Matter from 'matter-js'
import { LEVELS } from '../src/game/levels'

const G = 640
const { Engine, Bodies, Composite } = Matter

const DENSITY = { wood: 0.0011, ice: 0.0008, stone: 0.0026 }

let fail = 0
LEVELS.forEach((lv, idx) => {
  const engine = Engine.create()
  engine.gravity.y = 0.55
  const ground = Bodies.rectangle(1280 / 2, G + 60, 1280 + 600, 120, { isStatic: true })
  Composite.add(engine.world, ground)
  const tracked = []
  for (const b of lv.blocks) {
    const body = Bodies.rectangle(b.x, b.y, b.w, b.h, {
      density: DENSITY[b.kind], friction: 0.55, restitution: 0.05,
    })
    tracked.push({ body, x: b.x, y: b.y, tag: `block(${b.kind})@${b.x},${b.y}` })
    Composite.add(engine.world, body)
  }
  for (const e of lv.enemies) {
    const body = Bodies.circle(e.x, e.y, 23, { density: 0.0014, friction: 0.5, restitution: 0.25 })
    tracked.push({ body, x: e.x, y: e.y, tag: `enemy@${e.x},${e.y}` })
    Composite.add(engine.world, body)
  }
  for (let i = 0; i < 900; i++) Engine.update(engine, 1000 / 60)
  for (const t of tracked) {
    const dx = Math.abs(t.body.position.x - t.x)
    const dy = Math.abs(t.body.position.y - t.y)
    if (dx > 8 || dy > 8) {
      console.log(`LEVEL ${idx + 1} "${lv.name}" UNSTABLE: ${t.tag} moved dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`)
      fail++
    }
  }
  console.log(`LEVEL ${idx + 1} "${lv.name}" checked (${lv.blocks.length} blocks, ${lv.enemies.length} enemies)`)
})
console.log(fail === 0 ? 'ALL LEVELS STABLE' : `${fail} UNSTABLE BODIES`)
process.exit(fail === 0 ? 0 : 1)
