# 03. コーディング規約

前提: TypeScript（`strict: true`）。フレームワーク非依存。
AI（Claude Code 等）が生成・修正するコードもすべて本規約に従う。
各関数のコメントとデバッグログの詳細は `04_comment_and_logging.md` を参照。

---

## 1. 基本方針

| # | ルール | 理由 |
|---|---|---|
| 1 | **読み手はAIと人間の両方**。意図をコメントと名前で明示する | AIが次の変更で文脈を誤読しないため |
| 2 | **1ファイル1責務・1関数1目的** | 疎結合・差分レビューの容易さ |
| 3 | **副作用は端（infrastructure）に寄せ、中心（domain）は純粋関数** | テスト容易性・デモ差し替え |
| 4 | **型で守る**。`any` 禁止、`as` キャストは境界（JSON読込）のみ | 実行時エラーの事前排除 |
| 5 | **失敗は値で返す**（`Result<T, AppError>`）。例外は「バグ」か「回復不能」のみ | 制御フローの明示 |
| 6 | **ログは必ず Common/logging 経由**。`console.*` 直書き禁止 | 監査・フィルタ・個人情報マスク |

---

## 2. 命名

| 対象 | 規則 | 例 |
|---|---|---|
| 変数・関数・メソッド | lowerCamelCase。関数は動詞始まり | `calculateDistance`, `isWithinVisitRadius` |
| 真偽値 | `is/has/can/should` 始まり | `isFaded`, `hasVisitedToday` |
| クラス・型・インターフェース・enum | PascalCase。IFに `I` 接頭辞は付けない | `Traveler`, `TravelerRepository` |
| 定数 | UPPER_SNAKE_CASE（単位をサフィックスに） | `DISCOVERY_RADIUS_M`, `FADE_START_DAYS` |
| ドメインイベント | 過去形 | `SpotVisited`, `DistrictLordChanged` |
| ユースケース | 動詞+目的語+UseCase | `VisitSpotUseCase` |
| 値オブジェクトのファクトリ | `<Type>.of()` / `<Type>.from<Source>()` | `GeoPoint.of(lat, lng)` |
| ID型 | ブランド型 | `type SpotId = Brand<string, 'SpotId'>` |
| 英語名はユビキタス言語に従う | 日本語用語と1:1対応表を `01_architecture.md` §2 に保つ | 旅人=Traveler, 地区=District, 名所=Landmark, 店舗=Shop |

- 略語禁止（`dist` → `distance`, `fac` → `spot`）。ただし `id`, `url`, `dto`, `vm` は可。
- ファイル名は主役の export 名と一致させる。

---

## 3. 関数

1. **長さ**: 30行以内を目安、最大50行。超えたら分割。
2. **引数**: 3つまで。4つ以上はオブジェクト引数（名前付き）にする。
3. **戻り値**: 必ず型注釈を書く（推論に頼らない）。失敗しうる関数は `Result<T, AppError>` または `Promise<Result<...>>`。
4. **早期リターン**: ガード節で異常系を先に返し、ネストを2段以内に抑える。
5. **純粋性**: domain 層の関数は引数のみに依存し、同じ入力で同じ出力を返す。
   時刻・位置・乱数は引数（またはポートIF）で受け取る。
6. **冪等性**: 永続化・加点などの書き込み系ユースケースは、同じ要求IDで2回呼ばれても結果が変わらないようにする（`06_data_integrity_checklist.md` DI-07）。
7. **コメント**: すべての関数に日本語のJSDocを付ける（`04_comment_and_logging.md` §1）。
8. **ログ**: すべての関数（1行の getter・純粋な算術ヘルパーを除く）に関数スコープのデバッグログを仕込む（同 §2）。

```ts
/**
 * 旅人がスポットを訪問できる距離（40m以内）にいるか判定する。
 * @param travelerPoint 旅人の現在位置
 * @param spotPoint スポットの位置
 * @returns 40m以内なら true
 * @see docs/01_architecture.md §2 探索コンテキスト
 */
export function isWithinVisitRadius(travelerPoint: GeoPoint, spotPoint: GeoPoint): boolean {
  const log = logger.fn('isWithinVisitRadius', { travelerPoint, spotPoint });
  const distance = Distance.between(travelerPoint, spotPoint);
  return log.exit(distance.meters <= VISIT_RADIUS_M);
}
```

---

## 4. 型・データ

- `interface` は「構造の契約」、`type` は「合成・ユニオン」に使う。
- `enum` より `as const` のユニオン型を優先（ツリーシェイク・JSON互換）。
- `null` と `undefined`: 「値が無い」は `undefined` に統一。`null` は外部API境界でのみ扱い、即座に変換する。
- 配列・オブジェクトは原則 `readonly`。エンティティの状態変更はメソッド経由のみ。
- 日時は **UTC の ISO 8601 文字列** で保存し、表示時に JST へ変換。domain 内部は `Date` ではなく `Instant`/`LocalDate` 値オブジェクト（`Common/utils/date.ts`）を使う。
- 金額・ポイントは整数（小数禁止）。`Points` 値オブジェクトで負値を拒否。
- 外部から来たデータ（JSON・URL・localStorage・ユーザ入力）は **境界で必ず検証**してから domain 型へ変換する（スキーマ検証またはパース関数）。

---

## 5. エラー処理

```ts
// Common/result/Result.ts
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };
```

- `AppError` は `code`（機械可読・列挙）, `message`（日本語・ユーザ向け）, `cause?`, `details?` を持つ。
- ユースケースは `Result` を返し、presentation が表示方法を決める。
- `try/catch` は infrastructure の境界（fetch, storage, JSON.parse）にのみ置き、`Result` に変換する。
- 握りつぶし禁止: `catch {}` は常に `log.error` を伴う。
- 想定外例外はグローバルハンドラ（`window.onerror`/`unhandledrejection`）で捕捉し、ログ＋ユーザへ安全なメッセージ表示。スタックトレースや内部情報を画面に出さない（OWASP A10）。

---

## 6. 非同期

- `async/await` を使い、`.then()` チェーンは使わない。
- 並列可能な処理は `Promise.all` でまとめる。
- 画面側では必ず「読込中／失敗／成功」の3状態を扱う。
- キャンセルが必要な処理（位置監視など）は `AbortSignal` を受け取る。

---

## 7. presentation 固有

- DOM操作は `textContent` / `setAttribute` / DOM API を使い、`innerHTML` への代入は禁止（XSS）。
  テンプレートが必要な場合は Common/ui のサニタイズ済みビルダーを使う。
- Canvas 描画関数は `draw<Name>(ctx, viewModel)` の純粋関数。状態・タイマーは呼び出し側で持つ。
- 画面遷移は `AppRouter` 経由のみ。`location.href` 直書き禁止。
- 文字拡大設定に対応するため、サイズは `rem` または `Common/ui/a11y/textScale` の係数を掛けた値を使う。
- タップ対象は最小 44×44px。

---

## 8. domain 固有

- import してよいのは `domain/**` と `Common/{logging,result,types,utils}` のみ。
- `fetch`, `localStorage`, `document`, `window`, `Date.now()`, `new Date()`, `Math.random()`, `setTimeout` の使用禁止（ポート経由）。
- 不変条件はコンストラクタ／ファクトリで検証し、不正な状態のインスタンスを作れないようにする。

---

## 9. テスト

- 単体テスト: domain と application は必須。`Vitest` 想定。
- テストは **仕様名を日本語** で書く: `it('40m以内なら訪問可能と判定する', ...)`。
- ポートはテスト用実装（`FixedClock`, `FakeGeoProvider`, `InMemoryRepository`）を使い、モックライブラリに頼りすぎない。
- バグ修正時は再現テストを先に追加する。

---

## 10. フォーマット・静的解析

- Prettier（2スペース、セミコロンあり、シングルクォート、`printWidth: 100`）。
- ESLint: `@typescript-eslint/recommended-type-checked` + `no-console: error` + `import/no-cycle` + 依存方向ルール（`eslint-plugin-boundaries` または `static-audit.mjs`）。
- コミット前に `npm run audit:static`（`scripts/audit/static-audit.mjs`）を通す。

---

## 11. Git

- ブランチ: `feature/<画面or機能>`, `fix/<内容>`。
- コミットメッセージ: `<種別>: <日本語要約>`（種別: feat/fix/refactor/docs/test/chore）。
- 秘密情報（パスワード・APIキー・`.env`）は絶対にコミットしない。`.gitignore` と `static-audit.mjs` の `secret-pattern` チェックで防ぐ。
- マスタデータ（`public/master/*.json`）の変更は必ずスキーマ検証を通してからコミットする。

---

## 12. AI駆動開発での作業手順（Claude Code 向け）

1. 作業前に `CLAUDE.md` → 該当する `docs/0x_*.md` を読む。
2. 変更は「どの層・どの画面フォルダに置くか」を先に決めてから書く（`02_folder_structure.md`）。
3. 関数を書いたら **日本語JSDoc と fnScope ログ** を必ず付ける。
4. 完了前に `node scripts/audit/static-audit.mjs` を実行し、違反ゼロを確認する。
5. セキュリティ／データ完全性に関わる変更（入力処理・永続化・加点・認証）は、
   `05`/`06` のチェックリスト該当IDをコミットメッセージまたはPR本文に記載する。
