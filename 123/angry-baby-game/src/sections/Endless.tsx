import { useEffect, useRef, useState } from 'react'
import { EndlessEngine, type EndlessEvent } from '@/game/endless'
import { BABY_INFO } from '@/game/levels'
import type { BabyType } from '@/game/engine'
import { setMuted } from '@/game/audio'
import { Button } from '@/components/ui/button'

const W = 1280
const H = 720

const BOARD_KEY = 'angry-frog-endless-board'

export interface BoardEntry { score: number; kills: number; time: number; date: string }

export function loadBoard(): BoardEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(BOARD_KEY) ?? '[]') as BoardEntry[]
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function saveScore(entry: BoardEntry): { board: BoardEntry[]; rank: number } {
  const board = [...loadBoard(), entry].sort((a, b) => b.score - a.score).slice(0, 5)
  localStorage.setItem(BOARD_KEY, JSON.stringify(board))
  return { board, rank: board.indexOf(entry) }
}

export default function Endless({ onExit }: { onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<EndlessEngine | null>(null)

  const [runId, setRunId] = useState(0)
  const [kills, setKills] = useState(0)
  const [score, setScore] = useState(0)
  const [rage, setRage] = useState(0)
  const [rageOn, setRageOn] = useState(false)
  const [rageLeft, setRageLeft] = useState(0)
  const [slowOn, setSlowOn] = useState(false)
  const [hp, setHp] = useState(3)
  const [phase, setPhase] = useState<'aiming' | 'dragging' | 'flying'>('aiming')
  const [baby, setBaby] = useState<BabyType>('normal')
  const [over, setOver] = useState<{ kills: number; score: number; time: number } | null>(null)
  const [board, setBoard] = useState<BoardEntry[]>([])
  const [rank, setRank] = useState(-1)
  const [muted, setMutedState] = useState(false)

  useEffect(() => {
    if (!canvasRef.current) return
    const onEvent = (e: EndlessEvent) => {
      if (e.type === 'stat') {
        setKills(e.kills)
        setScore(e.score)
        setRage(e.rage)
        setRageOn(e.rageOn)
        setRageLeft(e.rageLeft)
        setSlowOn(e.slowOn)
        setHp(e.hp)
      } else if (e.type === 'phase') {
        setPhase(e.phase)
        setBaby(e.baby)
      } else if (e.type === 'over') {
        const { board, rank } = saveScore({
          score: e.score, kills: e.kills, time: e.time,
          date: new Date().toLocaleDateString('zh-CN'),
        })
        setBoard(board)
        setRank(rank)
        setOver({ kills: e.kills, score: e.score, time: e.time })
      }
    }
    const engine = new EndlessEngine(canvasRef.current, onEvent)
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [runId])

  const restart = () => {
    setOver(null)
    setKills(0)
    setScore(0)
    setRage(0)
    setRageOn(false)
    setHp(3)
    setRunId((r) => r + 1)
  }

  const rageFull = rage >= 50 && !rageOn

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-sky-950 p-3">
      <div className="relative w-full max-w-[1280px] overflow-hidden rounded-2xl shadow-2xl ring-4 ring-red-900/60">
        <canvas ref={canvasRef} width={W} height={H} className="block w-full touch-none select-none" style={{ aspectRatio: `${W}/${H}` }} />

        {/* HUD 顶部 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-black/45 px-3 py-1.5 text-sm font-black text-red-300 backdrop-blur-sm">
              无限模式
            </div>
            <div className="rounded-xl bg-black/45 px-2.5 py-1.5 text-base tracking-wide backdrop-blur-sm">
              {'❤️'.repeat(Math.max(hp, 0))}{'🖤'.repeat(Math.max(3 - hp, 0))}
            </div>
            <div className="flex items-center gap-1.5 rounded-xl bg-black/45 px-2.5 py-1.5 backdrop-blur-sm">
              <img src={BABY_INFO[baby].img} alt={BABY_INFO[baby].name} className={`h-8 w-8 object-contain ${phase !== 'flying' ? 'animate-bounce' : 'opacity-80'}`} />
              <span className="text-sm font-black text-white">×∞</span>
            </div>
            {slowOn && (
              <div className="rounded-xl bg-cyan-500/70 px-3 py-1.5 text-sm font-black text-white backdrop-blur-sm">
                ❄️ 减速中
              </div>
            )}
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <div className="rounded-xl bg-black/45 px-3 py-1.5 text-sm font-black text-yellow-300 backdrop-blur-sm">
              击杀 {kills} · 分数 {score}
            </div>
            <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => { setMutedState((m) => { setMuted(!m); return !m }) }}>
              {muted ? '🔇' : '🔊'}
            </Button>
            <Button size="sm" variant="secondary" className="rounded-xl" onClick={restart}>
              重玩
            </Button>
            <Button size="sm" variant="secondary" className="rounded-xl" onClick={onExit}>
              菜单
            </Button>
          </div>
        </div>

        {/* 怒气条 + 触发键 */}
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-3 px-6">
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-black/50 p-2 backdrop-blur-sm">
            <span className="pl-1 text-lg">🔥</span>
            <div className="h-5 flex-1 overflow-hidden rounded-full bg-stone-700/80">
              <div
                className={`h-full rounded-full transition-all duration-300 ${rageOn ? 'animate-pulse bg-gradient-to-r from-orange-500 via-red-500 to-yellow-400' : rageFull ? 'bg-gradient-to-r from-orange-400 to-red-500' : 'bg-orange-400/80'}`}
                style={{ width: rageOn ? `${(rageLeft / 10) * 100}%` : `${(rage / 50) * 100}%` }}
              />
            </div>
            <span className="pr-1 text-xs font-black text-white">
              {rageOn ? `爆发中 ${rageLeft}s` : `怒气 ${rage}/50`}
            </span>
          </div>
          <Button
            disabled={!rageFull}
            onClick={() => engineRef.current?.activateRage()}
            className={`h-12 rounded-2xl px-5 text-base font-black text-white shadow-lg ${rageFull ? 'animate-bounce bg-red-500 hover:bg-red-400' : 'bg-stone-500/60'}`}
          >
            💢 怒气爆发
          </Button>
        </div>

        {/* 技能提示 */}
        {phase === 'flying' && !over && (
          <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 animate-pulse rounded-full bg-black/50 px-5 py-2 text-sm font-bold text-white backdrop-blur-sm">
            {baby === 'normal' ? '冲鸭——！' : `点击屏幕：${BABY_INFO[baby].skill}`}
          </div>
        )}

        {/* 失败结算 */}
        {over && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex w-80 flex-col items-center gap-4 rounded-3xl bg-white/95 p-6 shadow-2xl">
              <div className="text-3xl font-black text-red-600">防线被突破！</div>
              <img src="/assets/enemy.png" alt="怪物" className="h-24 w-24 object-contain" />
              <div className="space-y-1 text-center">
                <div className="text-lg font-bold text-stone-700">击杀 {over.kills} 只 · 得分 {over.score}</div>
                <div className="text-sm text-stone-500">坚守了 {Math.floor(over.time / 60)} 分 {over.time % 60} 秒</div>
                {rank === 0 && (
                  <div className="animate-pulse text-base font-black text-amber-500">🏆 新纪录！</div>
                )}
              </div>
              {/* 本地排行榜 */}
              <div className="w-full rounded-xl bg-stone-100 p-3">
                <div className="mb-1 text-center text-xs font-black text-stone-500">本地排行榜 TOP 5</div>
                {board.map((b, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between rounded-lg px-2 py-1 text-sm ${i === rank ? 'bg-amber-200/70 font-black text-amber-800' : 'text-stone-600'}`}
                  >
                    <span>{['🥇', '🥈', '🥉', '4.', '5.'][i]}</span>
                    <span>{b.score} 分</span>
                    <span className="text-xs">{b.kills} 杀 · {Math.floor(b.time / 60)}分{b.time % 60}秒</span>
                    <span className="text-xs text-stone-400">{b.date}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button className="rounded-xl bg-red-500 hover:bg-red-400" onClick={restart}>
                  再战
                </Button>
                <Button variant="secondary" className="rounded-xl" onClick={onExit}>
                  菜单
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-sky-300/70">
        怪从右边来袭且越来越快：有的走、有的弹、少数会飞，越过红线扣 1 ❤️（共 3 滴） · 天上掉道具：冰块=减速 · 火球=分裂追踪 · 黑洞=吞噬 · 杀 50 只攒满怒气
      </p>
    </div>
  )
}
