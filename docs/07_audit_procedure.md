# 07. 監査手順（セキュリティ／データ完全性／規約）

監査は「自動チェック → チェックリスト記入 → 記録保存」の3段階で行う。
AI（Claude Code）に監査を依頼するときは、本ファイルと対象チェックリストを読ませてから
「`docs/audit/<日付>_<種別>.md` を作成し、各IDを判定せよ」と指示する。

---

## 1. 監査の種類とタイミング

| 種別 | 対象チェックリスト | 実施タイミング | 記録ファイル |
|---|---|---|---|
| 規約監査（静的） | 03, 04 | コミット前（毎回）、PR 作成時 | `docs/audit/YYYYMMDD_static.md`（スクリプト出力を貼付） |
| セキュリティ監査 | 05（SEC-xx, PRV-xx, 脅威モデル） | 画面実装完了時、リリース前、依存更新時 | `docs/audit/YYYYMMDD_security.md` |
| データ完全性監査 | 06（DI-xx） | ユースケース実装完了時、保存形式変更時、リリース前 | `docs/audit/YYYYMMDD_integrity.md` |
| アーキテクチャ監査 | 01, 02 | 新規フォルダ・層をまたぐ変更時 | `docs/audit/YYYYMMDD_architecture.md` |

---

## 2. 自動チェック（静的監査スクリプト）

```bash
node scripts/audit/static-audit.mjs            # src/ を対象（既定）
node scripts/audit/static-audit.mjs src/domain # サブツリー指定
node scripts/audit/static-audit.mjs --json > docs/audit/$(date +%Y%m%d)_static.json
```

| チェック名 | 内容 | 対応ID |
|---|---|---|
| `dependency-rule` | 層間 import の方向違反（domain→infrastructure 等） | 01 §1.1 |
| `console-direct` | `console.*` の直書き（Common/logging 以外） | LG-01 |
| `jsdoc-missing` | 関数直前に `/** ... */` が無い | CM-01 |
| `file-header-missing` | ファイル先頭に `@file` が無い | CM-03 |
| `fnlog-missing` | 関数本体に `logger.fn(` / `.fn(` が無い（除外: 1〜3行の関数・`*.test.ts`） | LG-02 |
| `innerhtml` | `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `document.write` | SEC-14 |
| `eval` | `eval(` / `new Function(` | SEC-23 |
| `date-now` | `Date.now()` / `new Date(` を infrastructure/time・Common/utils 以外で使用 | DI-03 |
| `math-random` | `Math.random()` を infrastructure/random 以外で使用 | SEC-12 |
| `secret-pattern` | APIキー・パスワード・トークンらしき文字列リテラル | SEC-11 |
| `any-type` | `: any` / `as any` | 03 §1 |
| `todo-stale` | 担当・条件の無い `TODO` | 04 §1.4 |
| `long-function` | 50 行超の関数 | 03 §3 |
| `magic-radius` | `80` / `40` のリテラルが domain/exploration/constants.ts 以外にある | 01 §3-9 |

終了コード: 違反 0 件 → 0、`error` 違反あり → 1。CI ではこのコードで失敗させる。
誤検知は行末に `// audit-ignore: <チェック名> <理由>` を書くと除外される（理由必須）。

---

## 3. 手動監査の手順

1. 対象チェックリスト（05 または 06）をコピーして `docs/audit/YYYYMMDD_<種別>.md` を作る。
2. 各 ID について「確認方法」列の手段で確認し、判定（○/△/×/－）と **証跡**（ファイルパス:行、スクリーンショット名、テスト名）を記入する。
3. × と △ は末尾の「是正計画」表に、対応内容・担当・期限を書く。
4. 是正後に再監査し、同じファイルに追記する（履歴を残す）。

### 記録テンプレート

```markdown
# <種別>監査 YYYY-MM-DD
- 対象コミット: <hash>
- 監査者: <名前 or AI(Claude Code)>
- 範囲: <画面／ユースケース>

| ID | 判定 | 証跡 | 備考 |
|---|---|---|---|
| SEC-01 | ○ | src/application/usecases/exploration/VisitSpotUseCase.ts:42 | |

## 是正計画
| ID | 内容 | 担当 | 期限 | 状態 |
|---|---|---|---|---|
```

---

## 4. 動的テスト（リリース前の最低限）

| # | 試験 | 期待結果 | 関連ID |
|---|---|---|---|
| T-01 | `/demo` を本番ビルドで直接開く | 404 相当、ユースケースも拒否 | SEC-02 |
| T-02 | DevTools で localStorage のポイント値を書き換え | 表示・ランキングに反映されない／再計算で戻る | SEC-21, DI-06 |
| T-03 | 投稿本文に `<img src=x onerror=alert(1)>` | 文字列として表示 | SEC-14 |
| T-04 | 位置情報許可を拒否 | 訪問不可メッセージ、デモ位置に黙って切替えない | SEC-27 |
| T-05 | 同じ訪問操作を二重送信 | 加点は 1 回 | DI-07 |
| T-06 | 23:59→00:00 をまたいで訪問 | 「1日1回」判定が JST 暦日で正しい | DI-04 |
| T-07 | マスタ JSON の店舗を 1 件削除 | 起動時に検証エラー | DI-13, SEC-22 |
| T-08 | 旧 schemaVersion のデータで起動 | マイグレーション or 安全に拒否 | DI-15 |
| T-09 | ログビューアで `lat`/`token` を検索 | ヒットなし（マスク済） | LG-03, SEC-25 |
| T-10 | レスポンスヘッダ確認 | CSP/HSTS/nosniff/frame-ancestors あり | SEC-04, SEC-05 |

---

## 5. AI への監査依頼プロンプト例

```
docs/07_audit_procedure.md と docs/05_security_checklist.md を読み、
src/ 配下を対象にセキュリティ監査を実施してください。
1. node scripts/audit/static-audit.mjs を実行し結果を要約
2. SEC-01〜SEC-30, PRV-01〜07 を判定し、証跡（ファイル:行）を付けて
   docs/audit/<今日の日付>_security.md に記録
3. × / △ の項目は修正案（差分）を提示。修正は指示があるまで適用しない
```
