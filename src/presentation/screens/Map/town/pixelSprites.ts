/**
 * @file 地図のドット絵スプライト（presentation/screens/Map/town 層）
 * おすすめ商品のアイコン（12x12）、名所の建物（32x30 前後）、小さな店（24x24）、公衆トイレ（16x16）、目印のバッジ（9〜11）を
 * 「文字列の行＋パレット」または「ドットを置く手続き」で定義し、初回に 1ドット=1px の canvas へ焼いてキャッシュする。
 * 描くときは drawImage を imageSmoothingEnabled=false で拡大する（どの縮尺でもくっきりしたドット絵になる）。
 * 輪郭は濃いインク（#2b2a3a）の1ドット線で統一する。silhouette は全ドットを #3a3f55 で塗り（未発見でも「形」だけ見せる）、
 * faded は彩度を落とした版（色あせ）を別にキャッシュする。document も OffscreenCanvas も無い環境（vitest の node）では何も描かない。
 */
import { createLogger } from '@/Common/logging/logger';
import { setStyle } from '@/Common/ui/dom';

const logger = createLogger('presentation/screens/Map/town/pixelSprites');

/** おすすめ商品のアイコン */
export type GoodsIcon =
  | 'coffee'
  | 'sandwich'
  | 'dorayaki'
  | 'dango'
  | 'bread'
  | 'takoyaki'
  | 'book'
  | 'sake'
  | 'croquette'
  | 'kimono'
  | 'udon'
  | 'sushi'
  | 'gift'
  | 'veggie'
  | 'tea'
  | 'kushikatsu'
  | 'fish'
  | 'gyoza'
  | 'okonomiyaki'
  | 'pickles'
  | 'kombu'
  | 'teishoku'
  | 'yakitori'
  | 'pot'
  | 'bath'
  | 'pencil'
  | 'tofu'
  | 'hammer'
  | 'bento'
  | 'shirt'
  | 'latte'
  | 'yarn'
  | 'painting'
  | 'candy'
  | 'flower'
  | 'onigiri'
  | 'bicycle'
  | 'cake'
  | 'soba'
  | 'camera'
  | 'unagi'
  | 'gelato'
  | 'vase'
  | 'parfait'
  | 'ramen';

/** 名所の建物 */
export type LandmarkSprite = 'shrine' | 'theater' | 'market' | 'arcadeGate' | 'yokocho' | 'museum' | 'park' | 'alley' | 'sakuraGate' | 'western';

/** 目印のバッジ */
export type BadgeSprite =
  | 'today'
  | 'heart'
  | 'star'
  | 'flagMine'
  | 'flagRival'
  | 'crown'
  | 'check'
  | 'stroller'
  | 'kids'
  | 'umbrella'
  | 'toilet'
  | 'nursing'
  | 'question'
  | 'sparkle'
  | 'coupon';

/** 商品アイコンの一辺（ドット） */
const GOODS_PX = 12;
/** 店のスプライトの大きさ（ドット） */
const SHOP_W = 24;
const SHOP_H = 24;
/** 公衆トイレの一辺（ドット） */
const TOILET_PX = 16;
/** 輪郭のインク */
const INK = '#2b2a3a';
/** シルエットの色（図鑑のシルエットと同じ考え方） */
const SILHOUETTE = '#3a3f55';
/** 色あせのキャッシュの刻み（0.1 単位） */
const FADE_STEPS = 10;

/** 共通パレット（1文字 → 色）。'.' は透明 */
const PALETTE: Readonly<Record<string, string>> = {
  k: INK,
  w: '#ffffff',
  c: '#f6edd9',
  C: '#e3d3b0',
  r: '#e2574c',
  R: '#b23f37',
  o: '#f08c3a',
  O: '#c4682a',
  y: '#f7c948',
  Y: '#d9a521',
  g: '#5fb35a',
  G: '#2f7a43',
  l: '#a8dc72',
  t: '#2fa39a',
  T: '#1f746d',
  b: '#3e6fb5',
  B: '#2b4e85',
  s: '#7fc8f8',
  S: '#c8eafc',
  p: '#8c6bc8',
  P: '#6a4fa0',
  n: '#f7b6cc',
  N: '#e57fa3',
  u: '#9a6b4f',
  U: '#5e3d2b',
  e: '#d9a35f',
  E: '#f2d091',
  a: '#9aa0ad',
  A: '#5f6576',
  i: '#d8dbe2',
  h: '#26372d',
  m: '#f59a76',
  z: '#4aa8e0',
  x: '#fff3c4',
  f: '#bc5b1b',
  F: '#8f4311',
  q: '#7a5ea8',
  Q: '#5b4488',
  v: '#3f9a86',
  V: '#6cc2a8',
  d: '#4b5670',
  D: '#6b7894',
};

// ---------------------------------------------------------------------------
// ドットの下書き（焼く前の色配列）
// ---------------------------------------------------------------------------

/** 焼く前のドット配列（色 '#rrggbb' または undefined=透明） */
class PixelCanvas {
  readonly px: (string | undefined)[];
  /** 定義の不備（行の幅違い・未知の文字）。テストで 0 件を確かめる */
  readonly issues: string[] = [];

  /**
   * 透明なドット配列を作る。
   * @param w 幅（ドット）
   * @param h 高さ（ドット）
   */
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Array<string | undefined>(w * h).fill(undefined);
  }

  /**
   * 1ドット置く（範囲外は無視）。
   * @param x 列
   * @param y 行
   * @param color 色（undefined で透明に戻す）
   */
  set(x: number, y: number, color: string | undefined): void { // audit-ignore: fnlog-missing ドットごとに呼ぶ純粋な描画ヘルパー
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    this.px[yi * this.w + xi] = color;
  }

  /**
   * 1ドットの色を返す。
   * @param x 列
   * @param y 行
   * @returns 色（透明・範囲外は undefined）
   */
  get(x: number, y: number): string | undefined { // audit-ignore: fnlog-missing ドットごとに呼ぶ純粋な読み取りヘルパー
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return undefined;
    return this.px[y * this.w + x];
  }

  /**
   * 長方形を塗る。
   * @param x 左
   * @param y 上
   * @param w 幅
   * @param h 高さ
   * @param color パレット文字または '#rrggbb'
   */
  rect(x: number, y: number, w: number, h: number, color: string): void { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ描画ヘルパー
    const c = colorOf(color);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  /**
   * 横線を引く（x0..x1 を含む）。
   * @param x0 左端
   * @param x1 右端
   * @param y 行
   * @param color パレット文字または '#rrggbb'
   */
  hline(x0: number, x1: number, y: number, color: string): void { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ描画ヘルパー
    this.rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, color);
  }

  /**
   * 縦線を引く（y0..y1 を含む）。
   * @param x 列
   * @param y0 上端
   * @param y1 下端
   * @param color パレット文字または '#rrggbb'
   */
  vline(x: number, y0: number, y1: number, color: string): void { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ描画ヘルパー
    this.rect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, color);
  }

  /**
   * 線分を引く（ブレゼンハム）。
   * @param x0 始点の列
   * @param y0 始点の行
   * @param x1 終点の列
   * @param y1 終点の行
   * @param color パレット文字または '#rrggbb'
   */
  line(x0: number, y0: number, x1: number, y1: number, color: string): void { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ描画ヘルパー
    const c = colorOf(color);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (let guard = 0; guard < 256; guard++) {
      this.set(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * 塗りつぶした円を描く（ドットの中心が半径内なら塗る）。
   * @param cx 中心の列（小数可）
   * @param cy 中心の行（小数可）
   * @param r 半径（ドット）
   * @param color パレット文字または '#rrggbb'
   */
  disc(cx: number, cy: number, r: number, color: string): void { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ描画ヘルパー
    const c = colorOf(color);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) this.set(x, y, c);
      }
    }
  }

  /**
   * 行の文字列を置く（'.' は置かない）。未知の文字・幅違いは issues に記録して透明として扱う。
   * @param x 左
   * @param y 上
   * @param rows 行の文字列
   * @param palette 文字 → 色（既定は共通パレット）
   */
  stamp(x: number, y: number, rows: readonly string[], palette: Readonly<Record<string, string>> = PALETTE): void { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ描画ヘルパー
    const width = rows[0]?.length ?? 0;
    rows.forEach((row, ry) => {
      if (row.length !== width) this.issues.push(`行${ry}の幅が${row.length}（期待${width}）`);
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        if (ch === undefined || ch === '.' || ch === ' ') continue;
        const color = palette[ch];
        if (color === undefined) {
          this.issues.push(`未知の文字 '${ch}'`);
          continue;
        }
        this.set(x + rx, y + ry, color);
      }
    });
  }

  /**
   * 色のついたドットの外側（上下左右で接する透明ドット）にインクの輪郭を足す。インク自身は広げない。
   * @param ink 輪郭の色
   */
  outline(ink = INK): void { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ描画ヘルパー
    const add: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== undefined) continue;
        const near = [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)];
        if (near.some((c) => c !== undefined && c !== ink)) add.push(y * this.w + x);
      }
    }
    for (const i of add) this.px[i] = ink;
  }
}

/**
 * パレット文字または '#rrggbb' を色にする。
 * @param color パレット文字または色
 * @returns '#rrggbb'
 */
function colorOf(color: string): string { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ純粋な変換ヘルパー
  return color.startsWith('#') ? color : (PALETTE[color] ?? INK);
}

/** スプライトの定義（行の文字列、またはドットを置く手続き） */
interface SpriteSource {
  readonly w: number;
  readonly h: number;
  readonly rows?: readonly string[];
  readonly paint?: (p: PixelCanvas) => void;
  /** 塗り終わったあとに輪郭を自動で足すか */
  readonly outline?: boolean;
}

/**
 * 行の文字列からスプライト定義を作る（幅・高さは行から決める）。
 * @param rows 行の文字列
 * @returns 定義
 */
function art(rows: readonly string[]): SpriteSource { // audit-ignore: fnlog-missing モジュール読み込み時に定義を作る純粋なヘルパー
  return { w: rows[0]?.length ?? 0, h: rows.length, rows };
}

// ---------------------------------------------------------------------------
// おすすめ商品のアイコン（12x12）
// ---------------------------------------------------------------------------

/** 自転車（線で描く） */
const BICYCLE: SpriteSource = {
  w: GOODS_PX,
  h: GOODS_PX,
  paint: (p): void => {
    const wheel = ['.kkk.', 'k...k', 'k.a.k', 'k...k', '.kkk.'];
    p.stamp(0, 6, wheel);
    p.stamp(7, 6, wheel);
    p.line(2, 8, 4, 5, 'r');
    p.line(4, 5, 5, 8, 'r');
    p.line(5, 8, 8, 5, 'r');
    p.hline(4, 8, 5, 'r');
    p.line(8, 5, 9, 8, 'r');
    p.hline(3, 5, 4, 'k');
    p.vline(8, 3, 4, 'k');
    p.hline(8, 10, 2, 'k');
    p.set(5, 9, PALETTE.A);
  },
};

/** 商品アイコンの定義 */
const GOODS: Readonly<Record<GoodsIcon, SpriteSource>> = {
  coffee: art([
    '...i...i....',
    '....i...i...',
    '...i...i....',
    '..kkkkkkk...',
    '.kUUUUUUUk..',
    '.kwwwwwwwkk.',
    '.kwwwwwwwk.k',
    '.kwrrrrrwk.k',
    '.kwwwwwwwkk.',
    'kkkwwwwwkkk.',
    'kiiiiiiiiik.',
    '.kkkkkkkkk..',
  ]),
  sandwich: art([
    '............',
    '............',
    '.kkkkkkkkkk.',
    'kEwwwwwwwwEk',
    'kEwwwwwwiwEk',
    'kyyyyyyyyyyk',
    'kyyyYyyyyYyk',
    'kyYyyyyYyyyk',
    'kEwwwwwwwwEk',
    'kEwiwwwwwwEk',
    '.kkkkkkkkkk.',
    '............',
  ]),
  dorayaki: art([
    '............',
    '............',
    '...kkkkkk...',
    '.kkOOOOOOkk.',
    'kOOoooOOOOOk',
    'kOoooOOOOOOk',
    'keOOOOOOOOek',
    'kkUUUUUUUUkk',
    'keOOOOOOOOek',
    '.keOOOOOOek.',
    '..kkkkkkkk..',
    '............',
  ]),
  dango: art([
    '.....kuk....',
    '....knnnk...',
    '...knwnnnk..',
    '...knnnnNk..',
    '....kNNNk...',
    '....kwwwk...',
    '...kwwwwik..',
    '...kwwwiik..',
    '....klllk...',
    '...klgggGk..',
    '...kgggGGk..',
    '....kkukk...',
  ]),
  bread: art([
    '............',
    '.kkkk..kkkk.',
    'keeeekkeeeek',
    'keccceecccek',
    'keccccccccek',
    'keccccccccek',
    'keccccccccek',
    'keccccccccek',
    'keccccccccek',
    'keccccccccek',
    'keeeeeeeeeek',
    '.kkkkkkkkkk.',
  ]),
  takoyaki: art([
    '.........u..',
    '...kkkkku...',
    '..kUUUUUuk..',
    '.kUwUUgUUUk.',
    '.kUUwUUwUUk.',
    '.kgUUwUUgUk.',
    '.koUUUUUUok.',
    '..kooooook..',
    'kkkkkkkkkkkk',
    'kEeEeEeEeEek',
    '.kEEEEEEEEk.',
    '..kkkkkkkk..',
  ]),
  book: art([
    '............',
    '............',
    '..kkkkkkkkk.',
    '..krrrrrrrrk',
    '..kRwwwwwwwk',
    '.kkkkkkkkkk.',
    '.kbbbbbbbbbk',
    '.kBwwwwwwwwk',
    'kkkkkkkkkkk.',
    'kgggggggggk.',
    'kGwwwwwwwwk.',
    'kkkkkkkkkkk.',
  ]),
  sake: art([
    '...kkk......',
    '...kwk......',
    '...kwk......',
    '..kwwwk.....',
    '.kwwwwwk....',
    '.kbbbbbk....',
    '.kwwbwwk....',
    '.kbbbbbk....',
    '.kwwwwwk....',
    '.kwwwwwkkkkk',
    '.kwwwwwkkbbk',
    '..kkkkk.kkk.',
  ]),
  croquette: art([
    '............',
    '............',
    '....kkkk....',
    '..kkeEeEkk..',
    '.keEeeEeeEk.',
    'keEeeEeEeeek',
    'keeEeeeEeEek',
    'kOeeOeeOeeOk',
    '.kOOeOOeOOk.',
    '.lkkOOOOkkl.',
    'lllgkkkkglll',
    '.gggggggggg.',
  ]),
  kimono: art([
    '............',
    'kkkk....kkkk',
    'knnnkkkknnnk',
    'knnnnwwnnnnk',
    'knnnnwnwnnnk',
    'kkknnwnnnkkk',
    '..knnnnwnk..',
    '..kyyyyyyk..',
    '..knnnnnnk..',
    '..knNnnnnk..',
    '..knnnnnNk..',
    '..kkkkkkkk..',
  ]),
  udon: art([
    '...i...i....',
    '....i...i...',
    '...i...i....',
    '.kkkkkkkkkk.',
    'kwgweeeewgwk',
    'kwwweEEewwwk',
    'kwgwweeewwgk',
    'kkkkkkkkkkkk',
    'kRrrrrrrrrRk',
    '.kRrrrrrrRk.',
    '..kRRRRRRk..',
    '...kkkkkk...',
  ]),
  sushi: art([
    '............',
    '............',
    '............',
    '...kkkkkk...',
    '.kkmmmmmmkk.',
    'kmmwmmwmmwmk',
    'kmmmmmmmmmmk',
    'kkkkkkkkkkkk',
    'kwwwwwwwwwwk',
    'kwiwwwiwwwik',
    '.kkkkkkkkkk.',
    '............',
  ]),
  gift: art([
    '............',
    '..kk....kk..',
    '.krrk..krrk.',
    '..kkrkkrkk..',
    'kkkkkrrkkkkk',
    'kTtttrrtttTk',
    'kkkkkrrkkkkk',
    '.ktttrrtttk.',
    '.ktttrrtttk.',
    '.ktttrrtttk.',
    '.kTTTrrTTTk.',
    '.kkkkkkkkkk.',
  ]),
  veggie: art([
    '.......kk.k.',
    '......kglkgk',
    '.......kgglk',
    '.....kkkkgk.',
    '....kooookk.',
    '...koOoooOk.',
    '...kooooook.',
    '..koooOook..',
    '..kooOook...',
    '.koooook....',
    '.kOook......',
    '.kkk........',
  ]),
  tea: art([
    '...i...i....',
    '....i...i...',
    '...i...i....',
    '..kkkkkkkk..',
    '..kllllllk..',
    '..kkkkkkkk..',
    '..kttttttk..',
    '..ktwtttwk..',
    '..kttttttk..',
    '..ktttwttk..',
    '..kTTTTTTk..',
    '...kkkkkk...',
  ]),
  kushikatsu: art([
    '......u.....',
    '....kkukk...',
    '...keEeEek..',
    '...kEeEeEk..',
    '...keEeEek..',
    '...kUeUeUk..',
    '....kkukk...',
    '...keEeEek..',
    '...kEeEeEk..',
    '...kUeUeUk..',
    '....kkukk...',
    '......u.....',
  ]),
  fish: art([
    '............',
    '............',
    '............',
    '...kkkkkk..k',
    '..kbbbbbbkkk',
    '.kbwkbbbbbbk',
    'kbbbbbbbbbbk',
    '.kSSSSSSSkkk',
    '..kSSSSSSk.k',
    '...kkkkkk...',
    '............',
    '............',
  ]),
  gyoza: art([
    '............',
    '............',
    '............',
    '....kkkk....',
    '..kkcickkk..',
    '.kccicicick.',
    'kcccccccccck',
    'kcccccccccck',
    'keeeeeeeeeek',
    '.kOOOOOOOOk.',
    '..kkkkkkkk..',
    '............',
  ]),
  okonomiyaki: art([
    '............',
    '............',
    '...kkkkkk...',
    '.kkUUUUUUkk.',
    'kUUwUUwUUUUk',
    'kUwUUwUUwUUk',
    'kUUgUUUgUmUk',
    'kUwUUwUUwUUk',
    '.kUUUmUUUUk.',
    '.keeeeeeeek.',
    '..kkkkkkkk..',
    '............',
  ]),
  pickles: art([
    '............',
    '..kkkkkkkk..',
    '.kgpgpggpgk.',
    '.kkkkkkkkkk.',
    '.keueeueeuk.',
    '.kAAAAAAAAk.',
    '.keueeueeuk.',
    '.keueeueeuk.',
    '.keueeueeuk.',
    '.kAAAAAAAAk.',
    '.keueeueeuk.',
    '..kkkkkkkk..',
  ]),
  kombu: art([
    '............',
    '............',
    '..kkkkkkk...',
    '.kuuuuuuuk..',
    'kuUuuuuuUuk.',
    'kuuuUuuuuuk.',
    '.kUUUUUUUk..',
    '..kkkkkkk.k.',
    '.......kmnk.',
    '....kk.kmmk.',
    '...kmnkkmnk.',
    '...kkkk.kk..',
  ]),
  teishoku: art([
    '............',
    '....kkkk....',
    '..kkwwwwkk..',
    '.kwwwiwwwwk.',
    '.kwwwwwwiwk.',
    'kkkkkkkkkkkk',
    'kBbbbbbbbbBk',
    'kbbwbbbwbbbk',
    '.kbbbbbbbbk.',
    '..kBBBBBBk..',
    '...kkkkkk...',
    '............',
  ]),
  yakitori: art([
    '......u.....',
    '....kkkkk...',
    '...kOoOoOk..',
    '...kOUOUOk..',
    '....kkkkk...',
    '....kglgk...',
    '....kkkkk...',
    '...kOoOoOk..',
    '...kOUOUOk..',
    '....kkkkk...',
    '......u.....',
    '......u.....',
  ]),
  pot: art([
    '............',
    '............',
    '.....kk.....',
    '....kaak....',
    '..kkkkkkkk..',
    '.kiiiiiiiik.',
    'kkkkkkkkkkkk',
    'kkaiiiiiiakk',
    '.kaiiiiiiak.',
    '.kaaaaaaaak.',
    '..kAAAAAAk..',
    '...kkkkkk...',
  ]),
  bath: art([
    '...r..r..r..',
    '..r..r..r...',
    '..r..r..r...',
    '...r..r..r..',
    '...r..r..r..',
    '..r..r..r...',
    '.kk......kk.',
    'kzzk....kzzk',
    'kzzzkkkkzzzk',
    'kzzzzzzzzzzk',
    '.kzzzzzzzzk.',
    '..kkkkkkkk..',
  ]),
  pencil: art([
    '.........kk.',
    '.kkkkkkk.knk',
    '.kbbbbbk.kik',
    '.kbwwwbk.kyk',
    '.kbbbbbk.kyk',
    '.kbiiibk.kyk',
    '.kbbbbbk.kyk',
    '.kbiiibk.kyk',
    '.kbbbbbk.kEk',
    '.kBBBBBk..k.',
    '.kkkkkkk....',
    '............',
  ]),
  tofu: art([
    '............',
    '............',
    '...kkkkkkk..',
    '..kwwwwwwkk.',
    '.kwwwwwwkik.',
    '.kkkkkkkkiik',
    '.kcccccckiik',
    '.kcccccckiik',
    '.kcccccckik.',
    '.kkkkkkkkk..',
    'kzzzzzzzzzzk',
    '.kkkkkkkkkk.',
  ]),
  hammer: art([
    '............',
    '.kkkkkkkkk..',
    'kaiiiiiiaak.',
    'kaaaaaaaaAk.',
    '.kkkkukkkk..',
    '....kuk.....',
    '....kuk.....',
    '....kuk.....',
    '....kuk.....',
    '....kUk.....',
    '....kUk.....',
    '....kkk.....',
  ]),
  bento: art([
    '............',
    '............',
    'kkkkkkkkkkkk',
    'kwwwwwkOoOOk',
    'kwwrwwkoOoOk',
    'kwwwwwkkkkkk',
    'kwwwwwkgyglk',
    'kwwwwwkglgyk',
    'kkkkkkkkkkkk',
    'kRRRRRRRRRRk',
    'kkkkkkkkkkkk',
    '............',
  ]),
  shirt: art([
    '............',
    '..kkk..kkk..',
    '.kyyykkyyyk.',
    'kyyyyccyyyyk',
    'kyyyyyyyyyyk',
    'kkkyyyyyykkk',
    '..kyyyyyyk..',
    '..kyyrryyk..',
    '..kyyyyyyk..',
    '..kYyyyyYk..',
    '..kkkkkkkk..',
    '............',
  ]),
  latte: art([
    '............',
    '.kkkkkkkkk..',
    '.kEEEEEEEk..',
    '.ktttttttkk.',
    '.kttwtwttk.k',
    '.ktwwwwwtk.k',
    '.kttwwwttkk.',
    '.ktttwtttk..',
    '.ktttttttk..',
    '..kTTTTTk...',
    '...kkkkk....',
    '............',
  ]),
  yarn: art([
    '............',
    '....kkkk...k',
    '..kknnnnkkk.',
    '.knNnnNnnk..',
    '.knnNnnNnk..',
    'knNnnNnnNnk.',
    'knnNnnNnnnk.',
    'kNnnNnnNnNk.',
    '.knNnnNnnk..',
    '.kknnNnnkk..',
    '...kkkkk....',
    '............',
  ]),
  painting: art([
    '............',
    'kkkkkkkkkkkk',
    'kyyyyyyyyyyk',
    'kykkkkkkkkyk',
    'kykSSSSyykyk',
    'kykSSSSyykyk',
    'kykSgSSSSkyk',
    'kykggSgSSkyk',
    'kykgggggGkyk',
    'kykkkkkkkkyk',
    'kYYYYYYYYYYk',
    'kkkkkkkkkkkk',
  ]),
  candy: art([
    '............',
    '............',
    '............',
    'kk..kkkk..kk',
    'knkkrrwrkknk',
    'knnkrwrrknnk',
    'knnkrrrwknnk',
    'knkkrwrrkknk',
    'kk..kkkk..kk',
    '............',
    '............',
    '............',
  ]),
  flower: art([
    '..k..k..k...',
    '.krkkrkkrk..',
    '.krrrrrrrk..',
    '.krrNrrrrk..',
    '..krrrNrk...',
    '...kkkkk....',
    '.kkk.g.kkk..',
    '.klgkgkglk..',
    '..kkkgkkk...',
    '.kkkkkkkkk..',
    '..kooOook...',
    '...kkkkk....',
  ]),
  onigiri: art([
    '.....kk.....',
    '....kwwk....',
    '...kwwwwk...',
    '...kwwiwk...',
    '..kwwwwwwk..',
    '..kwwwwwwk..',
    '.kwwwhhwwwk.',
    '.kwwhhhhwwk.',
    'kwwwhhhhwwwk',
    'kwwwhhhhwwik',
    'kiwwhhhhwiik',
    'kkkkkkkkkkkk',
  ]),
  bicycle: BICYCLE,
  cake: art([
    '......kk....',
    '.....krrk...',
    '.....krRk...',
    '...kkkkkkk..',
    '..kwwwwwwwk.',
    '.kwwwwwwwwwk',
    'kkkkkkkkkkkk',
    'kEEEEEEEEEEk',
    'kwwrwwrwwrwk',
    'kEEEEEEEEEEk',
    'kwwwwwwwwwwk',
    'kkkkkkkkkkkk',
  ]),
  soba: art([
    '............',
    '............',
    '............',
    '...kkkkkk...',
    '.kkaAhhAakk.',
    'kaAaAhhAaAak',
    'kAaAaAaAaAak',
    'kkkkkkkkkkkk',
    'kyYyYyYyYyYk',
    'kYyYyYyYyYyk',
    '.kkkkkkkkkk.',
    '............',
  ]),
  camera: art([
    '............',
    '...kkk......',
    '..kaaak.kk..',
    'kkkkkkkkkkkk',
    'kaaaakkkkaak',
    'kAAAkiiikAAk',
    'kAAkisSikAAk',
    'kAAkissikAAk',
    'kAAAkiikAAAk',
    'kAAAAkkAAAAk',
    'kkkkkkkkkkkk',
    '............',
  ]),
  unagi: art([
    '............',
    '............',
    'kkkkkkkkkkkk',
    'kUuUUuUUuUUk',
    'kuUUuUUuUUuk',
    'kwwwwwwwwwwk',
    'kkkkkkkkkkkk',
    'kRrrrrrrrrRk',
    'khhhhhhhhhhk',
    'khhhhhhhhhhk',
    'kkkkkkkkkkkk',
    '............',
  ]),
  gelato: art([
    '....kkkk....',
    '...knnnnk...',
    '..knwnnnnk..',
    '..knnnnnNk..',
    '..kkllllkk..',
    '.kllwlllllk.',
    '.klllllllGk.',
    '..kkkkkkkk..',
    '..keEeEeEk..',
    '...kEeEek...',
    '....keEk....',
    '.....kk.....',
  ]),
  vase: art([
    '............',
    '....kkkk....',
    '....kwwk....',
    '...kkkkkk...',
    '..kwwbwwwk..',
    '.kwbbwbbwwk.',
    '.kwwbbbwwwk.',
    '.kwbwwwbbwk.',
    '.kwwwbwwwwk.',
    '..kwwwwwwk..',
    '...kwwwwk...',
    '...kkkkkk...',
  ]),
  parfait: art([
    '.....kk.....',
    '....krrk....',
    '...kkwwkk...',
    '..kwwwwwwk..',
    '..kkkkkkkk..',
    '..kSnnnnSk..',
    '..kSEEEESk..',
    '...kUUUUk...',
    '....kssk....',
    '.....kk.....',
    '....kssk....',
    '...kkkkkk...',
  ]),
  ramen: art([
    '...i...i....',
    '....i...i...',
    '...i...i....',
    '.kkkkkkkkkk.',
    'kyhhyywnwyek',
    'kyhhyynwnyek',
    'kyyYyywwwyyk',
    'kkkkkkkkkkkk',
    'kRwRwRwRwRwk',
    '.kRrrrrrrRk.',
    '..kRRRRRRk..',
    '...kkkkkk...',
  ]),
};

/** すべての商品アイコン（凡例・テスト用） */
export const ALL_GOODS_ICONS: readonly GoodsIcon[] = Object.keys(GOODS) as GoodsIcon[];

// ---------------------------------------------------------------------------
// 名所の建物（輪郭は自動）
// ---------------------------------------------------------------------------

/**
 * 台形を塗る（上辺 top の行から下へ、左右に grow ずつ広げる）。
 * @param p ドット配列
 * @param y0 上の行
 * @param x0 上辺の左端
 * @param x1 上辺の右端
 * @param rows 行数
 * @param color 色
 * @param grow 1行ごとに広げるドット数
 */
function trapezoid(p: PixelCanvas, y0: number, x0: number, x1: number, rows: number, color: string, grow = 1): void { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ描画ヘルパー
  for (let i = 0; i < rows; i++) p.hline(x0 - i * grow, x1 + i * grow, y0 + i, color);
}

/**
 * 丸い木（樹冠と幹）を描く。
 * @param p ドット配列
 * @param cx 樹冠の中心の列
 * @param cy 樹冠の中心の行
 * @param r 樹冠の半径
 * @param tones [影, 本体, ハイライト]
 */
function roundTree(p: PixelCanvas, cx: number, cy: number, r: number, tones: readonly [string, string, string]): void { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ描画ヘルパー
  p.vline(cx, cy + r - 1, cy + r + 4, 'u');
  p.disc(cx, cy, r, tones[0]);
  p.disc(cx - 0.6, cy - 0.6, r - 1, tones[1]);
  p.disc(cx - 1.5, cy - 1.5, Math.max(1, r - 3.2), tones[2]);
}

/** 神社（鳥居＋社殿） */
const SHRINE: SpriteSource = {
  w: 32,
  h: 30,
  outline: true,
  paint: (p): void => {
    trapezoid(p, 4, 10, 21, 6, 'v');
    p.hline(10, 21, 4, 'V');
    p.hline(4, 27, 10, 'U');
    p.line(8, 1, 11, 4, 'U');
    p.line(23, 1, 20, 4, 'U');
    p.rect(7, 11, 18, 9, 'c');
    for (const x of [7, 12, 19, 24]) p.vline(x, 11, 19, 'u');
    p.rect(13, 13, 6, 7, 'U');
    p.hline(13, 18, 12, 'y');
    p.rect(11, 20, 10, 2, 'i');
    p.hline(10, 21, 21, 'a');
    // 鳥居
    p.hline(2, 29, 11, 'k');
    p.set(1, 10, INK);
    p.set(30, 10, INK);
    p.hline(3, 28, 12, 'r');
    p.hline(4, 27, 16, 'r');
    p.rect(5, 13, 2, 15, 'r');
    p.rect(25, 13, 2, 15, 'r');
    p.vline(6, 13, 27, 'R');
    p.vline(26, 13, 27, 'R');
    p.rect(15, 13, 2, 3, 'U');
    p.set(15, 14, PALETTE.y);
    p.rect(4, 28, 4, 1, 'A');
    p.rect(24, 28, 4, 1, 'A');
  },
};

/** 寄席（のぼり付きの和風劇場） */
const THEATER: SpriteSource = {
  w: 32,
  h: 28,
  outline: true,
  paint: (p): void => {
    trapezoid(p, 3, 8, 23, 6, 'd');
    p.hline(8, 23, 3, 'D');
    p.hline(3, 28, 8, 'D');
    p.set(7, 2, INK);
    p.set(24, 2, INK);
    p.rect(9, 9, 14, 3, 'u');
    for (let x = 11; x <= 20; x += 3) p.set(x, 10, PALETTE.x);
    p.rect(5, 12, 22, 13, 'c');
    p.rect(6, 13, 4, 6, 'U');
    p.rect(22, 13, 4, 6, 'U');
    for (const x of [7, 9, 23, 25]) p.vline(x, 13, 18, 'u');
    p.rect(12, 15, 8, 10, 'U');
    p.rect(12, 15, 8, 4, 'r');
    p.vline(15, 15, 18, 'R');
    p.vline(16, 15, 18, 'R');
    p.set(13, 16, PALETTE.w);
    p.set(18, 16, PALETTE.w);
    p.rect(10, 13, 2, 3, 'r');
    p.rect(20, 13, 2, 3, 'r');
    p.hline(10, 11, 14, 'y');
    p.hline(20, 21, 14, 'y');
    p.rect(4, 25, 24, 2, 'i');
    // のぼり
    p.vline(1, 4, 26, 'A');
    p.vline(30, 4, 26, 'A');
    p.rect(2, 5, 2, 10, 'r');
    p.vline(2, 7, 12, 'w');
    p.rect(28, 5, 2, 10, 'b');
    p.vline(29, 7, 12, 'w');
  },
};

/** 市場（大屋根＋のれん＋野菜の箱） */
const MARKET: SpriteSource = {
  w: 32,
  h: 28,
  outline: true,
  paint: (p): void => {
    for (let i = 0; i < 9; i++) {
      p.hline(15 - i * 2, 16 + i * 2, 2 + i, i % 2 === 0 ? 'r' : 'R');
    }
    p.hline(0, 31, 11, 'U');
    p.rect(2, 12, 28, 13, 'c');
    p.rect(9, 12, 14, 2, 'y');
    for (let x = 11; x <= 20; x += 3) p.set(x, 12, PALETTE.U);
    p.rect(5, 15, 22, 10, 'U');
    p.rect(5, 15, 22, 3, 'b');
    for (let x = 9; x < 27; x += 5) p.vline(x, 15, 17, 'B');
    p.set(7, 16, PALETTE.w);
    p.set(16, 16, PALETTE.w);
    p.set(24, 16, PALETTE.w);
    const crates: readonly [number, string, string][] = [[6, 'r', 'o'], [12, 'g', 'l'], [18, 'y', 'o'], [23, 'o', 'r']];
    for (const [x, a, b] of crates) {
      p.rect(x, 22, 4, 3, 'u');
      p.hline(x, x + 3, 21, a);
      p.set(x + 1, 20, PALETTE[b]);
      p.set(x + 2, 21, PALETTE[b]);
    }
  },
};

/** 商店街のアーチ門 */
const ARCADE_GATE: SpriteSource = {
  w: 32,
  h: 28,
  outline: true,
  paint: (p): void => {
    p.rect(6, 10, 20, 3, 's');
    p.hline(6, 25, 10, 'S');
    for (let x = 8; x < 26; x += 4) p.vline(x, 10, 12, 'i');
    p.rect(6, 24, 20, 3, 'E');
    for (let x = 6; x < 26; x += 2) p.set(x, 25, PALETTE.e);
    p.rect(3, 7, 3, 20, 'a');
    p.rect(26, 7, 3, 20, 'a');
    p.vline(5, 7, 26, 'A');
    p.vline(28, 7, 26, 'A');
    trapezoid(p, 1, 10, 21, 3, 'r', 2);
    p.rect(2, 4, 28, 5, 'r');
    p.hline(2, 29, 8, 'R');
    p.rect(8, 5, 16, 2, 'x');
    for (let x = 9; x < 24; x += 3) p.set(x, 5, PALETTE.U);
    for (let x = 3; x < 30; x += 2) p.set(x, 3 + ((x >> 1) % 2), PALETTE.y);
    const flags = ['r', 'y', 'b', 'g', 'n'];
    for (let i = 0; i < 9; i++) {
      const x = 7 + i * 2;
      p.set(x, 14, PALETTE[flags[i % flags.length] ?? 'r']);
      p.set(x, 15, PALETTE[flags[i % flags.length] ?? 'r']);
      p.set(x + 1, 14, PALETTE.k);
    }
  },
};

/** 横丁（高架下の赤ちょうちん） */
const YOKOCHO: SpriteSource = {
  w: 32,
  h: 26,
  outline: true,
  paint: (p): void => {
    p.rect(1, 2, 30, 5, 'a');
    p.hline(1, 30, 2, 'i');
    p.rect(1, 7, 30, 2, 'A');
    p.rect(2, 9, 3, 15, 'a');
    p.rect(27, 9, 3, 15, 'a');
    p.rect(5, 9, 22, 15, 'U');
    p.rect(6, 15, 9, 3, 'B');
    p.rect(17, 15, 9, 3, 'r');
    p.set(10, 16, PALETTE.w);
    p.set(21, 16, PALETTE.w);
    p.rect(6, 18, 9, 3, 'y');
    p.rect(17, 18, 9, 3, 'y');
    p.rect(6, 21, 9, 2, 'u');
    p.rect(17, 21, 9, 2, 'u');
    for (const x of [7, 11, 15, 19, 23]) {
      p.set(x, 10, PALETTE.k);
      p.rect(x - 1, 11, 3, 3, 'r');
      p.set(x, 12, PALETTE.y);
      p.hline(x - 1, x + 1, 14, 'k');
    }
    p.rect(1, 24, 30, 1, 'A');
  },
};

/** 博物館（柱のある洋館） */
const MUSEUM: SpriteSource = {
  w: 32,
  h: 28,
  outline: true,
  paint: (p): void => {
    for (let i = 0; i < 6; i++) p.hline(15 - i * 2, 16 + i * 2, 3 + i, i === 0 ? 'b' : 'w');
    p.hline(5, 26, 8, 'b');
    p.set(15, 5, PALETTE.y);
    p.set(16, 5, PALETTE.y);
    p.rect(3, 9, 26, 2, 'i');
    p.rect(4, 11, 24, 12, 'C');
    for (const x of [5, 10, 20, 25]) {
      p.rect(x, 11, 2, 12, 'w');
      p.vline(x + 1, 11, 22, 'i');
    }
    p.rect(14, 15, 4, 8, 'U');
    p.rect(14, 15, 4, 1, 'u');
    p.rect(3, 23, 26, 1, 'i');
    p.rect(2, 24, 28, 1, 'a');
    p.rect(1, 25, 30, 1, 'i');
    p.rect(12, 12, 8, 2, 'b');
  },
};

/** 公園（噴水と木） */
const PARK: SpriteSource = {
  w: 32,
  h: 28,
  outline: true,
  paint: (p): void => {
    for (let y = 18; y < 27; y++) {
      const half = 15 - Math.abs(y - 22) * 1.6;
      p.hline(Math.round(15.5 - half), Math.round(15.5 + half), y, y < 20 ? 'l' : 'g');
    }
    roundTree(p, 5, 10, 5, ['G', 'g', 'l']);
    roundTree(p, 26, 9, 5, ['G', 'g', 'l']);
    p.rect(9, 19, 14, 5, 'i');
    p.rect(10, 20, 12, 3, 'z');
    p.hline(10, 21, 20, 'S');
    p.rect(15, 9, 2, 11, 's');
    p.vline(15, 9, 19, 'S');
    p.line(14, 9, 11, 13, 'S');
    p.line(17, 9, 20, 13, 'S');
    p.set(10, 15, PALETTE.s);
    p.set(21, 15, PALETTE.s);
    p.rect(14, 7, 4, 2, 'S');
    p.rect(24, 24, 5, 1, 'u');
    p.set(24, 25, PALETTE.U);
    p.set(28, 25, PALETTE.U);
  },
};

/** 路地（長屋と植木鉢） */
const ALLEY: SpriteSource = {
  w: 32,
  h: 26,
  outline: true,
  paint: (p): void => {
    for (let i = 0; i < 3; i++) {
      const x = 1 + i * 10;
      trapezoid(p, 4 + (i % 2), x + 2, x + 7, 4, 'd');
      p.hline(x + 2, x + 7, 4 + (i % 2), 'D');
      p.rect(x + 1, 8, 9, 12, i === 1 ? 'C' : 'c');
      p.rect(x + 2, 11, 3, 9, 'u');
      for (let yy = 12; yy < 20; yy += 2) p.hline(x + 2, x + 4, yy, 'U');
      p.rect(x + 6, 11, 3, 4, 's');
      p.set(x + 6, 11, PALETTE.S);
      p.hline(x + 6, x + 8, 15, 'u');
    }
    p.rect(1, 20, 30, 4, 'i');
    for (let x = 2; x < 31; x += 3) p.set(x, 22, PALETTE.a);
    for (const x of [6, 16, 27]) {
      p.rect(x, 18, 2, 2, 'O');
      p.rect(x - 1, 16, 4, 2, 'g');
      p.set(x, 15, PALETTE.l);
    }
    p.rect(14, 9, 2, 2, 'r');
    p.set(14, 8, PALETTE.k);
  },
};

/** 桜の門 */
const SAKURA_GATE: SpriteSource = {
  w: 32,
  h: 28,
  outline: true,
  paint: (p): void => {
    p.rect(6, 15, 2, 10, 'U');
    p.rect(24, 15, 2, 10, 'U');
    p.disc(7, 10, 6, 'N');
    p.disc(6.5, 9.5, 5, 'n');
    p.disc(5.5, 8, 2, 'w');
    p.disc(25, 10, 6, 'N');
    p.disc(24.5, 9.5, 5, 'n');
    p.disc(23.5, 8, 2, 'w');
    trapezoid(p, 8, 12, 19, 3, 'd');
    p.hline(12, 19, 8, 'D');
    p.rect(12, 11, 2, 14, 'u');
    p.rect(18, 11, 2, 14, 'u');
    p.hline(12, 19, 13, 'U');
    p.rect(14, 14, 4, 2, 'x');
    p.rect(3, 25, 26, 2, 'E');
    for (const [x, y] of [[13, 19], [17, 22], [20, 18], [10, 23], [27, 21], [3, 18]] as const) p.set(x, y, PALETTE.n);
  },
};

/** 洋風建築（白い洋館＋ドーム） */
const WESTERN: SpriteSource = {
  w: 32,
  h: 30,
  outline: true,
  paint: (p): void => {
    p.vline(15, 1, 3, 'y');
    p.vline(16, 1, 3, 'y');
    for (let y = 4; y <= 10; y++) {
      const half = Math.sqrt(Math.max(0, 36 - (y - 10) * (y - 10)));
      p.hline(Math.round(15.5 - half), Math.round(15.5 + half), y, y < 7 ? 'V' : 'v');
    }
    p.rect(3, 11, 26, 2, 'B');
    p.rect(4, 13, 24, 13, 'w');
    p.rect(4, 13, 24, 1, 'i');
    for (const x of [6, 10, 20, 24]) {
      p.rect(x, 15, 2, 3, 's');
      p.set(x, 15, PALETTE.S);
      p.rect(x, 20, 2, 3, 's');
    }
    p.rect(13, 14, 6, 12, 'i');
    p.rect(14, 19, 4, 7, 'u');
    p.rect(14, 16, 4, 2, 's');
    p.vline(13, 14, 25, 'w');
    p.vline(18, 14, 25, 'w');
    p.rect(3, 26, 26, 1, 'i');
    p.rect(2, 27, 28, 1, 'a');
  },
};

/** 名所の建物の定義 */
const LANDMARKS: Readonly<Record<LandmarkSprite, SpriteSource>> = {
  shrine: SHRINE,
  theater: THEATER,
  market: MARKET,
  arcadeGate: ARCADE_GATE,
  yokocho: YOKOCHO,
  museum: MUSEUM,
  park: PARK,
  alley: ALLEY,
  sakuraGate: SAKURA_GATE,
  western: WESTERN,
};

/** すべての名所の建物（凡例・テスト用） */
export const ALL_LANDMARK_SPRITES: readonly LandmarkSprite[] = Object.keys(LANDMARKS) as LandmarkSprite[];

// ---------------------------------------------------------------------------
// 店・公衆トイレ
// ---------------------------------------------------------------------------

/**
 * '#rrggbb' を明るさ k 倍にする（0..1 で暗く、1 より大きいと明るく）。
 * @param hex 色
 * @param k 倍率
 * @returns 色
 */
function scaleColor(hex: string, k: number): string { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ純粋な変換ヘルパー
  const [r, g, b] = parseHex(hex);
  return `#${hexByte(r * k)}${hexByte(g * k)}${hexByte(b * k)}`;
}

/**
 * 小さな店（ひさし・看板・窓・入口）の定義を作る。
 * @param awning ひさしの色 '#rrggbb'
 * @param variant 0=看板の平屋根 / 1=瓦屋根 / 2=二階建て
 * @returns 定義
 */
function shopSource(awning: string, variant: number): SpriteSource { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ定義ヘルパー
  return {
    w: SHOP_W,
    h: SHOP_H,
    outline: true,
    paint: (p): void => {
      const shade = scaleColor(awning, 0.72);
      p.rect(2, 7, 20, 15, 'c');
      p.vline(21, 7, 21, 'C');
      if (variant === 1) {
        trapezoid(p, 2, 6, 17, 5, 'd');
        p.hline(6, 17, 2, 'D');
        p.rect(7, 7, 10, 3, 'u');
        for (let x = 8; x <= 15; x += 2) p.set(x, 8, PALETTE.x);
      } else if (variant === 2) {
        p.rect(2, 3, 20, 8, 'c');
        p.hline(2, 21, 3, 'A');
        p.rect(5, 5, 4, 4, 's');
        p.rect(15, 5, 4, 4, 's');
        p.set(5, 5, PALETTE.S);
        p.set(15, 5, PALETTE.S);
        p.hline(5, 8, 9, 'u');
        p.hline(15, 18, 9, 'u');
      } else {
        p.rect(2, 3, 20, 1, 'A');
        p.rect(3, 4, 18, 5, 'u');
        p.rect(4, 5, 16, 3, 'U');
        for (let x = 6; x <= 17; x += 3) p.hline(x, x + 1, 6, 'x');
      }
      for (let x = 1; x <= 22; x++) {
        const stripe = Math.floor((x - 1) / 2) % 2 === 0 ? awning : '#fffaf0';
        p.vline(x, 11, 13, stripe);
        if (x % 2 === 1) p.set(x, 14, shade);
      }
      p.hline(1, 22, 13, shade);
      p.rect(4, 15, 8, 6, 's');
      p.line(5, 19, 8, 16, 'S');
      p.hline(4, 11, 15, 'u');
      p.rect(14, 15, 5, 7, 'u');
      p.rect(15, 16, 3, 2, 's');
      p.set(17, 19, PALETTE.y);
      p.rect(20, 19, 2, 2, 'g');
      p.set(20, 21, PALETTE.O);
      p.set(21, 21, PALETTE.O);
      p.hline(1, 22, 22, 'a');
    },
  };
}

/**
 * 公衆トイレ（授乳室）の小屋の定義を作る。
 * @param nursing 授乳室なら true
 * @returns 定義
 */
function toiletSource(nursing: boolean): SpriteSource { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ定義ヘルパー
  return {
    w: TOILET_PX,
    h: TOILET_PX,
    outline: true,
    paint: (p): void => {
      const roof = nursing ? 'N' : 'b';
      p.rect(1, 2, 14, 3, roof);
      p.hline(1, 14, 2, nursing ? 'n' : 's');
      p.rect(2, 5, 12, 9, 'w');
      p.vline(13, 5, 13, 'i');
      p.rect(3, 5, 10, 5, nursing ? 'n' : 'b');
      if (nursing) {
        p.stamp(6, 5, ['.y.', 'www', 'wsw', 'www'], PALETTE);
        p.set(10, 7, PALETTE.r);
      } else {
        p.stamp(4, 6, ['.w.', 'www', '.w.', 'w.w'], PALETTE);
        p.vline(8, 6, 9, 'S');
        p.stamp(9, 6, ['.w.', 'www', 'www', 'w.w'], PALETTE);
      }
      p.rect(6, 10, 4, 4, 'U');
      p.rect(1, 14, 14, 1, 'a');
    },
  };
}

// ---------------------------------------------------------------------------
// バッジ
// ---------------------------------------------------------------------------

/**
 * 角丸の色地に白いピクトグラムを載せたバッジ（11x11）を作る。
 * @param bg 地の色（パレット文字）
 * @param picto 9x9 のピクトグラム（'w' だけ使う）
 * @returns 定義
 */
function pictoBadge(bg: string, picto: readonly string[]): SpriteSource { // audit-ignore: fnlog-missing モジュール読み込み時に定義を作る純粋なヘルパー
  return {
    w: 11,
    h: 11,
    paint: (p): void => {
      p.rect(1, 0, 9, 11, 'k');
      p.rect(0, 1, 11, 9, 'k');
      p.rect(1, 1, 9, 9, bg);
      p.stamp(1, 1, picto);
    },
  };
}

/** バッジの定義 */
const BADGES: Readonly<Record<BadgeSprite, SpriteSource>> = {
  today: art([
    '.....k.....',
    '..k.kyk.k..',
    '.kykyyykyk.',
    '..kyyRyyk..',
    '.kyyyRyyyk.',
    'kyyyyRyyyyk',
    '.kyyyyyyyk.',
    '..kyyRyyk..',
    '.kykyyykyk.',
    '..k.kyk.k..',
    '.....k.....',
  ]),
  heart: art([
    '.kk...kk.',
    'krrk.krrk',
    'krwrkrrrk',
    'krrrrrrrk',
    'krrrrrrrk',
    '.krrrrrk.',
    '..krrrk..',
    '...krk...',
    '....k....',
  ]),
  star: art([
    '....k....',
    '...kyk...',
    'kkkyyykkk',
    'kyyyxyyyk',
    '.kyyyyyk.',
    '..kyyyk..',
    '.kyykyyk.',
    '.kyk.kyk.',
    '.kk...kk.',
  ]),
  flagMine: art([
    '.kkk.......',
    '.kykkkkkkk.',
    '.kAkffffffk',
    '.kAkfwwfffk',
    '.kAkffffFk.',
    '.kAkFFFFk..',
    '.kAkkkkk...',
    '.kAk.......',
    '.kAk.......',
    'kkAkk......',
    'kAAAk......',
  ]),
  flagRival: art([
    '.kkk.......',
    '.kykkkkkkk.',
    '.kAkqqqqqqk',
    '.kAkqwwqqqk',
    '.kAkqqqqQk.',
    '.kAkQQQQk..',
    '.kAkkkkk...',
    '.kAk.......',
    '.kAk.......',
    'kkAkk......',
    'kAAAk......',
  ]),
  crown: art([
    '...........',
    '...........',
    '.k...k...k.',
    'kyk.kyk.kyk',
    'kyykyyykyyk',
    'kyyyyyyyyyk',
    'kyryybyyryk',
    'kyyyyyyyyyk',
    'kYYYYYYYYYk',
    'kkkkkkkkkkk',
    '...........',
  ]),
  check: art([
    '...kkkkk...',
    '.kkgggggkk.',
    '.kgggggggk.',
    'kgggggggwgk',
    'kggggggwwgk',
    'kgwggggwggk',
    'kgwwggwwggk',
    'kggwwwwgggk',
    '.kggwwgggk.',
    '.kkgggggkk.',
    '...kkkkk...',
  ]),
  stroller: pictoBadge('t', [
    '..www....',
    '.wwww...w',
    'wwwww..w.',
    'wwwwwwww.',
    'wwwwwww..',
    '.wwwww...',
    '.........',
    '.ww..ww..',
    '.ww..ww..',
  ]),
  kids: pictoBadge('o', [
    '.ww......',
    '.ww......',
    'wwww.....',
    'wwww..ww.',
    'wwwwwwww.',
    '.ww..www.',
    '.ww..www.',
    '.ww..w.w.',
    '.ww......',
  ]),
  umbrella: pictoBadge('b', [
    '....w....',
    '..wwwww..',
    '.wwwwwww.',
    'wwwwwwwww',
    '....w....',
    '....w....',
    '....w....',
    '..w.w....',
    '...w.....',
  ]),
  toilet: pictoBadge('b', [
    '.........',
    '.w..w..w.',
    'www.w.www',
    'www.w.www',
    'www.w.www',
    'w.w.w.www',
    'w.w.w..w.',
    '....w....',
    '.........',
  ]),
  nursing: pictoBadge('N', [
    '....w....',
    '...www...',
    '..wwwww..',
    '..w...w..',
    '..wwwww..',
    '..w...w..',
    '..wwwww..',
    '..w...w..',
    '..wwwww..',
  ]),
  question: art([
    '..kkkkkkk..',
    '.kiiiiiiik.',
    'kiiiAAAiiik',
    'kiiAiiiAiik',
    'kiiiiiiAiik',
    'kiiiiiAiiik',
    'kiiiiAiiiik',
    'kiiiiiiiiik',
    'kiiiiAiiiik',
    '.kiiiiiiik.',
    '..kkkkkkk..',
  ]),
  sparkle: art([
    '....y....',
    '....y....',
    '...yxy...',
    '..yxxxy..',
    'yyxxwxxyy',
    '..yxxxy..',
    '...yxy...',
    '....y....',
    '....y....',
  ]),
  coupon: art([
    '...........',
    '...........',
    'kkkkkkkkkkk',
    'kooooooxook',
    'kowwwoooook',
    '.koooooxok.',
    '.koooooook.',
    'kooooooxook',
    'kkkkkkkkkkk',
    '...........',
    '...........',
  ]),
};

/** すべてのバッジ（凡例・テスト用） */
export const ALL_BADGE_SPRITES: readonly BadgeSprite[] = Object.keys(BADGES) as BadgeSprite[];

// ---------------------------------------------------------------------------
// 焼き付けとキャッシュ
// ---------------------------------------------------------------------------

/** 焼いた画像（作れない環境では null） */
type Baked = CanvasImageSource | null;

/** 焼いた画像のキャッシュ（キー → 画像） */
const cache = new Map<string, Baked>();
/** 店の定義のキャッシュ（ひさしの色と形 → 定義。毎フレーム作り直さない） */
const shopSources = new Map<string, SpriteSource>();

/** 色の変え方（シルエット・色あせ） */
interface BakeOptions {
  readonly silhouette?: boolean;
  readonly faded?: number;
}

/**
 * 0..255 の値を2桁の16進にする（範囲外は丸め込む）。
 * @param v 値
 * @returns '00'..'ff'
 */
function hexByte(v: number): string { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ純粋な変換ヘルパー
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
}

/**
 * '#rrggbb' を [r, g, b] にする。
 * @param hex 色
 * @returns 0..255 の3要素
 */
function parseHex(hex: string): [number, number, number] { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ純粋な変換ヘルパー
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

/**
 * 色あせの量を 0.1 刻みにする（キャッシュを増やしすぎない）。
 * @param faded 0..1
 * @returns 0..FADE_STEPS の整数
 */
function fadeStep(faded: number | undefined): number { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶ純粋な算術ヘルパー
  if (faded === undefined || !Number.isFinite(faded)) return 0;
  return Math.round(Math.min(1, Math.max(0, faded)) * FADE_STEPS);
}

/**
 * 定義をドット配列に塗る（輪郭・色の変え方も適用する）。
 * @param src 定義
 * @param opts 色の変え方
 * @returns ドット配列
 */
function rasterize(src: SpriteSource, opts: BakeOptions): PixelCanvas { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ純粋な描画ヘルパー
  const p = new PixelCanvas(src.w, src.h);
  if (src.rows !== undefined) {
    p.stamp(0, 0, src.rows);
    if (src.rows.length !== src.h) p.issues.push(`行数が${src.rows.length}（期待${src.h}）`);
  }
  src.paint?.(p);
  if (src.outline === true) p.outline();
  const step = fadeStep(opts.faded);
  for (let i = 0; i < p.px.length; i++) {
    const c = p.px[i];
    if (c === undefined) continue;
    if (opts.silhouette === true) p.px[i] = SILHOUETTE;
    else if (step > 0) p.px[i] = desaturate(c, step / FADE_STEPS);
  }
  return p;
}

/**
 * 色の彩度を落とし、少し明るくする（色あせ）。
 * @param hex 色
 * @param amount 0..1
 * @returns 色
 */
function desaturate(hex: string, amount: number): string { // audit-ignore: fnlog-missing スプライトを焼くときだけ呼ぶ純粋な変換ヘルパー
  const [r, g, b] = parseHex(hex);
  const gray = (0.299 * r + 0.587 * g + 0.114 * b) * 0.82 + 255 * 0.18;
  const k = amount * 0.85;
  return `#${hexByte(r + (gray - r) * k)}${hexByte(g + (gray - g) * k)}${hexByte(b + (gray - b) * k)}`;
}

/**
 * 1ドット=1px の画像用 canvas を作る（document → OffscreenCanvas の順。どちらも無ければ undefined）。
 * @param w 幅
 * @param h 高さ
 * @returns canvas と 2D コンテキスト
 */
function createBitmap(w: number, h: number): { readonly image: CanvasImageSource; readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | undefined {
  const log = logger.fn('createBitmap', { w, h });
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    return log.exit(ctx === null ? undefined : { image: canvas, ctx });
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    return log.exit(ctx === null ? undefined : { image: canvas, ctx });
  }
  return log.exit(undefined, 'canvas が無い環境');
}

/**
 * 定義を焼いてキャッシュから返す（初回だけ焼く。作れない環境では null をキャッシュする）。
 * @param key キャッシュのキー（定義の識別子）
 * @param src 定義
 * @param opts 色の変え方
 * @returns 画像（作れなければ null）
 */
function bake(key: string, src: SpriteSource, opts: BakeOptions): Baked { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶキャッシュ引き（焼くのは初回だけで、その中でログを出す）
  const fullKey = `${key}|${opts.silhouette === true ? 's' : ''}|${fadeStep(opts.faded)}`;
  const hit = cache.get(fullKey);
  if (hit !== undefined) return hit;
  const baked = bakeNow(src, opts);
  cache.set(fullKey, baked);
  return baked;
}

/**
 * 定義を実際に canvas へ焼く。
 * @param src 定義
 * @param opts 色の変え方
 * @returns 画像（作れなければ null）
 */
function bakeNow(src: SpriteSource, opts: BakeOptions): Baked {
  const log = logger.fn('bakeNow', { w: src.w, h: src.h, silhouette: opts.silhouette === true, faded: fadeStep(opts.faded) });
  const bitmap = createBitmap(src.w, src.h);
  if (bitmap === undefined) return log.exit(null, 'canvas なし');
  const p = rasterize(src, opts);
  const image = bitmap.ctx.createImageData(src.w, src.h);
  for (let i = 0; i < p.px.length; i++) {
    const c = p.px[i];
    if (c === undefined) continue;
    const [r, g, b] = parseHex(c);
    image.data[i * 4] = r;
    image.data[i * 4 + 1] = g;
    image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = 255;
  }
  bitmap.ctx.putImageData(image, 0, 0);
  return log.exit(bitmap.image);
}

/**
 * 焼いた画像を拡大して描く（ドットをぼかさない。左上は整数 CSS px に丸める）。
 * @param ctx 2D コンテキスト
 * @param image 画像（null なら何もしない）
 * @param box 左上と大きさ（CSS px）
 * @param alpha 不透明度（省略時 1）
 * @sideEffect canvas に描画する
 */
function blit(ctx: CanvasRenderingContext2D, image: Baked, box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }, alpha: number | undefined): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (image === null || !(box.w > 0) || !(box.h > 0)) return;
  const smoothing = ctx.imageSmoothingEnabled;
  const prevAlpha = ctx.globalAlpha;
  ctx.imageSmoothingEnabled = false;
  if (alpha !== undefined) ctx.globalAlpha = prevAlpha * Math.min(1, Math.max(0, alpha));
  ctx.drawImage(image, Math.round(box.x), Math.round(box.y), box.w, box.h);
  ctx.globalAlpha = prevAlpha;
  ctx.imageSmoothingEnabled = smoothing;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 商品アイコンの一辺（ドット）を返す。
 * @returns 12
 */
export function goodsSpriteSize(): number { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶ定数の読み取り
  return GOODS_PX;
}

/**
 * 商品アイコンを中心基準で描く。
 * @param ctx 2D コンテキスト
 * @param icon アイコン
 * @param cx 中心 x（CSS px）
 * @param cy 中心 y（CSS px）
 * @param scale 1ドットの大きさ（CSS px）
 * @param opts silhouette=未発見の形だけ、alpha=不透明度
 * @sideEffect canvas に描画する
 */
export function drawGoods(ctx: CanvasRenderingContext2D, icon: GoodsIcon, cx: number, cy: number, scale: number, opts: { silhouette?: boolean; alpha?: number } = {}): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const src = GOODS[icon] ?? GOODS.gift;
  const image = bake(`g:${icon}`, src, { silhouette: opts.silhouette });
  const size = GOODS_PX * scale;
  blit(ctx, image, { x: cx - size / 2, y: cy - size / 2, w: size, h: size }, opts.alpha);
}

/**
 * 名所の建物の大きさ（ドット）を返す。
 * @param sprite 名所の種類
 * @returns 幅と高さ
 */
export function landmarkSpriteSize(sprite: LandmarkSprite): { w: number; h: number } { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶ定数の読み取り
  const src = LANDMARKS[sprite] ?? MUSEUM;
  return { w: src.w, h: src.h };
}

/**
 * 名所の建物を下端中央基準で描く。
 * @param ctx 2D コンテキスト
 * @param sprite 名所の種類
 * @param cx 下端中央の x（CSS px）
 * @param bottomY 下端の y（CSS px）
 * @param scale 1ドットの大きさ（CSS px）
 * @param opts silhouette=形だけ、alpha=不透明度、faded=彩度を落とす量 0..1
 * @sideEffect canvas に描画する
 */
export function drawLandmark(ctx: CanvasRenderingContext2D, sprite: LandmarkSprite, cx: number, bottomY: number, scale: number, opts: { silhouette?: boolean; alpha?: number; faded?: number } = {}): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const src = LANDMARKS[sprite] ?? MUSEUM;
  const image = bake(`l:${sprite}`, src, { silhouette: opts.silhouette, faded: opts.faded });
  const w = src.w * scale;
  const h = src.h * scale;
  blit(ctx, image, { x: cx - w / 2, y: bottomY - h, w, h }, opts.alpha);
}

/**
 * 店のスプライトの大きさ（ドット）を返す。
 * @returns 幅と高さ
 */
export function shopSpriteSize(): { w: number; h: number } { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶ定数の読み取り
  return { w: SHOP_W, h: SHOP_H };
}

/**
 * 公衆トイレ（授乳室）の小屋を下端中央基準で描く。
 * @param ctx 2D コンテキスト
 * @param cx 下端中央の x（CSS px）
 * @param bottomY 下端の y（CSS px）
 * @param scale 1ドットの大きさ（CSS px）
 * @param opts alpha=不透明度、nursing=授乳室
 * @sideEffect canvas に描画する
 */
export function drawToilet(ctx: CanvasRenderingContext2D, cx: number, bottomY: number, scale: number, opts: { alpha?: number; nursing?: boolean } = {}): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const nursing = opts.nursing === true;
  const image = bake(nursing ? 't:nursing' : 't:wc', nursing ? NURSING_SOURCE : TOILET_SOURCE, {});
  const size = TOILET_PX * scale;
  blit(ctx, image, { x: cx - size / 2, y: bottomY - size, w: size, h: size }, opts.alpha);
}

/** 公衆トイレの定義（使い回す） */
const TOILET_SOURCE = toiletSource(false);
/** 授乳室の定義（使い回す） */
const NURSING_SOURCE = toiletSource(true);

/**
 * バッジの一辺（ドット）を返す。
 * @param badge バッジ
 * @returns 一辺（9 または 11）
 */
export function badgeSpriteSize(badge: BadgeSprite): number { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶ定数の読み取り
  return (BADGES[badge] ?? BADGES.star).w;
}

/**
 * バッジを中心基準で描く。
 * @param ctx 2D コンテキスト
 * @param badge バッジ
 * @param cx 中心 x（CSS px）
 * @param cy 中心 y（CSS px）
 * @param scale 1ドットの大きさ（CSS px）
 * @param opts alpha=不透明度
 * @sideEffect canvas に描画する
 */
export function drawBadge(ctx: CanvasRenderingContext2D, badge: BadgeSprite, cx: number, cy: number, scale: number, opts: { alpha?: number } = {}): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const src = BADGES[badge] ?? BADGES.star;
  const image = bake(`b:${badge}`, src, {});
  const w = src.w * scale;
  const h = src.h * scale;
  blit(ctx, image, { x: cx - w / 2, y: cy - h / 2, w, h }, opts.alpha);
}

/**
 * DOM の小さな canvas（カード・チップ用）へ商品アイコンを描く。端末の画素密度に合わせ、整数倍で拡大して中央に置く。
 * @param canvas 描く canvas
 * @param icon アイコン
 * @param cssSize 表示の一辺（CSS px）
 * @param opts silhouette=形だけ
 * @sideEffect canvas の大きさ・style を変えて描画する
 */
export function paintGoodsIcon(canvas: HTMLCanvasElement, icon: GoodsIcon, cssSize: number, opts: { silhouette?: boolean } = {}): void {
  const log = logger.fn('paintGoodsIcon', { icon, cssSize });
  const rawDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  const dpr = Number.isFinite(rawDpr) && rawDpr > 0 ? Math.min(3, rawDpr) : 1;
  const device = Math.max(1, Math.round(cssSize * dpr));
  canvas.width = device;
  canvas.height = device;
  setStyle(canvas, 'width', `${cssSize}px`);
  setStyle(canvas, 'height', `${cssSize}px`);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.exit(undefined, '2D コンテキストなし');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, device, device);
  const scale = Math.max(1, Math.floor(device / GOODS_PX));
  drawGoods(ctx, icon, device / 2, device / 2, scale, { silhouette: opts.silhouette });
  log.exit(undefined);
}

/**
 * 焼いた画像のキャッシュを捨てる（テスト用）。
 * @sideEffect キャッシュを空にする
 */
export function clearSpriteCache(): void {
  const log = logger.fn('clearSpriteCache', { size: cache.size });
  cache.clear();
  shopSources.clear();
  log.exit(undefined);
}

/** spritePixels で引ける種類 */
export type SpriteKind = 'goods' | 'landmark' | 'badge' | 'shop' | 'toilet';

/** spritePixels の色の変え方 */
export interface SpritePixelOptions {
  readonly silhouette?: boolean;
  readonly faded?: number;
}

/** spritePixels の結果 */
export interface SpritePixelsResult {
  readonly w: number;
  readonly h: number;
  readonly pixels: readonly (string | undefined)[];
  readonly issues: readonly string[];
}

/**
 * スプライトのドット配列を返す（canvas を使わない。テスト・プレビュー用）。
 * @param kind 種類
 * @param id 識別子（shop はひさしの色 '#rrggbb' または '#rrggbb:形0..2'、toilet は 'wc' か 'nursing'）
 * @param opts silhouette・faded（描画と同じ色の変え方）
 * @returns 幅・高さ・ドット（色 or undefined）・定義の不備
 */
export function spritePixels(kind: SpriteKind, id: string, opts: SpritePixelOptions = {}): SpritePixelsResult {
  const log = logger.fn('spritePixels', { kind, id });
  const [shopColor = '#f08c3a', shopVariant = '0'] = id.split(':');
  const src =
    kind === 'goods'
      ? GOODS[id as GoodsIcon]
      : kind === 'landmark'
        ? LANDMARKS[id as LandmarkSprite]
        : kind === 'badge'
          ? BADGES[id as BadgeSprite]
          : kind === 'shop'
            ? shopSource(shopColor, Number.parseInt(shopVariant, 10) % 3)
            : toiletSource(id === 'nursing');
  if (src === undefined) return log.fail({ w: 0, h: 0, pixels: [], issues: [`未定義: ${kind}/${id}`] }, '未定義');
  const p = rasterize(src, opts);
  return log.exit({ w: p.w, h: p.h, pixels: p.px, issues: p.issues });
}
