import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCorrelationId,
  configureLogger,
  createLogger,
  getCorrelationId,
  isDebugEnabled,
  resetLoggerConfig,
  setCorrelationId,
} from '@/Common/logging/logger';
import type { LogEntry } from '@/Common/logging/logger';
import { clearLogBuffer, exportLogBuffer, logBufferLength, readLogBuffer } from '@/Common/logging/logBuffer';
import { AppError, fail } from '@/Common/result/Result';

const logger = createLogger('test/logger');

/** テスト用の出力先（受け取ったエントリをためる） */
function captureSink(): { entries: LogEntry[]; sink: (e: LogEntry) => void } {
  const entries: LogEntry[] = [];
  return { entries, sink: (e) => entries.push(e) };
}

beforeEach(() => {
  resetLoggerConfig();
  clearLogBuffer();
  clearCorrelationId();
});

afterEach(() => {
  resetLoggerConfig();
  clearLogBuffer();
  clearCorrelationId();
});

describe('debug の有効・無効', () => {
  it('テスト環境の既定では debug は無効', () => {
    expect(isDebugEnabled()).toBe(false);
  });
  it('debug 無効なら ENTER/EXIT/途中経過はバッファにも sink にも入らない', () => {
    const cap = captureSink();
    configureLogger({ sink: cap.sink });
    const log = logger.fn('quiet', { a: 1 });
    log.debug('途中');
    expect(log.exit(42)).toBe(42);
    expect(readLogBuffer()).toHaveLength(0);
    expect(cap.entries).toHaveLength(0);
  });
  it('debug 無効でも失敗（warn）・info・error は記録される', () => {
    const log = logger.fn('failing');
    const r = log.fail(fail(AppError.of('OUT_OF_RANGE', '離れています')));
    log.info('完了');
    log.error('例外');
    expect(r.ok).toBe(false);
    expect(readLogBuffer().map((e) => `${e.level}:${e.phase}`)).toEqual(['warn:FAIL', 'info:LOG', 'error:LOG']);
  });
  it('debug 有効なら ENTER と EXIT（経過時間つき）を記録する', () => {
    configureLogger({ enabled: true });
    const log = logger.fn('traced', { spotId: 'l_jo01' });
    log.exit('done');
    const entries = readLogBuffer();
    expect(entries.map((e) => e.phase)).toEqual(['ENTER', 'EXIT']);
    expect(entries[0]?.data).toEqual({ spotId: 'l_jo01' });
    expect(entries[1]?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(entries[1]?.module).toBe('test/logger');
    expect(entries[1]?.fn).toBe('traced');
  });
});

describe('マスクとログ注入対策', () => {
  beforeEach(() => configureLogger({ enabled: true }));

  it('位置座標・トークン・コードをマスクする（大文字小文字を問わない）', () => {
    logger.fn('mask', { point: { lat: 34.69, lng: 135.195 }, Token: 'abc', password: 'p', code: 'COUPON1', meters: 37 });
    const data = readLogBuffer()[0]?.data;
    expect(data).toEqual({ point: { lat: '***', lng: '***' }, Token: '***', password: '***', code: '***', meters: 37 });
    expect(exportLogBuffer()).not.toContain('34.69');
  });
  it('AppError の失敗コードはマスクせず残す', () => {
    logger.fn('err').fail(fail(AppError.of('OUT_OF_RANGE', '離れています')));
    const failEntry = readLogBuffer().find((e) => e.phase === 'FAIL');
    expect(JSON.stringify(failEntry?.data)).toContain('OUT_OF_RANGE');
  });
  it('CR/LF・制御文字を空白に置き換える', () => {
    const log = logger.fn('inject', { name: 'a\r\nINFO 偽装\u0000x' });
    log.debug('行1\n行2');
    const [enter, msg] = readLogBuffer();
    expect(enter?.data).toEqual({ name: 'a  INFO 偽装 x' });
    expect(msg?.message).toBe('行1 行2');
  });
  it('1項目 500 文字で切り詰める', () => {
    logger.fn('long', { text: 'あ'.repeat(600) });
    const text = (readLogBuffer()[0]?.data as { text: string }).text;
    expect(text).toHaveLength(501);
    expect(text.endsWith('…')).toBe(true);
  });
  it('深さ制限・配列の件数制限・Error を安全に変換する', () => {
    logger.fn('deep', { a: { b: { c: { d: 1 } } }, list: Array.from({ length: 60 }, (_, i) => i), err: new Error('boom') });
    const data = readLogBuffer()[0]?.data as { a: unknown; list: unknown[]; err: unknown };
    expect(data.a).toEqual({ b: { c: '[depth]' } });
    expect(data.list).toHaveLength(51);
    expect(data.err).toEqual({ name: 'Error', message: 'boom' });
  });
});

describe('相関ID', () => {
  it('未指定なら6桁の英数字を発行し、以降のエントリに付く', () => {
    const cid = setCorrelationId();
    expect(cid).toMatch(/^[0-9a-z]{6}$/);
    expect(getCorrelationId()).toBe(cid);
    logger.fn('withCid').warn('注意');
    expect(readLogBuffer()[0]?.cid).toBe(cid);
  });
  it('指定値は英数字・_・- 以外を除く', () => {
    expect(setCorrelationId('ab\ncd<>')).toBe('abcd');
    expect(setCorrelationId('\n\n')).toMatch(/^[0-9a-z]{6}$/);
  });
  it('毎回ちがう値を発行する', () => {
    const ids = new Set(Array.from({ length: 50 }, () => setCorrelationId()));
    expect(ids.size).toBeGreaterThan(45);
  });
});

describe('バッファと出力先', () => {
  it('上限を超えたら古いものから捨てる', () => {
    configureLogger({ bufferSize: 3 });
    for (let i = 0; i < 5; i += 1) logger.fn('ring').info(`n${i}`);
    expect(readLogBuffer().map((e) => e.message)).toEqual(['n2', 'n3', 'n4']);
    expect(logBufferLength()).toBe(3);
  });
  it('絞り込み（モジュール・レベル・cid）', () => {
    const other = createLogger('other/module');
    logger.fn('a').info('i');
    other.fn('b').error('e');
    expect(readLogBuffer({ module: 'other' })).toHaveLength(1);
    expect(readLogBuffer({ minLevel: 'error' })[0]?.message).toBe('e');
    expect(readLogBuffer({ cid: 'none' })).toHaveLength(0);
  });
  it('sink の例外でアプリを止めない', () => {
    configureLogger({
      sink: () => {
        throw new Error('sink down');
      },
    });
    expect(() => logger.fn('x').warn('w')).not.toThrow();
    expect(readLogBuffer().some((e) => e.fn === 'deliver')).toBe(true);
  });
  it('undefined を渡した項目は既定値のまま', () => {
    const cap = captureSink();
    configureLogger({ sink: cap.sink });
    configureLogger({ sink: undefined });
    logger.fn('keep').warn('w');
    expect(cap.entries).toHaveLength(1);
  });
});
