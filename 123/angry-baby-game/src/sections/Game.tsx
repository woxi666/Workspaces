import { useCallback, useEffect, useRef, useState } from 'react'
import { GameEngine, W, H, type BabyType, type GameEvent, type Phase } from '@/game/engine'
import { LEVELS, BABY_INFO } from '@/game/levels'
import { setMuted } from '@/game/audio'
import { Button } from '@/components/ui/button'
import Endless, { loadBoard } from './Endless'

const STAR = '★'
const UNLOCK_KEY = 'angry-baby-unlocked'

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GameEngine | null>(null)

  const [screen, setScreen] = useState<'menu' | 'game' | 'endless'>('menu')
  const [levelIdx, setLevelIdx] = useState(0)
  const [score, setScore] = useState(0)
  const [queue, setQueue] = useState<BabyType[]>([])
  const [phase, setPhase] = useState<Phase>('aiming')
  const [flyingBaby, setFlyingBaby] = useState<BabyType>('normal')
  const [result, setResult] = useState<'win' | 'lose' | null>(null)
  const [runId, setRunId] = useState(0)
  const [muted, setMutedState] = useState(false)
  const [unlocked, setUnlocked] = useState(() => {
    const v = Number(localStorage.getItem(UNLOCK_KEY) ?? '1')
    return Number.isFinite(v) && v >= 1 ? Math.min(v, LEVELS.length) : 1
  })
  const [bestEndless] = useState(() => loadBoard()[0]?.score ?? 0)

  const level = LEVELS[levelIdx]

  const startLevel = useCallback((idx: number) => {
    setLevelIdx(idx)
    setScore(0)
    setResult(null)
    setRunId((r) => r + 1) // 强制重建引擎，重玩同关也会完全重置
    setScreen('game')
  }, [])

  useEffect(() => {
    if (screen !== 'game' || !canvasRef.current) return
    const onEvent = (e: GameEvent) => {
      if (e.type === 'score') setScore(e.score)
      else if (e.type === 'queue') setQueue(e.queue)
      else if (e.type === 'phase') {
        setPhase(e.phase)
        if (e.baby) setFlyingBaby(e.baby)
      } else if (e.type === 'win') {
        setScore(e.score)
        setResult('win')
        setUnlocked((u) => {
          const nu = Math.min(Math.max(u, levelIdx + 2), LEVELS.length)
          localStorage.setItem(UNLOCK_KEY, String(nu))
          return nu
        })
      } else if (e.type === 'lose') setResult('lose')
    }
    const engine = new GameEngine(canvasRef.current, level, onEvent)
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [screen, levelIdx, level, runId])

  const toggleMute = () => {
    setMutedState((m) => {
      setMuted(!m)
      return !m
    })
  }

  const stars = result === 'win'
    ? score >= level.starScores[1] ? 3 : score >= level.starScores[0] ? 2 : 1
    : 0

  // ---------- menu ----------
  if (screen === 'menu') {
    return (
      <div
        className="min-h-screen w-full flex flex-col items-center justify-center gap-8 bg-cover bg-center px-4 py-10"
        style={{ backgroundImage: "url('/assets/bg.jpg')" }}
      >
        <div className="text-center">
          <h1
            className="text-6xl md:text-7xl font-black text-yellow-300 tracking-wide"
            style={{ textShadow: '0 4px 0 #b45309, 0 8px 18px rgba(0,0,0,0.45)' }}
          >
            愤怒的奶蛙
          </h1>
          <p className="mt-3 text-lg font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
            奶瓶被捣蛋鬼抢走了——奶蛙们，愤怒出击！
          </p>
        </div>

        <div className="flex items-end gap-4 md:gap-6">
          {(Object.keys(BABY_INFO) as BabyType[]).map((t) => (
            <div key={t} className="flex flex-col items-center gap-1 rounded-2xl bg-white/85 px-4 py-3 shadow-lg backdrop-blur">
              <img src={BABY_INFO[t].img} alt={BABY_INFO[t].name} className="h-20 w-20 object-contain drop-shadow" />
              <div className="text-sm font-black text-amber-900">{BABY_INFO[t].name}</div>
              <div className="max-w-28 text-center text-xs text-amber-800/80">{BABY_INFO[t].skill}</div>
            </div>
          ))}
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-stone-800/85 px-4 py-3 shadow-lg backdrop-blur">
            <img src="/assets/enemy.png" alt="奶瓶大盗" className="h-20 w-20 object-contain drop-shadow" />
            <div className="text-sm font-black text-stone-100">奶瓶大盗</div>
            <div className="max-w-28 text-center text-xs text-stone-300">砸飞它，夺回奶瓶！</div>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          {LEVELS.map((lv, i) => {
            const locked = i + 1 > unlocked
            return (
              <Button
                key={lv.name}
                disabled={locked}
                onClick={() => startLevel(i)}
                className="h-auto flex-col gap-1 rounded-2xl bg-amber-500 px-6 py-3 text-white shadow-lg hover:bg-amber-400 disabled:bg-stone-400/70"
              >
                <span className="text-lg font-black">{locked ? '🔒' : `第 ${i + 1} 关`}</span>
                <span className="text-xs opacity-90">{lv.name}</span>
              </Button>
            )
          })}
        </div>

        {/* 无限模式入口 */}
        <div className="relative">
          <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-pink-500 px-3 py-0.5 text-xs font-black text-white shadow-md">
            woxi 推荐 ✨
          </div>
          <Button
            onClick={() => setScreen('endless')}
            className="h-auto flex-col gap-1 rounded-2xl bg-gradient-to-r from-red-500 to-orange-500 px-10 py-4 text-white shadow-xl ring-2 ring-yellow-300/70 hover:from-red-400 hover:to-orange-400"
          >
            <span className="text-2xl font-black">🔥 无限模式 🔥</span>
            <span className="text-xs opacity-90">
              怪潮来袭 · 天降道具 · 怒气爆发{bestEndless > 0 ? ` · 🏆 最高 ${bestEndless} 分` : ''}
            </span>
          </Button>
        </div>
        <p className="text-sm font-bold text-white/90 drop-shadow">玩法：按住奶蛙往后拉，松手发射；飞行中点击屏幕释放技能！</p>
      </div>
    )
  }

  // ---------- endless ----------
  if (screen === 'endless') {
    return <Endless onExit={() => setScreen('menu')} />
  }

  // ---------- game ----------
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-sky-950 p-3">
      <div className="relative w-full max-w-[1280px] overflow-hidden rounded-2xl shadow-2xl ring-4 ring-amber-900/60">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="block w-full touch-none select-none"
          style={{ aspectRatio: `${W}/${H}` }}
        />

        {/* HUD */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-black/45 px-3 py-1.5 text-sm font-black text-white backdrop-blur-sm">
              第 {levelIdx + 1} 关 · {level.name}
            </div>
            <div className="flex items-center gap-1.5 rounded-xl bg-black/45 px-2.5 py-1.5 backdrop-blur-sm">
              {queue[0] && (
                <img
                  src={BABY_INFO[queue[0]].img}
                  alt={BABY_INFO[queue[0]].name}
                  className={`h-8 w-8 object-contain ${phase === 'aiming' || phase === 'dragging' ? 'animate-bounce' : 'opacity-80'}`}
                />
              )}
              <span className="text-sm font-black text-white">×∞</span>
            </div>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <div className="rounded-xl bg-black/45 px-3 py-1.5 text-sm font-black text-yellow-300 backdrop-blur-sm">
              分数 {score}
            </div>
            <Button size="sm" variant="secondary" className="rounded-xl" onClick={toggleMute}>
              {muted ? '🔇' : '🔊'}
            </Button>
            <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => startLevel(levelIdx)}>
              重玩
            </Button>
            <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => setScreen('menu')}>
              菜单
            </Button>
          </div>
        </div>

        {/* ability hint */}
        {phase === 'flying' && !result && (
          <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 animate-pulse rounded-full bg-black/50 px-5 py-2 text-sm font-bold text-white backdrop-blur-sm">
            {flyingBaby === 'normal' ? '冲鸭——！' : `点击屏幕：${BABY_INFO[flyingBaby].skill}`}
          </div>
        )}

        {/* result overlay */}
        {result && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm">
            <div className="flex w-80 flex-col items-center gap-4 rounded-3xl bg-white/95 p-6 shadow-2xl">
              {result === 'win' ? (
                <>
                  <div className="text-3xl font-black text-amber-600">闯关成功！</div>
                  <div className="text-4xl tracking-widest text-yellow-400" style={{ textShadow: '0 2px 0 #b45309' }}>
                    {STAR.repeat(stars)}
                    <span className="text-stone-300">{STAR.repeat(3 - stars)}</span>
                  </div>
                  <div className="text-lg font-bold text-stone-700">分数：{score}</div>
                </>
              ) : (
                <>
                  <div className="text-3xl font-black text-stone-700">奶瓶没抢回来…</div>
                  <img src="/assets/enemy.png" alt="奶瓶大盗" className="h-24 w-24 object-contain" />
                  <div className="text-sm text-stone-500">捣蛋鬼抱着奶瓶跑掉了，再来一次！</div>
                </>
              )}
              <div className="flex gap-2">
                {result === 'win' && levelIdx + 1 < LEVELS.length && (
                  <Button className="rounded-xl bg-amber-500 hover:bg-amber-400" onClick={() => startLevel(levelIdx + 1)}>
                    下一关
                  </Button>
                )}
                <Button variant="secondary" className="rounded-xl" onClick={() => startLevel(levelIdx)}>
                  重玩
                </Button>
                <Button variant="secondary" className="rounded-xl" onClick={() => setScreen('menu')}>
                  菜单
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-sky-300/70">拖动弹弓上的奶蛙瞄准，松手发射 · 飞行中点击屏幕释放技能</p>
    </div>
  )
}
