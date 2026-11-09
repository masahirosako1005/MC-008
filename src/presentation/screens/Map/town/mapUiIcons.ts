/**
 * @file 地図の上の DOM 部品に使う小さなドット絵アイコン（presentation/screens/Map/town 層）
 * フィルタのチップ・お店カードの便利情報・陣地の札に使う 8×8 ドットの絵。文字の表で持ち、canvas に描く（素材ファイル不要）。
 * 看板商品のアイコン（pixelSprites）とは別に、UI の記号だけをここに置く。
 */
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';

const logger = createLogger('presentation/screens/Map/town/mapUiIcons');

/** UI アイコンの種類 */
export type MapUiIcon = 'today' | 'stroller' | 'toilet' | 'kids' | 'rainOk' | 'heart' | 'heartOutline' | 'nursing' | 'parking' | 'flag' | 'pin' | 'walk';

/** 1つの絵（rows は同じ長さの文字列。'.' は透明。palette は文字 → 色） */
interface PixelBitmap {
  readonly rows: readonly string[];
  readonly palette: Readonly<Record<string, string>>;
}

/** 線の色（濃い墨） */
const INK = '#1f2937';

/** 8×8 の絵の表 */
const BITMAPS: Readonly<Record<MapUiIcon, PixelBitmap>> = {
  today: {
    rows: ['...YY...', '...YY...', 'YYYWYYYY', '.YYYYYY.', '..YYYY..', '.YYYYYY.', '.YY..YY.', 'YO....OY'],
    palette: { Y: '#f5b700', W: '#fff7d1', O: '#b45309' },
  },
  stroller: {
    rows: ['..PPPP..', '.PPWPPK.', 'PPPPPPK.', 'PPPPPP.K', 'KKKKKKKK', '.K....K.', 'K.K..K.K', '.K....K.'],
    palette: { P: '#ec4899', W: '#fbcfe8', K: INK },
  },
  toilet: {
    rows: ['.B....R.', '........', 'BBB..RRR', 'BBB..RRR', 'BBB.RRRR', '.B.B.R.R', '.B.B.R.R', '.B.B.R.R'],
    palette: { B: '#0369a1', R: '#e11d48' },
  },
  kids: {
    rows: ['...SS...', '...SS...', '..GGGG..', '.G.GG.G.', '...GG...', '..B..B..', '..B..B..', '.BB..BB.'],
    palette: { S: '#e8a87c', G: '#10b981', B: '#374151' },
  },
  rainOk: {
    rows: ['...UU...', '.UUWUUU.', 'UUUUUUUU', 'U.U..U.U', '...K....', '...K....', '...K.K..', '....K...'],
    palette: { U: '#0ea5e9', W: '#bae6fd', K: INK },
  },
  heart: {
    rows: ['........', '.RR..RR.', 'RWRRRRRR', 'RRRRRRRR', '.RRRRRR.', '..RRRR..', '...RR...', '........'],
    palette: { R: '#ff5a36', W: '#ffd2c4' },
  },
  heartOutline: {
    rows: ['........', '.RR..RR.', 'R..RR..R', 'R......R', '.R....R.', '..R..R..', '...RR...', '........'],
    palette: { R: '#6b7280' },
  },
  nursing: {
    rows: ['...KK...', '..WWWW..', '..WMMW..', '..WMMW..', '..WMMW..', '..WMMW..', '..WWWW..', '........'],
    palette: { K: '#f59e0b', W: '#9ca3af', M: '#ffffff' },
  },
  parking: {
    rows: ['BBBBBBBB', 'BWWWWBBB', 'BWBBBWBB', 'BWBBBWBB', 'BWWWWBBB', 'BWBBBBBB', 'BWBBBBBB', 'BBBBBBBB'],
    palette: { B: '#2563eb', W: '#ffffff' },
  },
  flag: {
    rows: ['KFFFFF..', 'KFFWFFF.', 'KFFFFFF.', 'KFFFFF..', 'K.......', 'K.......', 'K.......', 'KK......'],
    palette: { K: INK, F: '#ff6a3d', W: '#ffd2c4' },
  },
  pin: {
    rows: ['..RRRR..', '.RRRRRR.', 'RRRWWRRR', 'RRRWWRRR', '.RRRRRR.', '..RRRR..', '...RR...', '...RR...'],
    palette: { R: '#ff5a36', W: '#ffffff' },
  },
  walk: {
    rows: ['....SS..', '....SS..', '...BBB..', '..B.BB.B', '....BB..', '...B..B.', '..B....B', '.B......'],
    palette: { S: '#e8a87c', B: '#374151' },
  },
};

/**
 * 端末のピクセル比を返す（1〜3）。
 * @returns ピクセル比
 */
function devicePixelRatioOf(): number {
  const log = logger.fn('devicePixelRatioOf');
  const raw = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  return log.exit(Number.isFinite(raw) && raw > 0 ? Math.min(3, Math.max(1, raw)) : 1);
}

/**
 * ドット絵のアイコンを canvas に描く（にじまないように整数倍で拡大し、余りは中央に寄せる）。
 * @param canvas 描く先（大きさはここで設定する）
 * @param icon アイコンの種類
 * @param cssSize 表示の一辺（CSS px）
 * @sideEffect canvas の大きさを変え、描き直す
 */
export function paintMapUiIcon(canvas: HTMLCanvasElement, icon: MapUiIcon, cssSize: number): void {
  const log = logger.fn('paintMapUiIcon', { icon, cssSize });
  const bitmap = BITMAPS[icon];
  const dpr = devicePixelRatioOf();
  const side = Math.max(1, Math.round(cssSize * dpr));
  canvas.width = side;
  canvas.height = side;
  setStyle(canvas, 'width', `${cssSize}px`);
  setStyle(canvas, 'height', `${cssSize}px`);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.fail(undefined, '2D コンテキストを取得できません');
  ctx.clearRect(0, 0, side, side);
  const cols = bitmap.rows[0]?.length ?? 1;
  const dot = Math.max(1, Math.floor(side / Math.max(cols, bitmap.rows.length)));
  const offsetX = Math.floor((side - dot * cols) / 2);
  const offsetY = Math.floor((side - dot * bitmap.rows.length) / 2);
  bitmap.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = bitmap.palette[row.charAt(x)];
      if (color === undefined) continue;
      ctx.fillStyle = color;
      ctx.fillRect(offsetX + x * dot, offsetY + y * dot, dot, dot);
    }
  });
  log.exit(undefined);
}

/**
 * ドット絵のアイコン要素（canvas。読み上げからは隠す）を作る。
 * @param icon アイコンの種類
 * @param cssSize 表示の一辺（CSS px）
 * @param className 付けるクラス
 * @returns canvas 要素
 */
export function createMapUiIcon(icon: MapUiIcon, cssSize: number, className = 'map-ui-icon'): HTMLCanvasElement {
  const log = logger.fn('createMapUiIcon', { icon, cssSize });
  const canvas = h('canvas', { class: className, attrs: { 'aria-hidden': 'true', 'data-icon': icon } });
  paintMapUiIcon(canvas, icon, cssSize);
  return log.exit(canvas);
}

/**
 * 便利情報の値に合うアイコンを返す（無ければ undefined）。
 * @param amenity 便利情報の値（toilet / stroller / kids / rainOk / nursing / parking）
 * @returns アイコンの種類
 */
export function amenityIconOf(amenity: string): MapUiIcon | undefined {
  const log = logger.fn('amenityIconOf', { amenity });
  const table: Readonly<Record<string, MapUiIcon>> = { toilet: 'toilet', stroller: 'stroller', kids: 'kids', rainOk: 'rainOk', nursing: 'nursing', parking: 'parking' };
  return log.exit(table[amenity]);
}
