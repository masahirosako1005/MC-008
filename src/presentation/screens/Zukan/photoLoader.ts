/**
 * @file 図鑑の写真を読み込む順番（presentation/screens/Zukan 層）
 * 図鑑は 80 枚（約 4MB）の写真を並べる。開いた時点で全部を読むと、回線が遅いときに「いま見えている写真」まで待たされる（UI/UX 改善 3周目）。
 * ここでは、①見えている写真をいちばん先に ②その上下 NEAR_SCREENS 画面ぶんの写真を、見えている写真を読み終えてから
 * ③それより遠い写真は、①②が済んでから並びの順に少しずつ（近づけば先に）、の順にする。
 * 近くの写真は見える前に読み終えるので、速く送っても空の枠は見えにくい（読み込み中の枠は紙色の地＝CSS）。
 * img の src をいったん外して、読み始める時に戻す（ブラウザ任せの遅延読み込みは、範囲も順番も決められないため）。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/screens/Zukan/photoLoader');

/** 写真を先に読み始める範囲（見えている範囲の上下に足す画面の数。速く送っても空の枠が見えにくい幅。仮） */
const NEAR_SCREENS = 1.5;

/**
 * 格子を描いた直後に、位置を測らずにすぐ読み始める先頭の枚数（標準の3列で4行ぶん＝開いたときに見えている範囲。仮）。
 * 見えているかを測ってから読むと、同じ画面の書体の読み込みの後ろに並んで、写真が出るのが遅れるため。
 */
const HEAD_COUNT = 12;

/** 遠い写真を同時に読む枚数（見えている写真・近くの写真を読み終えたあと、少しずつ読んでおく。仮） */
const FAR_PARALLEL = 4;

/** 1枚の写真の読み込みの予定 */
interface PhotoJob {
  readonly img: HTMLImageElement;
  readonly src: string;
  /** far=まだ遠い／near=近い（見えている写真の後に読む）／started=読み始めた */
  state: 'far' | 'near' | 'started';
}

/** スクロールする領域ごとの読み込みの順番待ち */
interface PhotoLoader {
  /** 見えている範囲に入ったかを見張る */
  readonly visible: IntersectionObserver;
  /** 近く（上下 NEAR_SCREENS 画面ぶん）に入ったかを見張る */
  readonly near: IntersectionObserver;
  readonly jobs: Map<Element, PhotoJob>;
  /** 読み込み中の「見えている写真」（これが空になるまで、近くの写真は読み始めない） */
  readonly urgent: Set<HTMLImageElement>;
  /** 読み込み中の「見えていない写真」（近く・遠く） */
  readonly background: Set<HTMLImageElement>;
  /** いま描いている格子で、すぐ読み始める先頭の残り枚数（描いていない間は undefined） */
  headLeft: number | undefined;
}

/** スクロールする領域 → 順番待ち（領域が消えれば一緒に消える） */
const loaders = new WeakMap<Element, PhotoLoader>();

/**
 * 写真を読み始める（src を戻す）。見えている写真は優先度を上げ、読み終えたら近くの写真の番にする。
 * @param loader 順番待ち
 * @param host 写真の枠
 * @param urgent 見えている写真なら true
 * @sideEffect img の src・loading・decoding・fetchPriority を変え、見張りをやめる
 */
function startJob(loader: PhotoLoader, host: Element, urgent: boolean): void {
  const log = logger.fn('startJob', { urgent });
  const job = loader.jobs.get(host);
  if (job === undefined || job.state === 'started') return log.exit(undefined, '対象なし');
  job.state = 'started';
  loader.visible.unobserve(host);
  loader.near.unobserve(host);
  const { img } = job;
  img.loading = 'eager';
  img.decoding = 'sync'; // 読み込み済みの写真は、画面に入った最初の描画で出す（後から遅れて出さない）
  img.fetchPriority = urgent ? 'high' : 'low';
  const loading = urgent ? loader.urgent : loader.background;
  loading.add(img);
  /**
   * 読み終えた（または読めなかった）ので、待っている写真の番にする。
   */
  const settle = (): void => {
    const settleLog = logger.fn('settle');
    loading.delete(img);
    startWaitingJobs(loader);
    settleLog.exit(undefined);
  };
  img.addEventListener('load', settle, { once: true });
  img.addEventListener('error', settle, { once: true });
  img.src = job.src;
  log.exit(undefined);
}

/**
 * 見えている写真をすべて読み終えていれば、近くの写真を読み始める。続けて、遠い写真を並びの順に FAR_PARALLEL 枚ずつ読む。
 * @param loader 順番待ち
 * @sideEffect 待っている写真の読み込みを始める
 */
function startWaitingJobs(loader: PhotoLoader): void {
  const log = logger.fn('startWaitingJobs', { urgent: loader.urgent.size, background: loader.background.size });
  if (loader.urgent.size > 0) return log.exit(undefined, '見えている写真を読み込み中');
  for (const [host, job] of loader.jobs) if (job.state === 'near') startJob(loader, host, false);
  for (const [host, job] of loader.jobs) {
    if (loader.background.size >= FAR_PARALLEL) break;
    if (job.state === 'far') startJob(loader, host, false);
  }
  log.exit(undefined);
}

/**
 * スクロールする領域の順番待ちを作る（見えている範囲の見張りを先に作る＝同じ描画の中で先に知らせが来る）。
 * @param root スクロールする領域（無ければ画面全体）
 * @returns 順番待ち
 * @sideEffect IntersectionObserver を2つ作る
 */
function createLoader(root: Element | null): PhotoLoader {
  const log = logger.fn('createLoader', { hasRoot: root !== null });
  const jobs = new Map<Element, PhotoJob>();
  const urgent = new Set<HTMLImageElement>();
  const visible = new IntersectionObserver(
    (entries): void => {
      for (const entry of entries) if (entry.isIntersecting) startJob(loader, entry.target, true);
    },
    { root },
  );
  const near = new IntersectionObserver(
    (entries): void => {
      for (const entry of entries) {
        const job = jobs.get(entry.target);
        if (entry.isIntersecting && job?.state === 'far') job.state = 'near';
      }
      startWaitingJobs(loader);
    },
    { root, rootMargin: `${NEAR_SCREENS * 100}% 0px` },
  );
  const loader: PhotoLoader = { visible, near, jobs, urgent, background: new Set<HTMLImageElement>(), headLeft: undefined };
  return log.exit(loader);
}

/**
 * 写真（src を持つ img）を、見えている順・近い順に読み込ませる。
 * @param host 写真の枠（スクロールする領域 .screen-scroll の中にあること）
 * @param img 写真（src は設定済み）
 * @returns 順番待ちから外す関数
 * @sideEffect img の src をいったん外し、枠が近づいたら戻す。IntersectionObserver が無い環境では何もしない（すぐ読む）
 */
export function loadPhotoInOrder(host: HTMLElement, img: HTMLImageElement): () => void {
  const log = logger.fn('loadPhotoInOrder');
  const src = img.getAttribute('src');
  if (typeof IntersectionObserver !== 'function' || src === null || (img.complete && img.naturalWidth > 0)) {
    img.loading = 'eager';
    return log.exit((): void => undefined, 'すぐ読む');
  }
  const root = host.closest('.screen-scroll');
  const key = root ?? document.documentElement;
  const loader = loaders.get(key) ?? createLoader(root);
  loaders.set(key, loader);
  img.removeAttribute('src');
  img.loading = 'eager'; // 読み始める時は src を戻すだけにする（ブラウザ任せの遅延読み込みは使わない）
  loader.jobs.set(host, { img, src, state: 'far' });
  if (loader.headLeft === undefined) {
    // 格子を描いた直後（同じ処理の中で続けて登録される）の先頭だけ、位置を測らずにすぐ読む。処理が終わったら数え直す
    loader.headLeft = HEAD_COUNT;
    void Promise.resolve().then((): void => {
      loader.headLeft = undefined;
    });
  }
  if (loader.headLeft > 0) {
    loader.headLeft -= 1;
    startJob(loader, host, true);
  } else {
    loader.visible.observe(host);
    loader.near.observe(host);
  }
  return log.exit((): void => {
    loader.visible.unobserve(host);
    loader.near.unobserve(host);
    // ここでは次の写真を読み始めない（格子を作り直すときは全部の枠を続けて外すので、捨てる写真を読み始めてしまう）
    loader.jobs.delete(host);
    loader.urgent.delete(img);
    loader.background.delete(img);
  });
}
