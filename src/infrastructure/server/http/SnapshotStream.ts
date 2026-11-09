/**
 * @file 公開スナップショットの版番号を SSE（Server-Sent Events）で配る（infrastructure/server/http 層。docs/09 APP-03）
 * 利用者アプリは EventSource でつなぎ、版番号が変わったら公開スナップショットを取り直す。
 * - つないだ直後に今の印（DB の ID と版番号）を送る（切れてつなぎ直したときの取りこぼしを防ぐ）
 * - 一定間隔で空のコメントを送り、途中の機器に切られないようにする
 * - 同時につなげる数に、全体と1つの相手ごとの上限を置く（1台で全部の枠を使い切れないように＝SEC-18）
 * 送るのは印だけで、個人の情報は流さない。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLogger } from '@/Common/logging/logger';
import { SNAPSHOT_STREAM_EVENT } from '@/infrastructure/api/apiRoutes';
import type { SnapshotMarker } from '@/infrastructure/api/schema/publicCmsSnapshot';

const logger = createLogger('infrastructure/server/http/SnapshotStream');

/** SSE の設定 */
export interface SnapshotStreamOptions {
  /** 同時につなげる数の上限（全体） */
  readonly maxClients: number;
  /** 同時につなげる数の上限（1つの相手ごと） */
  readonly maxPerClient: number;
  /** 空のコメントを送る間隔（ミリ秒） */
  readonly heartbeatMs: number;
}

/** つなぎ直すまでの待ち時間の目安（ミリ秒。EventSource に伝える） */
const RETRY_MS = 3000;

/** 版番号を SSE で配る */
export class SnapshotStream {
  private readonly clients = new Set<ServerResponse>();
  private readonly perClient = new Map<string, number>();
  private readonly heartbeat: ReturnType<typeof setInterval>;

  /**
   * SSE を作り、空のコメントの送信を始める。
   * @param options 上限・間隔
   * @sideEffect タイマーを登録する（プロセスの終了は妨げない）
   */
  constructor(private readonly options: SnapshotStreamOptions) {
    this.heartbeat = setInterval(() => this.writeAll(': ping\n\n'), options.heartbeatMs);
    this.heartbeat.unref();
  }

  /** 今つながっている数 */
  get size(): number {
    return this.clients.size;
  }

  /**
   * 1つの応答に書く（閉じた応答は飛ばす。一覧から外すのは要求の close のとき＝相手ごとの数と食い違わないように）。
   * @param res 応答
   * @param chunk 送る文字列
   * @sideEffect 応答に書く
   */
  private write(res: ServerResponse, chunk: string): void {
    if (!res.writableEnded && !res.destroyed) res.write(chunk);
  }

  /**
   * つながっているすべてに書く。
   * @param chunk 送る文字列
   * @sideEffect 応答に書く
   */
  private writeAll(chunk: string): void {
    for (const res of this.clients) this.write(res, chunk);
  }

  /**
   * 相手ごとの数を増減する。
   * @param clientKey 相手の識別子
   * @param delta +1 / -1
   * @sideEffect 数を書き換える（0 になったら忘れる）
   */
  private count(clientKey: string, delta: number): void { // audit-ignore: fnlog-missing つなぐ・切れるたびに呼ぶ小さな数え直し（attach で記録する）
    const next = (this.perClient.get(clientKey) ?? 0) + delta;
    if (next <= 0) this.perClient.delete(clientKey);
    else this.perClient.set(clientKey, next);
  }

  /**
   * つなぎ、今の印を送る。
   * @param ctx 要求・応答・相手の識別子
   * @param marker 今の DB の ID と版番号
   * @returns つないだら true（上限に達していたら false。呼び出し側が 503 を返す）
   * @sideEffect 応答を開いたままにする。切れたら外す
   */
  attach(ctx: { readonly req: IncomingMessage; readonly res: ServerResponse; readonly clientKey: string }, marker: SnapshotMarker): boolean {
    const log = logger.fn('attach', { clients: this.clients.size });
    const mine = this.perClient.get(ctx.clientKey) ?? 0;
    if (this.clients.size >= this.options.maxClients || mine >= this.options.maxPerClient) return log.exit(false, 'full');
    ctx.res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    this.clients.add(ctx.res);
    this.count(ctx.clientKey, 1);
    ctx.req.on('close', () => {
      if (this.clients.delete(ctx.res)) this.count(ctx.clientKey, -1);
    });
    this.write(ctx.res, `retry: ${RETRY_MS}\n\n`);
    this.write(ctx.res, this.messageOf(marker));
    return log.exit(true);
  }

  /**
   * 印のメッセージを作る。
   * @param marker DB の ID と版番号
   * @returns SSE の1件
   */
  private messageOf(marker: SnapshotMarker): string {
    return `event: ${SNAPSHOT_STREAM_EVENT}\ndata: ${JSON.stringify({ dbId: marker.dbId, version: marker.version })}\n\n`;
  }

  /**
   * 新しい印をすべてに送る。
   * @param marker 新しい DB の ID と版番号
   * @sideEffect 応答に書く
   */
  broadcast(marker: SnapshotMarker): void {
    const log = logger.fn('broadcast', { version: marker.version, clients: this.clients.size });
    this.writeAll(this.messageOf(marker));
    log.exit(undefined);
  }

  /**
   * すべてのつながりを閉じ、タイマーを止める。
   * @sideEffect 応答を閉じる
   */
  close(): void {
    const log = logger.fn('close', { clients: this.clients.size });
    clearInterval(this.heartbeat);
    for (const res of this.clients) res.end();
    this.clients.clear();
    this.perClient.clear();
    log.exit(undefined);
  }
}
