/**
 * @file 思い出の写真の縮小・再圧縮（presentation/screens/Zukan 層）
 * 端末で選んだ写真をキャンバスに描き直して JPEG の data URL にする。描き直すので EXIF（撮影位置・機種）は残らない（PRV-03）。
 * 保存先（localStorage）が小さいので、上限の文字数に収まるまで大きさと画質を段階的に下げる。写真の中身はログに出さない。
 */
import { createLogger } from '@/Common/logging/logger';
import { fitWithin } from '@/presentation/screens/Zukan/visitLogModel';

const logger = createLogger('presentation/screens/Zukan/memoryPhoto');

/** 試す順の「長辺の大きさ（px）・画質」（上から順に、上限に収まった最初のものを使う） */
const STEPS: readonly { readonly side: number; readonly quality: number }[] = [
  { side: 640, quality: 0.72 },
  { side: 640, quality: 0.55 },
  { side: 480, quality: 0.6 },
  { side: 360, quality: 0.55 },
];

/** 受け付ける元ファイルの大きさの上限（バイト。これより大きいものは読み込まない） */
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

/**
 * 画像ファイルを読み込む（向きは EXIF に合わせる）。
 * @param file 選ばれたファイル
 * @returns 読み込んだ画像。読めなければ undefined
 */
async function decode(file: Blob): Promise<ImageBitmap | undefined> {
  const log = logger.fn('decode', { size: file.size, type: file.type });
  try {
    return log.exit(await createImageBitmap(file, { imageOrientation: 'from-image' }));
  } catch {
    return log.fail(undefined, 'decode');
  }
}

/**
 * 選んだ写真を、保存できる大きさの JPEG の data URL にする。
 * @param file 選ばれたファイル（画像）
 * @param maxChars data URL の文字数の上限
 * @returns data URL。読めない・収まらないときは undefined
 * @sideEffect 一時的な canvas を作る（DOM には入れない）
 */
export async function compressMemoryPhoto(file: Blob, maxChars: number): Promise<string | undefined> {
  const log = logger.fn('compressMemoryPhoto', { size: file.size, type: file.type, maxChars });
  if (!file.type.startsWith('image/') || file.size > MAX_SOURCE_BYTES) return log.fail(undefined, 'file');
  const bitmap = await decode(file);
  if (bitmap === undefined) return log.fail(undefined, 'decode');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    bitmap.close();
    return log.fail(undefined, 'canvas');
  }
  let found: string | undefined;
  for (const step of STEPS) {
    const size = fitWithin(bitmap.width, bitmap.height, step.side);
    canvas.width = size.width;
    canvas.height = size.height;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const url = canvas.toDataURL('image/jpeg', step.quality);
    if (url.startsWith('data:image/jpeg;base64,') && url.length <= maxChars) {
      found = url;
      break;
    }
  }
  bitmap.close();
  return found === undefined ? log.fail(undefined, 'tooLarge') : log.exit(found, `length=${found.length}`);
}
