/**
 * @file マスタ検証ルール（lib/masterChecks.mjs・check-master.mjs）のテスト（scripts 層）
 * 生成済みマスタの合格と、改変 JSON（件数・ID・参照・座標・川・日付・ライバル・背景・便利施設ポイント・文言）の検出を確かめる
 * （DI-13, SEC-22, T-07）。2026-11-09: 舞台を南森町周辺に変更（docs/08 §9）したため、ID と座標を差し替えた。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { checkMaster, isValidLocalDate } from './lib/masterChecks.mjs';
import { loadMasterBundle } from './lib/masterFiles.mjs';
import { checkFileEncoding } from './check-master.mjs';

/** 生成済みマスタ（public/master）のパース結果 */
let base;

beforeAll(() => {
  const bundle = loadMasterBundle();
  expect(bundle.errors).toEqual([]);
  base = bundle.data;
});

/**
 * 生成済みマスタの複製を作り、改変してから検証するテスト用ヘルパー（DI-13 の改変 JSON テスト）。
 * @param {(data: Record<string, any>) => void} mutate 複製に加える改変
 * @returns {{errors: string[], warnings: string[], facts: object}} 検証結果
 */
function checkMutated(mutate) { // audit-ignore: fnlog-missing テストの補助関数（静的監査のテスト判定が .test.mjs を含まないため対象になる。docs/07 §2 ではテストは除外）
  const data = structuredClone(base);
  mutate(data);
  return checkMaster(data);
}

/**
 * 改変後の違反メッセージを1つの文字列にして返すテスト用ヘルパー。
 * @param {(data: Record<string, any>) => void} mutate 複製に加える改変
 * @returns {string} 違反メッセージ（改行区切り。合格なら空文字）
 */
function errorsAfter(mutate) {
  return checkMutated(mutate).errors.join('\n');
}

/**
 * スポットを ID で探すテスト用ヘルパー。
 * @param {Record<string, any>} data マスタ
 * @param {string} id スポットID
 * @returns {any} スポット
 */
function spotOf(data, id) {
  return [...data['landmarks.json'].landmarks, ...data['shops.json'].shops].find((s) => s.id === id);
}

/**
 * 地区を ID で探すテスト用ヘルパー。
 * @param {Record<string, any>} data マスタ
 * @param {string} id 地区ID
 * @returns {any} 地区
 */
function districtOf(data, id) {
  return data['districts.json'].districts.find((d) => d.id === id);
}

/**
 * スポットを緯度経度へ動かすテスト用ヘルパー。
 * @param {any} spot スポット
 * @param {number} lat 緯度
 * @param {number} lng 経度
 * @returns {void}
 */
function moveSpot(spot, lat, lng) {
  Object.assign(spot, { lat, lng });
}

/**
 * s_mm09 を s_mm08 の真北 meters メートルへ動かす改変を作るテスト用ヘルパー（スポット間距離の境界値テスト）。
 * @param {number} meters s_mm08 からの距離（メートル）
 * @returns {(data: Record<string, any>) => void} 改変
 */
function placeNorthOfMm08(meters) { // audit-ignore: fnlog-missing テストの補助関数（静的監査のテスト判定が .test.mjs を含まないため対象になる。docs/07 §2 ではテストは除外）
  return (d) => {
    const s08 = spotOf(d, 's_mm08');
    moveSpot(spotOf(d, 's_mm09'), s08.lat + meters / 111000, s08.lng);
  };
}

describe('生成済みマスタ', () => {
  it('すべての検証に合格する（違反0件・警告0件）', () => {
    const report = checkMaster(base);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('デモ動線: 南森町 entrance→和菓子店は100〜160m、歩行で未発見スポットを2つ以上発見、天満のデモ用4か所は南寄り', () => {
    const { facts } = checkMaster(base);
    expect(facts.startEntranceToWagashi.min).toBeGreaterThanOrEqual(100);
    expect(facts.startEntranceToWagashi.max).toBeLessThanOrEqual(160);
    expect(facts.walkDiscoveries.length).toBeGreaterThanOrEqual(2);
    expect(facts.walkDiscoveries.every((f) => f.id.startsWith('s_mm') || f.id.startsWith('l_mm'))).toBe(true);
    expect(facts.tenmaSouth.map((f) => f.id)).toEqual(['l_tm02', 's_tm01', 's_tm02', 's_tm03']);
  });

  it('スポットはどれも川の中心線から 60m 以上、公衆トイレは1件以上ある', () => {
    const { facts } = checkMaster(base);
    for (const [id, f] of Object.entries(facts.districts)) expect(f.minRiver, id).toBeGreaterThanOrEqual(60);
    expect(facts.amenityCounts.toilet).toBeGreaterThan(0);
    expect(facts.amenityCounts.nursing).toBe(1);
  });

  it('改行は LF で BOM もない（ハッシュが環境で変わらない）', () => {
    expect(checkFileEncoding(loadMasterBundle().texts)).toEqual([]);
    expect(checkFileEncoding({ 'x.json': '{}\r\n' })[0]).toContain('CRLF');
    expect(checkFileEncoding({ 'x.json': '﻿{}' })[0]).toContain('BOM');
  });
});

describe('件数・ID・参照の改変を検出する', () => {
  it('店舗を1件削除すると件数違反（T-07）', () => {
    expect(errorsAfter((d) => d['shops.json'].shops.pop())).toContain('[count] 店舗が 65 件です');
  });

  it('IDの重複を検出する（背景・駅・便利施設ポイントも含む）', () => {
    expect(errorsAfter((d) => {
      d['shops.json'].shops[1].id = d['shops.json'].shops[0].id;
    })).toContain('が重複しています');
    expect(errorsAfter((d) => {
      d['amenityPoints.json'].points[1].id = d['amenityPoints.json'].points[0].id;
    })).toContain('ID a_wc01 が重複しています');
  });

  it('ID の形式違反（大文字・連番1桁・旧 N西市の地区2字）を検出する（SEC-16）', () => {
    expect(errorsAfter((d) => {
      d['shops.json'].shops[0].id = 'S_MM01';
    })).toContain('[id] spot の ID "S_MM01"');
    expect(errorsAfter((d) => {
      d['shops.json'].shops[0].id = 's_mm1';
    })).toContain('命名規則');
    expect(errorsAfter((d) => {
      d['shops.json'].shops[0].id = 's_jo01';
    })).toContain('命名規則');
  });

  it('背景・駅・便利施設ポイントの ID の形式違反を検出する', () => {
    const text = errorsAfter((d) => {
      d['mapFeatures.json'].features[0].id = 'F_OKAWA';
      d['mapFeatures.json'].stations[0].id = 'st_x';
      d['amenityPoints.json'].points[0].id = 'wc01';
    });
    expect(text).toContain('[id] feature の ID "F_OKAWA"');
    expect(text).toContain('[id] station の ID "st_x"');
    expect(text).toContain('[id] amenityPoint の ID "wc01"');
  });

  it('ID の地区2字と districtId の食い違いを検出する', () => {
    expect(errorsAfter((d) => {
      spotOf(d, 's_mm01').districtId = 'd_tenma';
    })).toContain('s_mm01 の地区2字 mm と districtId d_tenma');
  });

  it('存在しない地区・スポットへの参照を検出する（DI-16）', () => {
    const text = errorsAfter((d) => {
      spotOf(d, 's_ok01').districtId = 'd_unknown';
      d['shopEvents.json'].shopEvents[0].spotId = 's_zz99';
    });
    expect(text).toContain('s_ok01 の地区 d_unknown がありません');
    expect(text).toContain('のスポット s_zz99 がありません');
  });

  it('店舗協力のない店舗・名所に付いたクーポンを検出する', () => {
    expect(errorsAfter((d) => {
      d['shopEvents.json'].shopEvents.find((e) => e.id === 'c_mm01').spotId = 's_mm03';
    })).toContain('クーポン c_mm01 が店舗協力ありの店舗ではない s_mm03');
    expect(errorsAfter((d) => {
      d['shopEvents.json'].shopEvents.find((e) => e.id === 'c_mm02').spotId = 'l_mm01';
    })).toContain('クーポン c_mm02 が店舗協力ありの店舗ではない l_mm01');
  });

  it('指定名のスポットの改名・名所の座標のずれ・舞台の範囲の変更を検出する', () => {
    expect(errorsAfter((d) => {
      spotOf(d, 's_mm02').name = '福まる菓子店';
    })).toContain('s_mm02 は「福まるどら焼き本舗」でなければなりません');
    expect(errorsAfter((d) => {
      spotOf(d, 'l_mm01').lat = 34.6962;
    })).toContain('l_mm01 大阪天満宮 の座標が docs/08 §9.2');
    expect(errorsAfter((d) => {
      d['districts.json'].city.bounds.north = 34.72;
    })).toContain('city.bounds.north が 34.714 ではありません');
  });

  it('壊れた構造（配列でない）でも例外で止まらず違反を返す', () => {
    const { errors } = checkMutated((d) => {
      d['shops.json'].shops = 'broken';
      d['districts.json'].districts[0].polygon = null;
      d['mapFeatures.json'].features = null;
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain('[schema] shops.json/shops: 型が');
  });
});

describe('座標配置の改変を検出する', () => {
  it('スポットを地区ポリゴンの外へ動かすと違反', () => {
    expect(errorsAfter((d) => moveSpot(spotOf(d, 's_mm11'), 34.703, 135.509))).toContain('s_mm11 寿司 てんまる が d_minamimori のポリゴンの外にあります');
  });

  it('境界から15m未満（約9m内側）に置くと違反', () => {
    expect(errorsAfter((d) => moveSpot(spotOf(d, 's_mm11'), 34.699, 135.5079))).toContain('s_mm11 が境界から');
  });

  it('同じ地区のスポット間 59m は違反、62m は合格（境界値）', () => {
    expect(errorsAfter(placeNorthOfMm08(59))).toContain('s_mm08 と s_mm09 が');
    expect(errorsAfter(placeNorthOfMm08(62))).not.toContain('s_mm08 と s_mm09 が');
  });

  it('川の中心線から 60m 未満に置くと違反（川の中に置かない）', () => {
    expect(errorsAfter((d) => moveSpot(spotOf(d, 's_ok01'), 34.6918, 135.5133))).toContain('s_ok01 川べり珈琲 ゆらぎ が 堂島川の中心線から');
    expect(errorsAfter((d) => moveSpot(spotOf(d, 's_ok11'), 34.6995, 135.5218))).toContain('s_ok11 ジェラート ふわり が 大川の中心線から');
  });

  it('川（kind=water の line）が無ければスポットの川の検証ができないので違反', () => {
    expect(errorsAfter((d) => {
      d['mapFeatures.json'].features = d['mapFeatures.json'].features.filter((f) => f.kind !== 'water');
    })).toContain('川（kind=water の line）がありません');
  });

  it('entrance から 85m 未満にスポットがあると違反', () => {
    expect(errorsAfter((d) => {
      districtOf(d, 'd_minamimori').entrance = { lat: 34.6977, lng: 135.51065 };
    })).toContain('d_minamimori.entrance と s_mm07 が');
  });

  it('地区ポリゴンが重なると違反', () => {
    expect(errorsAfter((d) => {
      districtOf(d, 'd_tenma').polygon[1] = { lat: 34.7005, lng: 135.511 };
    })).toContain('d_minamimori と d_tenma のポリゴンが重なっています');
  });

  it('南森町 entrance→和菓子店が160mを超えると違反', () => {
    expect(errorsAfter((d) => moveSpot(spotOf(d, 's_mm02'), 34.6992, 135.51))).toContain('[demo] d_minamimori entrance→s_mm02');
  });

  it('歩行経路沿いの未発見スポットをなくすと違反', () => {
    const text = errorsAfter((d) => {
      moveSpot(spotOf(d, 's_mm05'), 34.7008, 135.509);
      moveSpot(spotOf(d, 's_mm06'), 34.7008, 135.5101);
      moveSpot(spotOf(d, 's_mm07'), 34.7008, 135.514);
    });
    expect(text).toContain('[demo] d_minamimori entrance→center の歩行で新たに発見できるスポットが 0 件');
  });

  it('天満のデモ用スポットを北側へ動かすと違反', () => {
    expect(errorsAfter((d) => moveSpot(spotOf(d, 's_tm03'), 34.7078, 135.515))).toContain('[demo] s_tm03 が天満の南寄り');
  });
});

describe('背景（mapFeatures）・便利施設ポイント（amenityPoints）の改変を検出する', () => {
  it('area が2点・line に widthM なし・area に widthM ありを検出する', () => {
    const text = errorsAfter((d) => {
      const features = d['mapFeatures.json'].features;
      features.find((f) => f.id === 'f_takigawa_park').points.splice(2);
      delete features.find((f) => f.id === 'f_road_sonezaki').widthM;
      features.find((f) => f.id === 'f_mint').widthM = 10;
    });
    expect(text).toContain('[map] f_takigawa_park の area は3点以上が必要です（2 点）');
    expect(text).toContain('[map] f_road_sonezaki の line に widthM（太さ）がありません');
    expect(text).toContain('[map] f_mint は area なので widthM を持ちません');
  });

  it('市域から大きく外れた座標・必要な種類の欠落・駅の欠落・出典表示の変更を検出する', () => {
    const text = errorsAfter((d) => {
      const map = d['mapFeatures.json'];
      map.features.find((f) => f.id === 'f_okawa').points[0] = { lat: 34.73, lng: 135.521 };
      map.features = map.features.filter((f) => f.kind !== 'rail');
      map.stations = map.stations.filter((s) => s.id !== 'st_tenma');
      map.attribution = 'OSM';
    });
    expect(text).toContain('[map] f_okawa の座標が市域（＋300m）の外にあります');
    expect(text).toContain('[map] 背景に kind=rail の地物がありません');
    expect(text).toContain('[map] 駅 st_tenma「天満」がありません');
    expect(text).toContain('[map] mapFeatures.json の attribution');
  });

  it('未知の kind はスキーマ違反', () => {
    expect(errorsAfter((d) => {
      d['mapFeatures.json'].features[0].kind = 'sea';
    })).toContain('許可されていない値です: "sea"');
  });

  it('公衆トイレを川の水面・市域の外に置くと違反', () => {
    const text = errorsAfter((d) => {
      const points = d['amenityPoints.json'].points;
      Object.assign(points.find((p) => p.id === 'a_wc13'), { lat: 34.6922, lng: 135.5103 });
      Object.assign(points.find((p) => p.id === 'a_wc01'), { lat: 34.7145 });
    });
    expect(text).toContain('[amenity] a_wc13 が堂島川の水面');
    expect(text).toContain('[amenity] a_wc01 が city.bounds の外にあります');
  });

  it('公衆トイレが1件もなければ違反', () => {
    expect(errorsAfter((d) => {
      d['amenityPoints.json'].points = d['amenityPoints.json'].points.filter((p) => p.kind !== 'toilet');
    })).toContain('公衆トイレ（kind=toilet）が1件もありません');
  });
});

/**
 * s_ok13 の説明文を n 文字にして検証し、違反メッセージを1つの文字列にして返すテスト用ヘルパー。
 * @param {number} n 説明文の文字数
 * @returns {string} 違反メッセージ（改行区切り。合格なら空文字）
 */
function descriptionErrorsOfLength(n) { // audit-ignore: fnlog-missing テストの補助関数（静的監査のテスト判定が .test.mjs を含まないため対象になる。docs/07 §2 ではテストは除外）
  return errorsAfter((d) => {
    spotOf(d, 's_ok13').description = 'あ'.repeat(n);
  });
}

describe('日付・ライバル・文言の改変を検出する', () => {
  it('実在しない日付と start > end を検出する（DI-04 境界）', () => {
    expect(isValidLocalDate('2026-02-28')).toBe(true);
    expect(isValidLocalDate('2028-02-29')).toBe(true);
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-1-01')).toBe(false);
    expect(isValidLocalDate(20261101)).toBe(false);
    const text = errorsAfter((d) => {
      const events = d['shopEvents.json'].shopEvents;
      events.find((e) => e.id === 'c_ok01').end = '2026-02-30';
      events.find((e) => e.id === 'c_og03').start = '2027-06-01';
    });
    expect(text).toContain('c_ok01 の日付が不正です');
    expect(text).toContain('c_og03 の start 2027-06-01 が end 2027-05-31 より後です');
  });

  it('start と end が同じ日は合格（1日だけのイベント）', () => {
    const { errors } = checkMutated((d) => {
      const e = d['shopEvents.json'].shopEvents.find((x) => x.id === 'c_ok03');
      e.end = e.start;
    });
    expect(errors).toEqual([]);
  });

  it('c_mm01 の期間変更を検出する', () => {
    expect(errorsAfter((d) => {
      d['shopEvents.json'].shopEvents.find((e) => e.id === 'c_mm01').end = '2026-11-13';
    })).toContain('c_mm01 は s_mm02「どら焼き1個サービス」');
  });

  it('実在の名所のイベントに「模擬」の明記がなければ違反（実在行事と誤認させない）', () => {
    const text = errorsAfter((d) => {
      const e = d['shopEvents.json'].shopEvents.find((x) => x.id === 'c_ok03');
      e.title = '造幣局 桜の通り抜け';
      e.description = '毎年4月に構内の桜並木が一般公開される。';
    });
    expect(text).toContain('実在の名所のイベント c_ok03 に「模擬」の明記がありません');
  });

  it('天満の背景活動と範囲外の phase を検出する（D9）', () => {
    const text = errorsAfter((d) => {
      const taro = d['rivals.json'].rivals.find((r) => r.id === 'r_taro');
      taro.patterns.push({ districtId: 'd_tenma', intervalDays: 5, phase: 0 });
      taro.patterns[0].phase = 4;
    });
    expect(text).toContain('r_taro が天満（d_tenma）の背景活動を持っています');
    expect(text).toContain('r_taro の phase 4 が 0..3 にありません');
  });

  it('「施設」という語を検出する（背景・便利施設ポイントのファイルも対象）', () => {
    expect(errorsAfter((d) => {
      spotOf(d, 'l_og02').description = '子どものための施設です。体験型の展示が多く、雨の日の親子のお出かけにも向く場所です。';
    })).toContain('「施設」が含まれています');
    expect(errorsAfter((d) => {
      d['amenityPoints.json'].points[0].note = '公園の施設内';
    })).toContain('amenityPoints.json に「施設」が含まれています');
  });

  it('説明文は40字ちょうど・70字ちょうどで合格、39字・71字で違反（境界値）', () => {
    expect(descriptionErrorsOfLength(40)).toBe('');
    expect(descriptionErrorsOfLength(70)).toBe('');
    expect(descriptionErrorsOfLength(39)).toContain('下限 40');
    expect(descriptionErrorsOfLength(71)).toContain('上限 70');
  });

  it('未知の便利情報コードはスキーマ違反', () => {
    expect(errorsAfter((d) => {
      spotOf(d, 's_mm01').amenities = ['wifi'];
    })).toContain('許可されていない値です: "wifi"');
  });
});
