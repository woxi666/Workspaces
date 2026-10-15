import Matter from 'matter-js'
const { Engine, Bodies, Body, Composite, Events, Vector } = Matter

function scenario(name: string, setup: (world: Matter.World, enemy: Matter.Body) => void, expectKill: boolean) {
  const engine = Engine.create()
  engine.gravity.y = 0.55
  Composite.add(engine.world, Bodies.rectangle(640, 700, 1880, 120, { isStatic: true, label: 'ground', friction: 0.9 }))
  const enemy = Bodies.circle(900, 617, 23, { label: 'enemy', density: 0.0014, friction: 0.5, restitution: 0.25 })
  Composite.add(engine.world, enemy)
  setup(engine.world, enemy)
  let killed = false
  Events.on(engine, 'collisionStart', (ev) => {
    for (const pair of ev.pairs) {
      for (const b of [pair.bodyA, pair.bodyB]) {
        if (b.label !== 'enemy') continue
        const other = b === pair.bodyA ? pair.bodyB : pair.bodyA
        const rel = Vector.magnitude(Vector.sub(pair.bodyA.velocity, pair.bodyB.velocity))
        const eSp = Vector.magnitude(b.velocity)
        const oSp = Vector.magnitude(other.velocity)
        const hitByBaby = other.label === 'baby' && rel > 4.5
        const smashedByBlock = other.label === 'block' && oSp > 3.0 && rel > 3.5
        const slammed = other.isStatic && eSp > 5.0
        const flying = eSp > 7 && rel > 6
        if (hitByBaby || smashedByBlock || slammed || flying) killed = true
      }
    }
  })
  for (let i = 0; i < 400; i++) Engine.update(engine, 1000 / 60)
  const ok = killed === expectKill
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: 预期${expectKill ? '死' : '活'} 实际${killed ? '死' : '活'}`)
  return ok
}

let allOk = true
// A: 木梁从 80px 高处砸到敌人头上 → 应该死
allOk &&= scenario('木梁高空砸落', (world) => {
  Composite.add(world, Bodies.rectangle(900, 520, 170, 18, { label: 'block', density: 0.0011, friction: 0.55 }))
}, true)
// B: 积木以低速滑向敌人（轻碰）→ 应该活
allOk &&= scenario('积木低速轻碰', (world) => {
  const blk = Bodies.rectangle(1000, 620, 170, 18, { label: 'block', density: 0.0011, friction: 0.55 })
  Composite.add(world, blk)
  Body.setVelocity(blk, { x: -1.5, y: 0 })
}, false)
// C: 敌人从 150px 高处摔到地面 → 应该死
allOk &&= scenario('敌人高处摔落', (_world, enemy) => {
  Body.setPosition(enemy, { x: 900, y: 490 })
}, true)
console.log(allOk ? 'ALL PASS' : 'SOME FAILED')
