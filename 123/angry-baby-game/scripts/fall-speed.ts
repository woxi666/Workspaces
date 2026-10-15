import Matter from 'matter-js'
const { Engine, Bodies, Composite, Events, Vector } = Matter
for (const frictionAir of [0.01, 0.006, 0.004]) {
  for (const dropH of [44, 100, 150, 200]) {
    const engine = Engine.create()
    engine.gravity.y = 0.55
    Composite.add(engine.world, Bodies.rectangle(640, 700, 1880, 120, { isStatic: true, label: 'ground' }))
    const enemy = Bodies.circle(900, 617 - dropH, 23, { label: 'enemy', density: 0.0014, friction: 0.5, restitution: 0.25, frictionAir })
    Composite.add(engine.world, enemy)
    let impact = 0
    Events.on(engine, 'collisionStart', (ev) => {
      for (const pair of ev.pairs) {
        if (pair.bodyA === enemy || pair.bodyB === enemy) impact = Vector.magnitude(enemy.velocity)
      }
    })
    for (let i = 0; i < 600 && impact === 0; i++) Engine.update(engine, 1000 / 60)
    console.log(`frictionAir=${frictionAir} 落差=${dropH}px → 落地速度=${impact.toFixed(2)}`)
  }
}
