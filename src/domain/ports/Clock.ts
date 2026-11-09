/**
 * @file 時計ポート（domain/ports 層）
 * domain・application は現在時刻をこの IF 経由でだけ得る（DI-03）。実装: infrastructure/time の SystemClock / DemoClock。
 */
import type { Instant, LocalDate } from '@/Common/utils/date';

/** 現在時刻の供給元 */
export interface Clock {
  /** 現在の瞬間（UTC ISO 8601） */
  now(): Instant;
  /** 今日（JST 暦日）。now() と同じ瞬間の localDateOf であること */
  today(): LocalDate;
}
