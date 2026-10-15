import Matter from 'matter-js'
const { Engine, Bodies, Composite, Events, Vector } = Matter

function scenario(name: string, beamX: number, expectKill: boolean) {
  const engine = Engine.create()
  engine.gravity.y = 0.55
  Composite.add(engine.world, Bodies.rectangle(640, 700, 1880, 120, { isStatic: true, label: 'ground', friction: 0.9 }))
  const enemy = Bodies.circle(900, 617, 23, { label: 'enemy', density: 0.0014, friction: 0.5, restitution: 0.25 })
  const beam = Bodies.rectangle(beamX, 540, 170, 18, { label: 'block', density: 0.0011, friction: 0.55, restitution: 0.05 })
  Composite.add(engine.world, [enemy, beam])

  const pressured = new Set<number>()
  const crushTimers = new Map<number, number>()
  let killed = false
  Events.on(engine, 'collisionStart', (ev) => {
    for (const pair of ev.pairs) {
      for (const b of [pair.bodyA, pair.bodyB]) {
        if (b.label !== 'enemy') continue
        const other = b === pair.bodyA ? pair.bodyB : pair.bodyA
        const rel = Vector.magnitude(Vector.sub(pair.bodyA.velocity, pair.bodyB.velocity))
        if (other.label === 'block' && Vector.magnitude(other.velocity) > 3.0 && rel > 3.5) killed = true
      }
    }
  })
  Events.on(engine, 'collisionActive', (ev) => {
    for (const pair of ev.pairs) {
      const { bodyA, bodyB } = pair
      const en = bodyA.label === 'enemy' ? bodyA : bodyB.label === 'enemy' ? bodyB : null
      const other = en ? (en === bodyA ? bodyB : bodyA) : null
      if (en && other && other.label === 'block' && other.position.y < en.position.y - 4) pressured.add(en.id)
    }
  })
  for (let i = 0; i < 400 && !killed; i++) {
    Engine.update(engine, 1000 / 60)
    for (const id of pressured) {
      const t = (crushTimers.get(id) ?? 0) + 1
      crushTimers.set(id, t)
      if (t > 40) killed = true
    }
    for (const id of [...crushTimers.keys()]) {
      if (!pressured.has(id)) {
        const t = (crushTimers.get(id) ?? 0) - 3
        if (t <= 0) crushTimers.delete(id); else crushTimers.set(id, t)
      }
    }
    pressured.clear()
  }
  const ok = killed === expectKill
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: 预期${expectKill ? '死' : '活'} 实际${killed ? '死' : '活'}`)
  return ok
}

let ok = true
ok &&= scenario('木梁压在怪身上静置', 900, true)   // 梁正中压住
ok &&= scenario('木梁落在怪旁边（无接触）', 1100, false) // 相距 200px，不接触
ok &&= scenario('木梁斜搭在怪边上（半压）', 960, true)  // 部分压住
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
