/**
 * @file 決定論的ハッシュと疑似乱数列（Common/ui/canvas 層。純粋関数）
 * 地図の建物配置・木の揺らぎなど「装飾の乱数」を ID 文字列から作る（Math.random 禁止。同じ ID なら毎回同じ絵になる）。
 * 認証・ID 生成には使わない（それは crypto を使う＝SEC-12）。
 */

/** FNV-1a 32bit のオフセット基底 */
const FNV_OFFSET = 0x811c9dc5;
/** FNV-1a 32bit の素数 */
const FNV_PRIME = 0x01000193;

/**
 * 文字列から 32bit の符号なし整数ハッシュを作る（FNV-1a）。
 * @param text ハッシュ元（スポットID・地区ID など）
 * @returns 0〜2^32−1 の整数
 */
export function hashString(text: string): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * シードから [0,1) の疑似乱数列を返す関数を作る（mulberry32）。
 * @param seed 32bit 整数のシード（hashString の結果など）
 * @returns 呼ぶたびに次の値を返す関数
 */
export function createSeededRandom(seed: number): () => number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * ID 文字列から [0,1) の疑似乱数列を作る（hashString＋createSeededRandom）。
 * @param id 地区ID・スポットID など
 * @returns 呼ぶたびに次の値を返す関数
 */
export function seededRandomFor(id: string): () => number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  return createSeededRandom(hashString(id));
}
