/**
 * @file ID 発行ポート（domain/ports 層）
 * ID は推測されにくい乱数で作る（SEC-12）。実装: infrastructure/random/CryptoIdGenerator。
 */

/** ID の発行元 */
export interface IdGenerator {
  /**
   * 接頭辞つきの新しい ID を返す。例: newId('ev') → 'ev_' + 英数字（EventId の正規表現 ^ev_[0-9a-z]{4,64}$ を満たすこと）。
   * 接頭辞は英小文字。戻り値は呼び出し側で parseXxx により検証してブランド型にする。
   */
  newId(prefix: string): string;
}
