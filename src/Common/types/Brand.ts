/**
 * @file ブランド型（Common 層）
 * 同じ string でも SpotId と DistrictId を取り違えないよう、型に印（__brand）を付ける。
 * ブランド型の値は parseXxx などの検証関数を通してだけ作る（DI-01）。
 */

/** T に印 B を付けた型。実行時の値は T のまま */
export type Brand<T, B extends string> = T & { readonly __brand: B };
