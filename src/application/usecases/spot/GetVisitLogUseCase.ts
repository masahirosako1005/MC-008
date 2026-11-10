/**
 * @file 記録（訪問の年表と思い出）を返すユースケース（application 層・読取系）
 * 2026-11-10 ユーザー指示「図鑑/記録の機能に。いつ行ったか、過去の写真との紐づけ、思い出などを回想できるように」。
 * 訪問記録を新しい順に並べ、スポットの名前・地区・「このスポットで何回目」と、その回に付けた思い出（自分の写真・メモ）を返す。基準 C。
 * 訪問記録に無い思い出（シードの作り直しなどで浮いたもの）は返さない。座標は返さない（PRV-03）。達成率は返さない。書込みはしない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { dayOfWeekOf, formatJpTime, monthKeyOf, seasonOf } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { UseCase } from '@/application/AppServices';
import type { VisitLogDto, VisitLogEntryDto } from '@/application/dto/VisitLogDto';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import { MEMORY_NOTE_MAX, MEMORY_PHOTO_LIMIT, MEMORY_PHOTO_MAX_CHARS } from '@/application/ports/VisitMemoryRepository';
import type { VisitMemory, VisitMemoryRepository } from '@/application/ports/VisitMemoryRepository';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import type { VisitRecord } from '@/domain/exploration/VisitRecord';
import { sortVisitsChronologically } from '@/domain/reward/VisitChronology';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

const logger = createLogger('application/usecases/spot/GetVisitLogUseCase');

/** 曜日の1文字（0=日曜） */
const WEEKDAYS_JA = '日月火水木金土';

/** GetVisitLogUseCase の依存 */
export interface GetVisitLogDeps {
  readonly session: SessionRepository;
  readonly travelers: TravelerRepository;
  readonly spots: SpotRepository;
  readonly memories: VisitMemoryRepository;
}

/**
 * 思い出の引き当てキー（スポット＋暦日。同じスポットは1日1件＝DI-08）。
 * @param spotId スポットID
 * @param localDate JST 暦日
 * @returns 'spotId@YYYY-MM-DD'
 */
export function memoryKeyOf(spotId: string, localDate: string): string { // audit-ignore: fnlog-missing 訪問ごとに呼ぶ1行のキー組み立て
  return `${spotId}@${localDate}`;
}

/**
 * 年表に出す日付（'11/2（月）'。年は月の見出しに出すので省く）。
 * @param date JST 暦日
 * @returns 'M/D（曜）'
 */
export function shortDateLabel(date: LocalDate): string {
  const log = logger.fn('shortDateLabel', { date });
  return log.exit(`${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${WEEKDAYS_JA.charAt(dayOfWeekOf(date))}）`);
}

/**
 * 月の見出し（'2026年11月'）。
 * @param date JST 暦日
 * @returns 'YYYY年M月'
 */
export function monthLabelOf(date: LocalDate): string {
  const log = logger.fn('monthLabelOf', { date });
  return log.exit(`${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月`);
}

/**
 * 訪問1件を記録の1件にする（マスタに無いスポットは undefined）。
 * @param visit 訪問記録
 * @param nth このスポットで何回目か
 * @param spots マスタ参照
 * @param memory その回の思い出（無ければ undefined）
 * @returns VisitLogEntryDto（凍結済み）
 */
function toEntry(visit: VisitRecord, nth: number, spots: SpotRepository, memory: VisitMemory | undefined): VisitLogEntryDto | undefined {
  const log = logger.fn('toEntry', { spotId: visit.spotId, localDate: visit.localDate, nth, hasMemory: memory !== undefined });
  const spot = spots.findSpot(visit.spotId);
  if (spot === undefined) return log.exit(undefined, 'マスタに無いスポット');
  const district = spots.findDistrict(spot.districtId);
  return log.exit(
    Object.freeze({
      spotId: spot.id, spotName: spot.name, kind: spot.kind, category: spot.category,
      districtId: spot.districtId, districtName: district?.shortName ?? '', districtColor: district?.color ?? '',
      localDate: visit.localDate, dateLabel: shortDateLabel(visit.localDate),
      monthKey: monthKeyOf(visit.localDate), monthLabel: monthLabelOf(visit.localDate),
      time: formatJpTime(visit.visitedAt), nth, season: seasonOf(visit.localDate),
      ...(memory?.note === undefined ? {} : { note: memory.note }),
      ...(memory?.photo === undefined ? {} : { photo: memory.photo }),
    }),
  );
}

/**
 * 訪問記録と思い出から、新しい順の記録を作る。
 * @param visits 旅人の全訪問記録
 * @param memories 旅人の思い出
 * @param spots マスタ参照
 * @returns 記録の一覧（新しい順・凍結済み）
 */
export function visitLogEntriesOf(visits: readonly VisitRecord[], memories: readonly VisitMemory[], spots: SpotRepository): readonly VisitLogEntryDto[] {
  const log = logger.fn('visitLogEntriesOf', { visits: visits.length, memories: memories.length });
  const byKey = new Map(memories.map((m) => [memoryKeyOf(m.spotId, m.localDate), m]));
  const counts = new Map<string, number>();
  const entries: VisitLogEntryDto[] = [];
  for (const visit of sortVisitsChronologically(visits)) {
    const nth = (counts.get(visit.spotId) ?? 0) + 1;
    counts.set(visit.spotId, nth);
    const entry = toEntry(visit, nth, spots, byKey.get(memoryKeyOf(visit.spotId, visit.localDate)));
    if (entry !== undefined) entries.push(entry);
  }
  return log.exit(Object.freeze(entries.reverse()));
}

/** 記録を返す */
export class GetVisitLogUseCase implements UseCase<void, VisitLogDto> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人リポジトリ・マスタ・思い出のリポジトリ
   */
  constructor(private readonly deps: GetVisitLogDeps) {}

  /**
   * アクティブな旅人の記録（訪問の年表と思い出）を返す。
   * @returns 成功: VisitLogDto（凍結済み）。失敗: TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect セッション・旅人・思い出のリポジトリを読む（書込みはしない）
   */
  async execute(): Promise<Result<VisitLogDto>> {
    const log = logger.fn('execute');
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    const memories = await this.deps.memories.list(traveler.value.id);
    if (!memories.ok) return log.fail(memories);
    const entries = visitLogEntriesOf(traveler.value.visits, memories.value, this.deps.spots);
    const dto: VisitLogDto = Object.freeze({
      entries,
      photoCount: memories.value.filter((m) => m.photo !== undefined).length,
      photoLimit: MEMORY_PHOTO_LIMIT,
      noteMax: MEMORY_NOTE_MAX,
      photoMaxChars: MEMORY_PHOTO_MAX_CHARS,
    });
    log.debug('記録', { entries: entries.length, photos: dto.photoCount });
    return log.exit(ok(dto));
  }
}
