# 04. 関数コメント（日本語）とデバッグログの規約

AI駆動開発では「次にコードを読むのはAI」である。
各関数の **意図・前提・副作用** を日本語で残し、**関数単位で実行の痕跡（ログ）** を追えるようにする。
雛形: `docs/templates/function_template.ts`, `docs/templates/logger.ts`

---

## 1. 関数コメント（JSDoc・日本語）

### 1.1 必須項目

すべての `function` / メソッド / export されたアロー関数に、直前に JSDoc を書く。

```ts
/**
 * <1行目: この関数が「何を」するか（体言止めではなく動詞で）>
 *
 * <2行目以降（任意）: なぜ必要か、ビジネスルール、前提条件、注意点>
 *
 * @param <名前> <意味・単位・制約（例: メートル、0以上）>
 * @returns <戻り値の意味。Result の場合は失敗コードも列挙>
 * @throws <投げる場合のみ。原則 Result を返すので稀>
 * @sideEffect <永続化・イベント発行・外部呼び出しがあれば必ず記載>
 * @see <関連ドキュメント・チェックリストID（例: docs/06_data_integrity_checklist.md DI-07）>
 */
```

### 1.2 書き方のルール

| ルール | 良い例 | 悪い例 |
|---|---|---|
| 1行目は「何をするか」 | `旅人の現在地から80m以内の未発見スポットを返す。` | `スポット取得` |
| 業務ルールの数値は定数名も書く | `40m（VISIT_RADIUS_M）以内なら訪問成立。` | `近かったら訪問。` |
| 副作用は `@sideEffect` に明示 | `@sideEffect TravelerRepository.save を呼ぶ。SpotVisited を発行。` | （記載なし） |
| 失敗条件を列挙 | `@returns 失敗時: OUT_OF_RANGE / ALREADY_VISITED_TODAY` | `@returns 結果` |
| コードの繰り返しは書かない | `色あせは最終訪問日からの経過日数で段階的に進む（FadePolicy 参照）。` | `i を 1 増やす。` |
| 英語識別子はそのまま、説明は日本語 | `GeoPoint を受け取り Distance を返す。` | 全文英語 |

### 1.3 ファイル先頭コメント

各ファイルの先頭に、役割と層を1〜3行で書く。

```ts
/**
 * @file スポット訪問ユースケース（application 層）
 * 40m判定→加点→イベント発行までを1トランザクションとして扱う。
 */
```

### 1.4 TODO / FIXME

`// TODO(<担当 or AI>): <内容> <期限 or 条件>` の形式。放置TODOは監査で検出する。

---

## 2. 関数単位デバッグログ

### 2.1 目的

- 画面操作 → ユースケース → ドメイン → インフラ の **呼び出し経路を関数名で追える** こと。
- デモ・発表中に不具合が出ても、**ログビューア（デモメニュー）** でその場で原因箇所を特定できること。
- AIが修正する際に、ログを貼り付けるだけで文脈が伝わること。

### 2.2 ロガーの構造（`Common/logging/logger.ts`）

```ts
const logger = createLogger('application/VisitSpotUseCase');   // ← モジュール名（層/ファイル名）

async execute(input: VisitSpotInput): Promise<Result<VisitSpotOutput>> {
  const log = logger.fn('execute', { travelerId: input.travelerId, spotId: input.spotId }); // enter
  ...
  log.debug('距離判定', { meters: distance.meters });       // 途中経過
  ...
  if (!within) return log.fail(AppError.of('OUT_OF_RANGE', 'スポットから離れすぎています')); // 失敗で exit
  ...
  return log.exit(ok(output));                              // 成功で exit（経過時間も記録）
}
```

出力例（構造化・1行1イベント）:

```
2026-11-09T01:23:45.678Z DEBUG [application/VisitSpotUseCase.execute] ENTER {"travelerId":"t_01","spotId":"f_12"} cid=7f3a
2026-11-09T01:23:45.690Z DEBUG [domain/DiscoveryRule.isWithinVisitRadius] ENTER {"meters":37.2} cid=7f3a
2026-11-09T01:23:45.691Z DEBUG [domain/DiscoveryRule.isWithinVisitRadius] EXIT  true (0.3ms) cid=7f3a
2026-11-09T01:23:45.720Z INFO  [application/VisitSpotUseCase.execute] EXIT  {"ok":true} (42ms) cid=7f3a
```

### 2.3 ログレベル

| レベル | 用途 | 本番 |
|---|---|---|
| `debug` | 関数 ENTER/EXIT、分岐の根拠、計算途中値 | 出力しない（バッファにも保持しない） |
| `info` | ユースケース完了、画面遷移、イベント発行 | 保持（バッファ） |
| `warn` | 回復可能な異常（位置情報取得失敗→デモ位置にフォールバック等） | 保持・送信対象 |
| `error` | 失敗 Result・捕捉例外 | 保持・送信対象 |

### 2.4 必須ルール

1. `console.*` の直接呼び出し禁止（`Common/logging` 内部のみ許可）。
2. すべての関数で `logger.fn(name, args)` を先頭で呼び、`log.exit()` / `log.fail()` で返す。
   例外: 1行の getter、純粋な算術ヘルパー、描画ループ内で毎フレーム呼ばれる関数（→ 呼び出し側でまとめてログ）。
3. `cid`（相関ID）は **1ユーザ操作ごと** に presentation 層で発行し、以降の呼び出しに自動伝播させる。
4. **個人情報・秘密情報をログに書かない**（OWASP Logging Cheat Sheet 準拠）。
   - 禁止: 生の位置座標（→ スポットとの距離 or 100m丸めに変換）、トークン、パスワード、クーポンコード、メール、氏名。
   - ロガーは `maskKeys`（`lat`,`lng`,`token`,`password`,`code`,`email`）を既定でマスクする。
5. ログ注入対策: 文字列は CR/LF・制御文字を除去し、1項目 500 文字で切り詰める（ロガー内で実施）。
6. バッファはリングバッファ（既定 2,000 件）。`LogViewer` から **フィルタ（モジュール名／レベル／cid）・コピー・JSONダウンロード** ができること。
7. 有効化: `localStorage['nnishi.debug'] = '1'` または URL `?debug=1`。本番ビルドでは `debug` を無効化し、`LogViewer` はデモメニューからのみ到達可能にする。

### 2.5 ログ設計とレイヤ

| 層 | 記録する内容 |
|---|---|
| presentation | 操作イベント（タップ対象・画面名）、遷移、描画の例外。描画フレームは記録しない |
| application | ユースケース ENTER/EXIT、Result の ok/失敗コード、発行イベント名 |
| domain | ルール判定の根拠（距離・経過日数・判定結果）。エンティティ全体は出さない |
| infrastructure | 外部呼び出し（API/Storage）の種類・所要時間・成否。ペイロード本体は出さない |

---

## 3. 監査観点（07_audit_procedure.md から参照）

| ID | 確認内容 | 確認方法 |
|---|---|---|
| CM-01 | すべての関数に日本語 JSDoc がある | `static-audit.mjs` の `jsdoc-missing` |
| CM-02 | 副作用のある関数に `@sideEffect` がある | 目視（ユースケース・リポジトリ） |
| CM-03 | ファイル先頭に `@file` がある | `static-audit.mjs` の `file-header-missing` |
| LG-01 | `console.*` 直書きがない | `static-audit.mjs` の `console-direct` |
| LG-02 | 関数に `logger.fn` がある | `static-audit.mjs` の `fnlog-missing` |
| LG-03 | マスク対象キーが平文で出ていない | ログビューアで検索（`lat`,`token` 等） |
| LG-04 | 本番ビルドで debug が無効 | ビルド成果物で `isDebugEnabled` の既定値確認 |
