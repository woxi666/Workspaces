import type { BabyType, BlockDef, LevelDef } from './engine'

const G = 640 // ground top

// helpers
const col = (x: number, yBase: number, h: number, kind: BlockDef['kind'] = 'wood'): BlockDef => ({
  x, y: yBase - h / 2, w: 20, h, kind,
})
// beam resting ON a surface: beam bottom edge = yTop
const beamOn = (x: number, yTop: number, w: number, kind: BlockDef['kind'] = 'wood'): BlockDef => ({
  x, y: yTop - 9, w, h: 18, kind,
})
const box = (x: number, yBase: number, s: number, kind: BlockDef['kind'] = 'wood'): BlockDef => ({
  x, y: yBase - s / 2, w: s, h: s, kind,
})
// enemy standing on a surface (surface top y)
const foe = (x: number, yTop: number) => ({ x, y: yTop - 23 })

export const LEVELS: LevelDef[] = [
  {
    name: '夺回奶瓶',
    babies: ['normal', 'normal', 'normal'],
    starScores: [1300, 1600],
    blocks: [
      col(880, G, 140), col(1000, G, 140), // tops at 500
      beamOn(940, 500, 180),
    ],
    enemies: [foe(940, G), foe(940, 482)],
  },
  {
    name: '冰屋突袭',
    babies: ['normal', 'speed', 'normal'],
    starScores: [1400, 1800],
    blocks: [
      col(860, G, 120, 'ice'), col(980, G, 120, 'ice'), // tops at 520
      beamOn(920, 520, 170, 'ice'),
      col(1120, G, 100), // top at 540
      box(1120, 540, 44),
    ],
    enemies: [foe(920, G), foe(920, 502), foe(1120, 496)],
  },
  {
    name: '石墙堡垒',
    babies: ['bomb', 'normal', 'speed'],
    starScores: [1500, 1900],
    blocks: [
      col(880, G, 160, 'stone'), col(1010, G, 160, 'stone'), // tops at 480
      beamOn(945, 480, 190, 'stone'),
      box(1140, G, 40), // top at 600
      box(1140, 600, 40, 'ice'), // top at 560
    ],
    enemies: [foe(945, G), foe(945, 462), foe(1140, 560)],
  },
  {
    name: '双塔奇兵',
    babies: ['giant', 'speed', 'bomb', 'normal'],
    starScores: [2000, 2600],
    blocks: [
      col(830, G, 120), col(930, G, 120), // tops at 520
      beamOn(880, 520, 150),
      col(1080, G, 150, 'ice'), col(1180, G, 150, 'ice'), // tops at 490
      beamOn(1130, 490, 150, 'ice'),
    ],
    enemies: [foe(880, G), foe(880, 502), foe(1130, 472), foe(1130, G)],
  },
  {
    name: '奶瓶大本营',
    babies: ['normal', 'bomb', 'speed', 'giant', 'normal'],
    starScores: [2600, 3400],
    blocks: [
      col(840, G, 140, 'stone'), col(950, G, 140, 'stone'), // tops at 500
      beamOn(895, 500, 170, 'stone'), // top at 482
      col(860, 482, 90), col(930, 482, 90), // tops at 392
      beamOn(895, 392, 130), // top at 374
      col(1120, G, 120, 'ice'), col(1210, G, 120, 'ice'), // tops at 520
      beamOn(1165, 520, 140, 'ice'),
    ],
    enemies: [foe(895, G), foe(895, 374), foe(1165, 502), foe(1165, G), foe(1040, G)],
  },
]

export const BABY_INFO: Record<BabyType, { name: string; skill: string; img: string }> = {
  normal: { name: '小黄蛙', skill: '皮糙肉厚，中规中矩', img: '/assets/baby_normal.png' },
  bomb: { name: '爆炸蛙', skill: '飞行中点击屏幕，引爆自己！', img: '/assets/baby_bomb.png' },
  speed: { name: '加速蛙', skill: '飞行中点击屏幕，瞬间冲刺', img: '/assets/baby_speed.png' },
  giant: { name: '巨力蛙', skill: '飞行中点击屏幕，变大变重', img: '/assets/baby_giant.png' },
}
