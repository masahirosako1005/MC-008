/**
 * @file お店のアンケート（presentation/screens/Spot 層。お店のスポット詳細から開く）
 * スポット詳細に「アンケート」ボタンを置き、押すとモーダルで設問（満足度・きっかけ・よかった・気になった・また来たい・ひとこと）を出す。
 * 設問と選択肢は application/usecases/survey/shopSurvey の（仮）の定義をそのまま並べる。回答は匿名で、店舗CMS の「アンケート」に届く。
 * 文字は設問の名前だけにする（説明文を足さない）。必須（満足度・きっかけ・また来たい）がそろうまで「送る」は押せない。
 * 送ったあとは、この画面を開いている間ボタンを「回答済み」にする。答えても EXP は付かない（CLAUDE.md 5）。
 * 答えられるのは訪問（クエスト達成）したお店だけ。まだのお店では、押せないボタンに「クエスト達成後」と出す。
 */
import '@/presentation/screens/Spot/SurveyForm.css';
import { createLogger } from '@/Common/logging/logger';
import { createButton, setButtonDisabled, setButtonLabel } from '@/Common/ui/Button';
import { createChip, setChipSelected } from '@/Common/ui/Chip';
import { h } from '@/Common/ui/dom';
import { openModal } from '@/Common/ui/Modal';
import {
  SURVEY_COMMENT_MAX,
  SURVEY_CONCERNS,
  SURVEY_GOODS,
  SURVEY_REVISITS,
  SURVEY_SATISFACTION_MAX,
  SURVEY_SATISFACTION_MIN,
  SURVEY_TRIGGERS,
} from '@/application/usecases/survey/shopSurvey';
import type { SurveyAnswers, SurveyChoice } from '@/application/usecases/survey/shopSurvey';

const logger = createLogger('presentation/screens/Spot/SurveyForm');

/** 入力中の答え（必須の項目は選ぶまで undefined） */
interface SurveyDraft {
  satisfaction: number | undefined;
  trigger: string | undefined;
  readonly goods: Set<string>;
  readonly concerns: Set<string>;
  revisit: string | undefined;
  comment: string;
}

/**
 * 入力中の答えを、送れる形にする。
 * @param draft 入力中の答え
 * @returns 答え（必須の項目がそろっていなければ undefined）
 */
export function answersOf(draft: { readonly satisfaction: number | undefined; readonly trigger: string | undefined; readonly goods: ReadonlySet<string>; readonly concerns: ReadonlySet<string>; readonly revisit: string | undefined; readonly comment: string }): SurveyAnswers | undefined {
  const log = logger.fn('answersOf', { satisfaction: draft.satisfaction, trigger: draft.trigger, revisit: draft.revisit });
  if (draft.satisfaction === undefined || draft.trigger === undefined || draft.revisit === undefined) return log.exit(undefined, 'incomplete');
  const comment = draft.comment.trim();
  return log.exit({
    satisfaction: draft.satisfaction, trigger: draft.trigger, goods: [...draft.goods], concerns: [...draft.concerns], revisit: draft.revisit,
    ...(comment === '' ? {} : { comment }),
  });
}

/**
 * 設問1つ（名前と中身）を作る。
 * @param label 設問の名前
 * @param body 中身
 * @returns 要素
 */
function question(label: string, body: HTMLElement): HTMLElement { // audit-ignore: fnlog-missing 設問ごとに呼ぶ小さな組み立て（surveyFormBody で記録する）
  return h('div', { class: 'survey__q', attrs: { role: 'group', 'aria-label': label } }, [h('p', { class: 'survey__label', text: label }), body]);
}

/**
 * 満足度（1〜5 のどれか1つ）の並びを作る。
 * @param draft 入力中の答え
 * @param onChange 変わったときに呼ぶ
 * @returns 要素
 */
function satisfactionScale(draft: SurveyDraft, onChange: () => void): HTMLElement {
  const log = logger.fn('satisfactionScale');
  const buttons: HTMLButtonElement[] = [];
  for (let level = SURVEY_SATISFACTION_MIN; level <= SURVEY_SATISFACTION_MAX; level += 1) {
    const button = h('button', { class: 'survey__level', attrs: { type: 'button', 'aria-pressed': 'false', 'aria-label': `満足度 ${level}`, 'data-testid': `survey-level-${level}` }, text: String(level) });
    button.addEventListener('click', () => {
      draft.satisfaction = level;
      for (const other of buttons) other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
      onChange();
    });
    buttons.push(button);
  }
  return log.exit(h('div', { class: 'survey__scale' }, [
    h('div', { class: 'survey__levels' }, buttons),
    h('div', { class: 'survey__ends', attrs: { 'aria-hidden': 'true' } }, [h('span', { text: '不満' }), h('span', { text: '満足' })]),
  ]));
}

/**
 * 選択肢のチップの並びを作る（single なら1つだけ選べる）。
 * @param name 設問の識別名（テスト用 ID に使う）
 * @param choices 選択肢
 * @param opts single: 1つだけ選ぶか／onPick: 選び直したあとに、選ばれている key の一覧で呼ぶ
 * @returns 要素
 */
function choiceChips(name: string, choices: readonly SurveyChoice[], opts: { readonly single: boolean; readonly onPick: (keys: readonly string[]) => void }): HTMLElement {
  const log = logger.fn('choiceChips', { name, single: opts.single });
  const picked = new Set<string>();
  const chips = new Map<string, HTMLButtonElement>();
  for (const choice of choices) {
    chips.set(choice.key, createChip({
      label: choice.label,
      testId: `survey-${name}-${choice.key}`,
      onToggle: (selected): void => {
        if (opts.single) {
          picked.clear();
          for (const [key, chip] of chips) setChipSelected(chip, selected && key === choice.key);
        }
        if (selected) picked.add(choice.key);
        else picked.delete(choice.key);
        opts.onPick([...picked]);
      },
    }));
  }
  return log.exit(h('div', { class: 'survey__chips' }, [...chips.values()]));
}

/**
 * アンケートの中身（設問の並び）を作る。
 * @param draft 入力中の答え（選ぶたびに書き換える）
 * @param onChange 変わったときに呼ぶ
 * @returns 要素
 */
function surveyFormBody(draft: SurveyDraft, onChange: () => void): HTMLElement {
  const log = logger.fn('surveyFormBody');
  /** 複数選択の答えを入れ替える */
  const replace = (target: Set<string>, keys: readonly string[]): void => { // audit-ignore: fnlog-missing チップを押すたびに呼ぶ小さな入れ替え
    target.clear();
    for (const key of keys) target.add(key);
  };
  const comment = h('textarea', { class: 'survey__comment', attrs: { rows: 2, maxlength: SURVEY_COMMENT_MAX, 'aria-label': 'ひとこと', 'data-testid': 'survey-comment' } });
  comment.addEventListener('input', () => { draft.comment = comment.value; });
  return log.exit(h('div', { class: 'survey', attrs: { 'data-testid': 'survey-form' } }, [
    question('満足度', satisfactionScale(draft, onChange)),
    question('きっかけ', choiceChips('trigger', SURVEY_TRIGGERS, { single: true, onPick: (keys) => { draft.trigger = keys[0]; onChange(); } })),
    question('よかった', choiceChips('good', SURVEY_GOODS, { single: false, onPick: (keys) => replace(draft.goods, keys) })),
    question('気になった', choiceChips('concern', SURVEY_CONCERNS, { single: false, onPick: (keys) => replace(draft.concerns, keys) })),
    question('また来たい？', choiceChips('revisit', SURVEY_REVISITS, { single: true, onPick: (keys) => { draft.revisit = keys[0]; onChange(); } })),
    question('ひとこと', comment),
  ]));
}

/**
 * アンケートのモーダルを開く。
 * @param onSubmit 「送る」が押されたときに、答えを渡して呼ぶ
 * @sideEffect モーダルを開く
 */
export function openSurveyForm(onSubmit: (answers: SurveyAnswers) => void): void {
  const log = logger.fn('openSurveyForm');
  const draft: SurveyDraft = { satisfaction: undefined, trigger: undefined, goods: new Set(), concerns: new Set(), revisit: undefined, comment: '' };
  /** 必須の項目がそろったら「送る」を押せるようにする */
  const sync = (): void => { // audit-ignore: fnlog-missing 選ぶたびに呼ぶ見た目の切り替え
    const send = modal.element.querySelector<HTMLButtonElement>('[data-testid="survey-send"]');
    if (send !== null) setButtonDisabled(send, answersOf(draft) === undefined);
  };
  const modal = openModal({
    title: 'アンケート',
    body: surveyFormBody(draft, sync),
    testId: 'survey-modal',
    actions: [
      { label: 'やめる', variant: 'secondary', testId: 'survey-cancel', onClick: (): void => undefined },
      {
        label: '送る', variant: 'primary', testId: 'survey-send',
        onClick: (): void => {
          const answers = answersOf(draft);
          if (answers !== undefined) onSubmit(answers);
        },
      },
    ],
  });
  sync();
  log.exit(undefined);
}

/**
 * スポット詳細に置く「アンケート」ボタンを作る。
 * @param visited このお店を訪問したことがあるか（無ければ押せない）
 * @param onSubmit 答えを送る処理（成功したら true を返す）
 * @returns 要素
 */
export function createSurveyButton(visited: boolean, onSubmit: (answers: SurveyAnswers) => Promise<boolean>): HTMLElement {
  const log = logger.fn('createSurveyButton', { visited });
  const button = createButton({
    label: visited ? 'アンケート' : 'アンケート（クエスト達成後）',
    disabled: !visited,
    variant: 'secondary',
    size: 'large',
    testId: 'survey-open',
    onClick: (): void => openSurveyForm((answers) => {
      void onSubmit(answers).then((sent) => {
        if (!sent) return;
        setButtonLabel(button, '回答済み');
        setButtonDisabled(button, true);
      });
    }),
  });
  return log.exit(h('div', { class: 'spot-survey' }, [button]));
}
