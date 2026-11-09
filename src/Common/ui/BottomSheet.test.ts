import { describe, expect, it } from 'vitest';
import { nextSheetStateOnTap, sheetStateAfterSwipe, SWIPE_THRESHOLD_PX } from '@/Common/ui/BottomSheet';

describe('nextSheetStateOnTap', () => {
  it('つまみのタップで つまみ→半分→全画面→つまみ と巡回する', () => {
    expect(nextSheetStateOnTap('peek')).toBe('half');
    expect(nextSheetStateOnTap('half')).toBe('full');
    expect(nextSheetStateOnTap('full')).toBe('peek');
  });
});

describe('sheetStateAfterSwipe', () => {
  it('上へスワイプすると1段開く（全画面が上限）', () => {
    expect(sheetStateAfterSwipe('peek', -SWIPE_THRESHOLD_PX)).toBe('half');
    expect(sheetStateAfterSwipe('half', -200)).toBe('full');
    expect(sheetStateAfterSwipe('full', -200)).toBe('full');
  });
  it('下へスワイプすると1段閉じる（つまみが下限）', () => {
    expect(sheetStateAfterSwipe('full', 200)).toBe('half');
    expect(sheetStateAfterSwipe('half', SWIPE_THRESHOLD_PX)).toBe('peek');
    expect(sheetStateAfterSwipe('peek', 200)).toBe('peek');
  });
  it('移動量がしきい値未満ならスワイプとみなさない', () => {
    expect(sheetStateAfterSwipe('half', SWIPE_THRESHOLD_PX - 1)).toBeUndefined();
    expect(sheetStateAfterSwipe('half', -(SWIPE_THRESHOLD_PX - 1))).toBeUndefined();
  });
});
