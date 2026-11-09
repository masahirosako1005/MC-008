/**
 * @file デモメニューの表示用純粋関数の単体テスト（presentation/screens/Demo 層）
 */
import { describe, expect, it } from 'vitest';
import type { MapUiState } from '@/presentation/App/AppContext';
import {
  DEFAULT_RIVAL_DISTRICT_ID,
  districtNameOf,
  formatDemoDate,
  resetMapUi,
  resetPositionTexts,
  rivalButtonLabel,
  rivalDistrictOptions,
  rivalResultMessage,
} from '@/presentation/screens/Demo/demoModel';

describe('formatDemoDate', () => {
  it('YYYY-MM-DD を曜日付きの表示にする', () => {
    expect(formatDemoDate('2026-12-09')).toBe('2026/12/09（水）');
  });
  it('形式外の文字列はそのまま返す', () => {
    expect(formatDemoDate('不明')).toBe('不明');
  });
});

describe('ライバル行動の文言', () => {
  it('ボタンは「旅人タロウが{地区}の主を奪う」', () => {
    expect(rivalButtonLabel('天満地区')).toBe('旅人タロウが天満地区の主を奪う');
  });
  it('主が交代したかどうかで結果の文言を変える', () => {
    const base = { districtId: 'd_tenma', districtName: '天満地区', rivalName: '旅人タロウ' };
    expect(rivalResultMessage({ ...base, changed: true })).toBe('旅人タロウが天満地区の主になりました');
    expect(rivalResultMessage({ ...base, changed: false })).toBe('旅人タロウが天満地区を訪れました（主は変わりません）');
  });
  it('既定の地区は天満（d_tenma）。地区一覧を読めなければ天満だけを選べる', () => {
    expect(DEFAULT_RIVAL_DISTRICT_ID).toBe('d_tenma');
    expect(rivalDistrictOptions([])).toEqual([{ id: 'd_tenma', name: '天満地区' }]);
    const options = rivalDistrictOptions([{ id: 'd_minamimori', name: '南森町・天満宮地区' }]);
    expect(districtNameOf(options, 'd_minamimori')).toBe('南森町・天満宮地区');
    expect(districtNameOf(options, 'd_x')).toBe('d_x');
  });
});

describe('位置リセットの文言', () => {
  it('南森町駅（開始地区の入口）へ戻す。地区名は町の状態から取る', () => {
    const texts = resetPositionTexts([{ id: 'd_minamimori', name: '南森町・天満宮地区' }]);
    expect(texts.button).toBe('位置リセット（南森町駅へ）');
    expect(texts.done).toBe('南森町駅（南森町・天満宮地区の入口）に戻りました');
    expect(texts.hint).toContain('足あとも消えます');
  });
  it('地区一覧を読めなければ既定の地区名を使う', () => {
    expect(resetPositionTexts([]).done).toBe('南森町駅（南森町・天満宮地区の入口）に戻りました');
  });
  it('旧地名（城下・本町）を含まない', () => {
    const texts = resetPositionTexts([]);
    for (const text of [texts.button, texts.done, texts.hint]) expect(text).not.toMatch(/城下|本町/);
  });
});

describe('resetMapUi', () => {
  it('旅人切替のあと地図を広域・足あと無し・つまみに戻す', () => {
    const ui: MapUiState = { zoom: 'near', districtId: 'd_joka', footprints: [{ lat: 1, lng: 2 }], pulseDistrictId: 'd_joka', sheetState: 'full' };
    resetMapUi(ui);
    expect(ui).toEqual({ zoom: 'wide', districtId: undefined, footprints: [], pulseDistrictId: undefined, sheetState: 'peek' });
  });
});
