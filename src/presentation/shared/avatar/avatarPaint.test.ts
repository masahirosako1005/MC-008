/**
 * @file avatarPaint のテスト（すべての部品・ポーズで描けること、save/restore の釣り合い、止まった絵が地図のスプライトの範囲に収まること）
 */
import { describe, expect, it } from 'vitest';
import type {
  AccessoryStyle, AvatarHat, AvatarHeld, AvatarLook, AvatarPose, BodyType, BottomStyle, EyeStyle, HairStyle, PetStyle, ShoeStyle, TopStyle,
} from '@/presentation/shared/avatar/avatarLook';
import { AVATAR_FOCUS, drawAvatar } from '@/presentation/shared/avatar/avatarPaint';

const HAIRS: readonly HairStyle[] = ['short', 'bob', 'long', 'ponytail', 'bun', 'twintail', 'curly', 'spiky', 'sidepart', 'wolf', 'braid', 'afro'];
const EYES: readonly EyeStyle[] = ['smile', 'round', 'calm', 'sharp', 'sleepy', 'wink', 'sparkle', 'star'];
const TOPS: readonly TopStyle[] = ['tee', 'hoodie', 'shirt', 'border', 'knit', 'cardigan', 'sailor', 'happi', 'yukata', 'jacket', 'stadium', 'apron', 'kimono', 'umeKimono', 'edoKimono', 'retroOnepiece', 'haoriSakura', 'tenjinYukata', 'momijiPoncho', 'downcoat'];
const BOTTOMS: readonly BottomStyle[] = ['denim', 'shorts', 'skirt', 'longskirt', 'cargo', 'check', 'hakama', 'overall'];
const SHOES: readonly ShoeStyle[] = ['sneaker', 'loafer', 'boots', 'sandal', 'geta', 'rain', 'highcut'];
const HATS: readonly AvatarHat[] = ['beret', 'straw', 'crown', 'cap', 'knit', 'hachimaki', 'flower', 'catEars', 'bucket', 'silk', 'halo', 'tiara', 'umeKanzashi', 'sugegasa', 'sakuraKanzashi', 'kitsuneMask', 'momijiBeret'];
const ACCESSORIES: readonly AccessoryStyle[] = ['glasses', 'sunglasses', 'scarf', 'headphones', 'ribbon', 'muffler', 'bandaid', 'pochette', 'medal', 'wings', 'heartglasses', 'earmuffs'];
const HELD: readonly AvatarHeld[] = ['camera', 'chochin', 'nobori', 'matsu', 'map', 'guidebook', 'softcream', 'takoyaki', 'balloon', 'umbrella', 'bouquet', 'fishing', 'uchiwa', 'croquette', 'sparkler', 'wand', 'omamori', 'kushikatsu', 'kamifusen', 'filmcamera', 'dango', 'kingyo', 'yakiimo', 'yukidaruma'];
const PETS: readonly PetStyle[] = ['cat', 'shiba', 'rabbit', 'hiyoko', 'tanuki', 'penguin', 'pigeon', 'dragon', 'fox', 'unicorn', 'uso', 'mejiro', 'tsukimiUsagi'];
const POSES: readonly AvatarPose[] = ['stand', 'wave', 'jump', 'peace'];
const BODIES: readonly BodyType[] = ['neutral', 'girl', 'boy'];
const EMOTES: readonly AvatarPose[] = ['love', 'dance', 'laugh', 'surprise', 'tilt', 'sleepy', 'cry', 'angry', 'cheer', 'spin', 'bow'];
/** エモートを確かめる経過秒（周期の途中・端・長い時間） */
const EMOTE_TIMES = [0, 0.11, 0.225, 0.3, 0.45, 0.6, 0.9, 1.2, 1.37, 2.05, 3.1, 7.77];

/** 地図のスプライトの範囲（shared/avatarSprite.ts の AVATAR_BOX と同じ）＋誤差 */
const BOX = { left: -38, right: 30, top: -76, bottom: 6 };
const EPS = 0.5;

/** アフィン変換 [a, b, c, d, e, f] */
type Matrix = [number, number, number, number, number, number];

/** 描いた点の範囲を記録する偽の 2D コンテキスト */
interface FakeCanvas {
  readonly ctx: CanvasRenderingContext2D;
  /** save の入れ子の深さ（描き終わったら 0） */
  depth(): number;
  /** 描いた点（変換後）の範囲 */
  bounds(): { minX: number; maxX: number; minY: number; maxY: number };
  /** fillRect の回数（服のつやだけが使う） */
  fillRects(): number;
}

/**
 * 変換を点に当てる。
 * @param m 変換
 * @param x X
 * @param y Y
 * @returns 変換後の点
 */
function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * 変換を合成する（m の後に n を当てる座標系＝ m × n）。
 * @param m 今の変換
 * @param n 足す変換
 * @returns 合成した変換
 */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** 点を記録する関数 */
type Mark = (x: number, y: number) => void;

/**
 * 楕円（円弧）を標本化して記録する。
 * @param mark 点を記録する関数
 * @param e 中心 X・中心 Y・横半径・縦半径・回転・開始角・終了角
 */
function sampleEllipse(mark: Mark, e: readonly [number, number, number, number, number, number, number]): void {
  const [x, y, rx, ry, rot, a0, a1] = e;
  for (let i = 0; i <= 48; i++) {
    const a = a0 + ((a1 - a0) * i) / 48;
    const ex = Math.cos(a) * rx;
    const ey = Math.sin(a) * ry;
    mark(x + ex * Math.cos(rot) - ey * Math.sin(rot), y + ex * Math.sin(rot) + ey * Math.cos(rot));
  }
}

/**
 * ベジェ曲線（2次・3次）を標本化して記録する（de Casteljau）。
 * @param mark 点を記録する関数
 * @param pts 始点・制御点・終点
 */
function sampleBezier(mark: Mark, pts: readonly (readonly [number, number])[]): void {
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    let level: (readonly [number, number])[] = [...pts];
    while (level.length > 1) level = level.slice(1).map((p, k) => [(level[k]?.[0] ?? 0) * (1 - t) + p[0] * t, (level[k]?.[1] ?? 0) * (1 - t) + p[1] * t] as const);
    const p = level[0];
    if (p !== undefined) mark(p[0], p[1]);
  }
}

/**
 * 偽の 2D コンテキストを作る（パスの点・円弧・楕円・曲線を標本化して範囲を記録する）。
 * @returns 偽のキャンバス
 */
function fakeCanvas(): FakeCanvas {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let cur: [number, number] = [0, 0];
  let rects = 0;
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const mark = (x: number, y: number): void => {
    const [px, py] = apply(m, x, y);
    b.minX = Math.min(b.minX, px); b.maxX = Math.max(b.maxX, px); b.minY = Math.min(b.minY, py); b.maxY = Math.max(b.maxY, py);
  };
  const ellipsePts = (x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void => sampleEllipse(mark, [x, y, rx, ry, rot, a0, a1]);
  const methods: Record<string, (...a: number[]) => unknown> = {
    save: () => { stack.push([...m] as Matrix); },
    restore: () => { m = stack.pop() ?? m; },
    translate: (x, y) => { m = multiply(m, [1, 0, 0, 1, x ?? 0, y ?? 0]); },
    scale: (x, y) => { m = multiply(m, [x ?? 1, 0, 0, y ?? 1, 0, 0]); },
    rotate: (r) => { const c = Math.cos(r ?? 0); const s = Math.sin(r ?? 0); m = multiply(m, [c, s, -s, c, 0, 0]); },
    moveTo: (x, y) => { cur = [x ?? 0, y ?? 0]; mark(cur[0], cur[1]); },
    lineTo: (x, y) => { cur = [x ?? 0, y ?? 0]; mark(cur[0], cur[1]); },
    quadraticCurveTo: (cx, cy, x, y) => { sampleBezier(mark, [cur, [cx ?? 0, cy ?? 0], [x ?? 0, y ?? 0]]); cur = [x ?? 0, y ?? 0]; },
    bezierCurveTo: (c1x, c1y, c2x, c2y, x, y) => { sampleBezier(mark, [cur, [c1x ?? 0, c1y ?? 0], [c2x ?? 0, c2y ?? 0], [x ?? 0, y ?? 0]]); cur = [x ?? 0, y ?? 0]; },
    arc: (x, y, r, a0, a1) => ellipsePts(x ?? 0, y ?? 0, r ?? 0, r ?? 0, 0, a0 ?? 0, a1 ?? 0),
    ellipse: (x, y, rx, ry, rot, a0, a1) => ellipsePts(x ?? 0, y ?? 0, rx ?? 0, ry ?? 0, rot ?? 0, a0 ?? 0, a1 ?? 0),
    roundRect: (x, y, w, h) => { mark(x ?? 0, y ?? 0); mark((x ?? 0) + (w ?? 0), (y ?? 0) + (h ?? 0)); mark((x ?? 0) + (w ?? 0), y ?? 0); mark(x ?? 0, (y ?? 0) + (h ?? 0)); },
    fillRect: (x, y, w, h) => { rects++; mark(x ?? 0, y ?? 0); mark((x ?? 0) + (w ?? 0), (y ?? 0) + (h ?? 0)); mark((x ?? 0) + (w ?? 0), y ?? 0); mark(x ?? 0, (y ?? 0) + (h ?? 0)); },
    createRadialGradient: () => ({ addColorStop: (): void => undefined }),
    createLinearGradient: () => ({ addColorStop: (): void => undefined }),
    measureText: () => ({ width: 0 }),
  };
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (target, key) => (typeof key === 'string' && key in methods ? methods[key] : typeof key === 'string' && key in target ? target[key] : (): void => undefined),
    set: (target, key, value) => { if (typeof key === 'string') target[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, depth: () => stack.length, bounds: () => ({ ...b }), fillRects: () => rects };
}

/**
 * 描いた範囲が地図のスプライトの範囲に収まることを確かめる。
 * @param b 描いた範囲
 * @param label 失敗したときの見出し
 */
function expectInBox(b: { minX: number; maxX: number; minY: number; maxY: number }, label: string): void {
  expect(b.minX, label).toBeGreaterThanOrEqual(BOX.left - EPS);
  expect(b.maxX, label).toBeLessThanOrEqual(BOX.right + EPS);
  expect(b.minY, label).toBeGreaterThanOrEqual(BOX.top - EPS);
  expect(b.maxY, label).toBeLessThanOrEqual(BOX.bottom + EPS);
}

/** 基本の装い */
const BASE: AvatarLook = { outfitColor: '#6a9bcc', held: 'camera', hasCat: false };

/** 1つの枠だけを変えた装いの一覧（全部の種類） */
const VARIANTS: readonly AvatarLook[] = [
  BASE,
  { ...BASE, hasCat: true },
  ...HAIRS.map((hair) => ({ ...BASE, hair, hairColor: '#c9a27e' })),
  ...EYES.map((eyes) => ({ ...BASE, eyes })),
  ...TOPS.map((top) => ({ ...BASE, top, outfitColor: '#ff7a5c' })),
  ...BOTTOMS.map((bottom) => ({ ...BASE, bottom })),
  ...SHOES.map((shoes) => ({ ...BASE, shoes })),
  ...HATS.map((hat) => ({ ...BASE, hat })),
  ...ACCESSORIES.map((accessory) => ({ ...BASE, accessory })),
  ...HELD.map((held) => ({ ...BASE, held })),
  ...PETS.map((pet) => ({ ...BASE, pet })),
];

describe('drawAvatar', { timeout: 60000 }, () => {
  it('すべての部品の種類を止まった絵で描け、save/restore が釣り合う', () => {
    for (const look of VARIANTS) {
      const canvas = fakeCanvas();
      expect(() => drawAvatar(canvas.ctx, look, { x: 0, y: 0, scale: 1 })).not.toThrow();
      expect(canvas.depth()).toBe(0);
    }
  });

  it('すべてのポーズを、いろいろな経過秒で描ける', () => {
    for (const pose of POSES) {
      for (const t of [0, 0.37, 1.5, 3.15, 10]) {
        for (const look of VARIANTS) {
          const canvas = fakeCanvas();
          expect(() => drawAvatar(canvas.ctx, look, { x: 100, y: 200, scale: 2.6 }, { pose, t })).not.toThrow();
          expect(canvas.depth()).toBe(0);
        }
      }
    }
  });

  it('止まった絵は、拡大率1で地図のスプライトの範囲（x −38〜30・y −76〜6）に収まる', () => {
    for (const look of VARIANTS) {
      const canvas = fakeCanvas();
      drawAvatar(canvas.ctx, look, { x: 0, y: 0, scale: 1 });
      expectInBox(canvas.bounds(), JSON.stringify(look));
    }
  });

  it('盛った髪と高い帽子・髪かざりの組み合わせでも範囲からはみ出さない（頭は1.04倍）', () => {
    for (const hair of HAIRS) {
      for (const hat of [undefined, ...HATS]) {
        for (const accessory of [undefined, 'headphones', 'ribbon', 'heartglasses', 'wings'] as const) {
          const canvas = fakeCanvas();
          drawAvatar(canvas.ctx, { ...BASE, hair, hat, accessory, held: 'umbrella' }, { x: 0, y: 0, scale: 1 });
          expectInBox(canvas.bounds(), `${hair}+${hat ?? '-'}+${accessory ?? '-'}`);
        }
      }
    }
  });

  it('相棒と持ち物（左右の端）のすべての組み合わせが範囲に収まる', () => {
    for (const pet of PETS) {
      for (const held of HELD) {
        const canvas = fakeCanvas();
        drawAvatar(canvas.ctx, { ...BASE, pet, held, accessory: 'wings', hat: 'straw' }, { x: 0, y: 0, scale: 1 });
        expectInBox(canvas.bounds(), `${pet}+${held}`);
      }
    }
  });

  it('縮小時（拡大率0.6未満）もすべての部品を描け、服のつやは省く', () => {
    for (const look of VARIANTS) {
      const canvas = fakeCanvas();
      expect(() => drawAvatar(canvas.ctx, look, { x: 0, y: 0, scale: 0.45 })).not.toThrow();
      expect(canvas.depth()).toBe(0);
    }
    const small = fakeCanvas();
    drawAvatar(small.ctx, BASE, { x: 0, y: 0, scale: 0.45 });
    const large = fakeCanvas();
    drawAvatar(large.ctx, BASE, { x: 0, y: 0, scale: 1 });
    expect(small.fillRects()).toBe(0);
    expect(large.fillRects()).toBeGreaterThan(0);
  });

  it('拡大率と位置に合わせて描く（拡大率2なら範囲も2倍）', () => {
    const one = fakeCanvas();
    drawAvatar(one.ctx, BASE, { x: 0, y: 0, scale: 1 });
    const two = fakeCanvas();
    drawAvatar(two.ctx, BASE, { x: 50, y: 80, scale: 2 });
    expect(one.bounds().minY).toBeLessThan(-60);
    const afro = fakeCanvas();
    drawAvatar(afro.ctx, { ...BASE, hair: 'afro' }, { x: 0, y: 0, scale: 1 });
    expect(afro.bounds().minY).toBeCloseTo(-75.9, 0);
    expect(one.bounds().maxY).toBeGreaterThan(0);
    expect(two.bounds().minY).toBeCloseTo(80 + one.bounds().minY * 2, 5);
    expect(two.bounds().maxX).toBeCloseTo(50 + one.bounds().maxX * 2, 5);
  });
});

describe('drawAvatar のエモート', { timeout: 60000 }, () => {
  it('すべてのエモートを、いろいろな経過秒・すべての部品で描け、save/restore が釣り合う', () => {
    for (const pose of EMOTES) {
      for (const t of EMOTE_TIMES) {
        for (const look of VARIANTS) {
          const canvas = fakeCanvas();
          expect(() => drawAvatar(canvas.ctx, look, { x: 0, y: 0, scale: 1 }, { pose, t })).not.toThrow();
          expect(canvas.depth(), `${pose} t=${t}`).toBe(0);
        }
      }
    }
  });

  it('すべてのエモートが、すべての部品の種類で範囲（x −38〜30・y −76〜6）に収まる', () => {
    for (const pose of EMOTES) {
      for (const t of EMOTE_TIMES) {
        for (const look of VARIANTS) {
          const canvas = fakeCanvas();
          drawAvatar(canvas.ctx, look, { x: 0, y: 0, scale: 1 }, { pose, t });
          expectInBox(canvas.bounds(), `${pose} t=${t} ${JSON.stringify(look)}`);
        }
      }
    }
  });

  it('高い帽子・盛った髪・頭より高い持ち物・相棒と組み合わせても、エモートは範囲に収まる', () => {
    const tall: readonly AvatarLook[] = [
      ...HATS.map((hat) => ({ ...BASE, hair: 'afro' as const, hat, pet: 'unicorn' as const, held: 'umbrella' as const })),
      ...HATS.map((hat) => ({ ...BASE, hair: 'bun' as const, hat, accessory: 'headphones' as const, held: 'fishing' as const })),
      ...HATS.map((hat) => ({ ...BASE, hair: 'twintail' as const, hat, accessory: 'wings' as const, held: 'balloon' as const, pet: 'fox' as const })),
      { ...BASE, hair: 'spiky', hat: 'hachimaki', accessory: 'ribbon', held: 'wand', pet: 'dragon' },
    ];
    for (const pose of EMOTES) {
      for (const t of EMOTE_TIMES) {
        for (const look of tall) {
          const canvas = fakeCanvas();
          drawAvatar(canvas.ctx, look, { x: 0, y: 0, scale: 1 }, { pose, t });
          expectInBox(canvas.bounds(), `${pose} t=${t} ${look.hair ?? ''}+${look.hat ?? ''}+${look.held}`);
        }
      }
    }
  });

  it('エモートは動く（同じポーズでも経過秒で絵が変わる）', () => {
    for (const pose of EMOTES) {
      const tops = EMOTE_TIMES.map((t) => {
        const canvas = fakeCanvas();
        drawAvatar(canvas.ctx, { ...BASE, hair: 'long' }, { x: 0, y: 0, scale: 1 }, { pose, t });
        const b = canvas.bounds();
        return `${b.minX.toFixed(2)},${b.maxX.toFixed(2)},${b.minY.toFixed(2)},${b.maxY.toFixed(2)}`;
      });
      expect(new Set(tops).size, pose).toBeGreaterThan(1);
    }
  });

  it('縮小時（拡大率0.45）もすべてのエモートを描ける', () => {
    for (const pose of EMOTES) {
      const canvas = fakeCanvas();
      expect(() => drawAvatar(canvas.ctx, { ...BASE, hat: 'tiara', pet: 'unicorn', held: 'wand' }, { x: 10, y: 10, scale: 0.45 }, { pose, t: 0.5 })).not.toThrow();
      expect(canvas.depth()).toBe(0);
    }
  });
});

describe('drawAvatar の性別', () => {
  /** 体つきが変わりやすい部品（肩幅・袖・首まわり）と、上や横にはみ出しやすい部品 */
  const looks: readonly AvatarLook[] = [
    BASE,
    ...TOPS.map((top) => ({ ...BASE, top })),
    ...ACCESSORIES.map((accessory) => ({ ...BASE, accessory, top: 'downcoat' as const })),
    { ...BASE, hair: 'afro', hat: 'sugegasa', accessory: 'earmuffs', held: 'umbrella', pet: 'tsukimiUsagi', top: 'momijiPoncho', bottom: 'overall' },
    { ...BASE, hair: 'twintail', hat: 'kitsuneMask', accessory: 'wings', held: 'kingyo', pet: 'uso', top: 'retroOnepiece', bottom: 'hakama' },
    { ...BASE, hair: 'bun', hat: 'umeKanzashi', accessory: 'heartglasses', held: 'fishing', pet: 'mejiro', top: 'tenjinYukata', eyes: 'sparkle' },
  ];

  it('すべての性別 × すべてのポーズ・エモートで描け、save/restore が釣り合い、範囲に収まる', () => {
    for (const body of BODIES) {
      for (const pose of [...POSES.filter((p) => p !== 'jump'), ...EMOTES]) {
        for (const t of [0, 0.3, 1.37, 3.1]) {
          for (const look of looks) {
            const canvas = fakeCanvas();
            drawAvatar(canvas.ctx, { ...look, body }, { x: 0, y: 0, scale: 1 }, { pose, t });
            expect(canvas.depth()).toBe(0);
            expectInBox(canvas.bounds(), `${body} ${pose} t=${t} ${look.top ?? ''}+${look.hat ?? ''}+${look.accessory ?? ''}`);
          }
        }
      }
    }
  });

  it('すべての性別で、止まった絵・縮小した絵（地図）がすべての部品で描け、範囲に収まる', () => {
    for (const body of BODIES) {
      for (const look of VARIANTS) {
        for (const scale of [1, 0.45]) {
          const canvas = fakeCanvas();
          drawAvatar(canvas.ctx, { ...look, body }, { x: 0, y: 0, scale });
          expect(canvas.depth()).toBe(0);
          const b = canvas.bounds();
          expectInBox({ minX: b.minX / scale, maxX: b.maxX / scale, minY: b.minY / scale, maxY: b.maxY / scale }, `${body} ×${scale} ${JSON.stringify(look)}`);
        }
      }
    }
  });

  it('女の子は肩幅が狭く、男の子は広い（胴の横幅で見分けられる）', () => {
    const width = (body: BodyType): number => {
      const canvas = fakeCanvas();
      drawAvatar(canvas.ctx, { ...BASE, body, top: 'downcoat', held: 'camera' }, { x: 0, y: 0, scale: 1 });
      const b = canvas.bounds();
      return b.maxX - b.minX;
    };
    expect(width('girl')).toBeLessThan(width('neutral'));
    expect(width('boy')).toBeGreaterThanOrEqual(width('neutral'));
  });
});

describe('AVATAR_FOCUS', () => {
  it('切り抜きの範囲は全体の範囲の中にある', () => {
    const full = AVATAR_FOCUS.full;
    for (const key of ['head', 'body', 'legs'] as const) {
      const r = AVATAR_FOCUS[key];
      expect(r.x).toBeGreaterThanOrEqual(full.x);
      expect(r.y).toBeGreaterThanOrEqual(full.y);
      expect(r.x + r.w).toBeLessThanOrEqual(full.x + full.w);
      expect(r.y + r.h).toBeLessThanOrEqual(full.y + full.h);
    }
  });
});
