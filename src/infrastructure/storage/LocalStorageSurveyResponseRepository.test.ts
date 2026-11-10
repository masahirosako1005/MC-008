/**
 * @file アンケートの回答の localStorage リポジトリのテスト（infrastructure/storage 層）
 * 足す・二重登録の防止・上限・消す・読めないデータの退避と、利用者の「書き出し・全削除」の対象外であることを確かめる。
 */
import { describe, expect, it } from 'vitest';
import type { Result } from '@/Common/result/Result';
import type { SpotId } from '@/Common/types/Id';
import type { Instant } from '@/Common/utils/date';
import { SURVEY_RESPONSE_LIMIT } from '@/application/ports/SurveyResponseRepository';
import type { SurveyResponse } from '@/application/usecases/survey/shopSurvey';
import { InMemoryKeyValueStore } from '@/infrastructure/storage/InMemoryKeyValueStore';
import { isUserDataKey } from '@/infrastructure/storage/LocalStorageDataPort';
import { LocalStorageSurveyResponseRepository } from '@/infrastructure/storage/LocalStorageSurveyResponseRepository';

const PREFIX = 'nnishi.demo.';
const KEY = `${PREFIX}cms.surveys`;

/** 成功の値を取り出す（失敗ならテストを落とす） */
function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** テスト用の回答を作る */
function responseOf(n: number): SurveyResponse {
  return { id: `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`, spotId: 's_mm04' as SpotId, answeredAt: '2026-11-10T03:00:00.000Z' as Instant, satisfaction: 5, trigger: 'app', goods: ['mood'], concerns: [], revisit: 'yes' };
}

describe('LocalStorageSurveyResponseRepository', () => {
  it('足した回答を読める。同じ id は1件だけ。消すと空に戻る', async () => {
    const repo = new LocalStorageSurveyResponseRepository({ store: new InMemoryKeyValueStore(), prefix: PREFIX });
    expect(must(await repo.list())).toEqual([]);
    must(await repo.append(responseOf(1)));
    must(await repo.append(responseOf(1)));
    must(await repo.append({ ...responseOf(2), comment: 'また来ます' }));
    expect(must(await repo.list())).toEqual([responseOf(1), { ...responseOf(2), comment: 'また来ます' }]);
    must(await repo.clear());
    expect(must(await repo.list())).toEqual([]);
  });

  it('上限を超えたら古いものから落とす', async () => {
    const repo = new LocalStorageSurveyResponseRepository({ store: new InMemoryKeyValueStore(), prefix: PREFIX });
    for (let n = 0; n <= SURVEY_RESPONSE_LIMIT; n += 1) must(await repo.append(responseOf(n)));
    const stored = must(await repo.list());
    expect(stored).toHaveLength(SURVEY_RESPONSE_LIMIT);
    expect(stored[0]?.id).toBe(responseOf(1).id);
  }, 60_000);

  it('読めないデータは退避して失敗を返し、次からは空として動く（DI-01）', async () => {
    const store = new InMemoryKeyValueStore();
    const repo = new LocalStorageSurveyResponseRepository({ store, prefix: PREFIX });
    must(await repo.append(responseOf(1)));
    const raw = store.get(KEY);
    store.set(KEY, (raw.ok ? raw.value ?? '' : '').replace('"satisfaction":5', '"satisfaction":9'));
    expect((await repo.list()).ok).toBe(false);
    expect(must(await repo.list())).toEqual([]);
  });

  it('お店側のデータなので、利用者の書き出し・全削除には入らない', () => {
    expect(isUserDataKey(KEY, PREFIX)).toBe(false);
  });
});
