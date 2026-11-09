/**
 * @file 地図の効果音（presentation/screens/Map/town 層）
 * 2026-11-09 ユーザー指示「チェックインをもっと快感ある気持ちいいチェックインにしてほしい」。
 * 音の素材は使わず、Web Audio で合成する（ボタンの「ポン」、スタンプの「ドン」、コインの「チャリン」、ファンファーレ、建物が建つ「ポコポコ」）。
 * AudioContext は利用者の操作（ボタンを押した時）に初めて作る（ブラウザの自動再生の決まり）。使えない環境では何もしない。
 * 音量は控えめ（MASTER_VOLUME）。端末の消音・音量に従う。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/screens/Map/town/mapSound');

/** 全体の音量（0..1） */
export const MASTER_VOLUME = 0.32;

let audio: AudioContext | undefined;
let master: GainNode | undefined;

/**
 * AudioContext を用意する（無ければ作る。止まっていれば再開する）。
 * @returns 出力先（使えなければ undefined）
 * @sideEffect AudioContext を作る・再開する
 */
function out(): { ctx: AudioContext; dest: GainNode } | undefined { // audit-ignore: fnlog-missing 音を鳴らすたびに呼ぶ（作るときだけ unlockSound がログ）
  if (audio === undefined || master === undefined) return undefined;
  if (audio.state === 'suspended') void audio.resume();
  return { ctx: audio, dest: master };
}

/**
 * 利用者の操作の中で呼び、音を鳴らせる状態にする（2回目以降は再開だけ）。
 * @sideEffect AudioContext を作る
 */
export function unlockSound(): void {
  const log = logger.fn('unlockSound', { ready: audio !== undefined });
  if (audio !== undefined) {
    if (audio.state === 'suspended') void audio.resume();
    return log.exit(undefined);
  }
  const Ctor: typeof AudioContext | undefined = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (Ctor === undefined) return log.exit(undefined, 'Web Audio なし');
  try {
    audio = new Ctor();
    master = audio.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(audio.destination);
  } catch (error) {
    log.warn('音を用意できませんでした', { error });
    audio = undefined;
    master = undefined;
  }
  log.exit(undefined);
}

/**
 * 1音を鳴らす（音程が start → end に動き、音量は鋭く立ち上がって減衰する）。
 * @param type 波形
 * @param start 始めの周波数（Hz）
 * @param end 終わりの周波数（Hz）
 * @param at 開始（秒。AudioContext の時刻からの遅れ）
 * @param dur 長さ（秒）
 * @param gain 音量
 * @sideEffect 音を鳴らす
 */
function tone(type: OscillatorType, start: number, end: number, at: number, dur: number, gain: number): void { // audit-ignore: fnlog-missing 効果音の1音ごとに呼ぶ内部ヘルパー
  const o = out();
  if (o === undefined) return;
  const t = o.ctx.currentTime + at;
  const osc = o.ctx.createOscillator();
  const g = o.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(start, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(o.dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/**
 * 短い雑音（スタンプの「バン」の厚み・紙吹雪のシャッ）。
 * @param at 開始（秒）
 * @param dur 長さ（秒）
 * @param gain 音量
 * @param lowpass 高い音を削る周波数（Hz）
 * @sideEffect 音を鳴らす
 */
function noise(at: number, dur: number, gain: number, lowpass: number): void { // audit-ignore: fnlog-missing 効果音の1音ごとに呼ぶ内部ヘルパー
  const o = out();
  if (o === undefined) return;
  const length = Math.max(1, Math.floor(o.ctx.sampleRate * dur));
  const buffer = o.ctx.createBuffer(1, length, o.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 22_222;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    data[i] = ((seed / 0x7fffffff) * 2 - 1) * (1 - i / length) ** 2;
  }
  const src = o.ctx.createBufferSource();
  src.buffer = buffer;
  const filter = o.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = lowpass;
  const g = o.ctx.createGain();
  g.gain.value = gain;
  src.connect(filter);
  filter.connect(g);
  g.connect(o.dest);
  src.start(o.ctx.currentTime + at);
}

/**
 * ボタンを押した「ポン」。
 * @sideEffect 音を鳴らす
 */
export function playPress(): void { // audit-ignore: fnlog-missing 効果音（ボタンごと）
  tone('sine', 520, 880, 0, 0.09, 0.5);
}

/**
 * スタンプの「ドン」（低い衝撃音＋雑音の厚み＋高いきらめき）。
 * @sideEffect 音を鳴らす
 */
export function playStamp(): void { // audit-ignore: fnlog-missing 効果音（チェックインごと）
  tone('sine', 150, 45, 0, 0.32, 1);
  tone('triangle', 300, 90, 0, 0.18, 0.5);
  noise(0, 0.16, 0.7, 1800);
  noise(0.02, 0.5, 0.18, 6000);
  tone('sine', 1568, 2093, 0.06, 0.25, 0.18);
  tone('sine', 2093, 2637, 0.12, 0.3, 0.14);
}

/**
 * コインの「チャリン」（2音の高い音）。
 * @param pitch 何枚目か（少しずつ音を上げる）
 * @sideEffect 音を鳴らす
 */
export function playCoin(pitch = 0): void { // audit-ignore: fnlog-missing 効果音（コインごと）
  const base = 1318 * 2 ** (Math.min(pitch, 7) / 12);
  tone('square', base, base, 0, 0.06, 0.12);
  tone('square', base * 1.335, base * 1.335, 0.055, 0.16, 0.12);
}

/**
 * 領地が広がる「ポコポコ」（建物が建つ音を数回）。
 * @param count 回数
 * @sideEffect 音を鳴らす
 */
export function playGrow(count = 5): void { // audit-ignore: fnlog-missing 効果音（チェックインごと）
  for (let i = 0; i < Math.min(8, count); i++) tone('sine', 330 + i * 60, 520 + i * 60, i * 0.07, 0.08, 0.28);
}

/**
 * 地区が育った・帯が出るときのファンファーレ（ド・ミ・ソ・ド の上り）。
 * @param big 大きく（地区が育ったとき）
 * @sideEffect 音を鳴らす
 */
export function playFanfare(big = false): void { // audit-ignore: fnlog-missing 効果音（チェックインごと）
  const notes = big ? [523, 659, 784, 1047, 1319] : [784, 1047, 1319];
  notes.forEach((f, i) => {
    tone('triangle', f, f, i * 0.09, big && i === notes.length - 1 ? 0.6 : 0.18, 0.32);
    tone('sine', f * 2, f * 2, i * 0.09, 0.12, 0.08);
  });
}

/**
 * 端末を短く震わせる（対応していない端末では何もしない）。
 * @param pattern 震わせ方（ミリ秒の並び）
 * @sideEffect 端末を震わせる
 */
export function buzz(pattern: number | number[]): void { // audit-ignore: fnlog-missing 演出ごとに呼ぶ
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}

/**
 * QR を読み取れた「ピピッ」。
 * @sideEffect 音を鳴らす
 */
export function playScanBeep(): void { // audit-ignore: fnlog-missing 効果音（読み取りごと）
  tone('square', 1760, 1760, 0, 0.07, 0.16);
  tone('square', 2349, 2349, 0.09, 0.11, 0.16);
}
