// 要件確認（/requirements、T-043）の固定の質問。LLM から独立したデータで、画面・保存・下書きの文の全部がこの一覧を使う。
// 文は業務の言葉で書く（コードの言葉を使わない）。id と required は票の A1 のとおりに固定する。

export type Stage = "problem" | "behavior" | "constraints" | "review";

export interface Question {
  id: string;
  stage: Stage;
  text: string;
  required: boolean;
}

/** 段階の順と見出し */
export const STAGES: readonly { id: Stage; label: string }[] = [
  { id: "problem", label: "課題" },
  { id: "behavior", label: "動作" },
  { id: "constraints", label: "制約" },
  { id: "review", label: "確認" },
];

export const QUESTIONS: readonly Question[] = [
  { id: "problem.who", stage: "problem", text: "誰が困っていますか（担当・部署・立場）", required: true },
  { id: "problem.when", stage: "problem", text: "いつ・どの場面で困りますか", required: false },
  { id: "problem.goal", stage: "problem", text: "どうなればよいですか（困りごとが解けた状態）", required: true },
  { id: "behavior.input", stage: "behavior", text: "何を入れますか・何を渡しますか（入力）", required: false },
  {
    id: "behavior.example",
    stage: "behavior",
    text: "正しい結果の具体例を1つ書いてください（これを入れたら、こうなる）",
    required: true,
  },
  {
    id: "behavior.counter",
    stage: "behavior",
    text: "こうなってはいけない、という例はありますか（反例）",
    required: false,
  },
  { id: "behavior.error", stage: "behavior", text: "うまくいかなかったとき、どうなってほしいですか", required: false },
  {
    id: "constraints.data",
    stage: "constraints",
    text: "扱うデータの種類は何ですか（取引先の名前・金額・個人の情報など）",
    required: false,
  },
  {
    id: "constraints.external",
    stage: "constraints",
    text: "社外のサービスや相手に、データを送ることはありますか",
    required: false,
  },
  {
    id: "constraints.out_of_scope",
    stage: "constraints",
    text: "今回はやらないこと（対象外）は何ですか",
    required: true,
  },
  { id: "review.notes", stage: "review", text: "ほかに、作る人に伝えておきたいことはありますか", required: false },
];

const QUESTION_BY_ID: ReadonlyMap<string, Question> = new Map(QUESTIONS.map((q) => [q.id, q]));

export function findQuestion(id: string): Question | undefined {
  return QUESTION_BY_ID.get(id);
}

export function isQuestionId(id: string): boolean {
  return QUESTION_BY_ID.has(id);
}
