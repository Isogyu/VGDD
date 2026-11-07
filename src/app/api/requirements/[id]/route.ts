// GET /api/requirements/[id]：記録の全体。PUT：回答の保存（answers_version が今と違えば 409）。
// POST：AI の提案の取り込み（{ action: "import", suggestions }。検証に合わなければ 400）と、提案ごとの採否の更新（{ action: "decide", … }。古い版は 409）。T-043。
// ローカルの要求だけを受ける：すべてのメソッドで、記録の存在の確認・本文の読み取りより前に、要求の URL と Host が loopback でなければ 403。
// 更新（POST・PUT）は、同じ origin（なければ・違えば 403）と application/json（でなければ 415）、本文は 32,768 バイトまで（超えたら 413）。
// CORS の許可は返さない。応答には固定のエラーの符号だけを入れ、例外の本文・パス・SQL は出さない。この経路から AI は呼ばない。
// connection() は使わない：POST・PUT を export するルートは Next.js がビルド時に固めない（app-route の hasNonStaticMethods）。
import { NextResponse } from "next/server";
import { parsePostBody, parsePutBody } from "@/lib/requirements/model";
import {
  RequirementsStoreError,
  checkLoopback,
  checkUpdateHeaders,
  getRequirementsStore,
  readJsonBody,
  type GuardFailure,
  type StoreFailure,
  type StoreResult,
} from "@/lib/requirements/store";
import type { RequirementRecord } from "@/lib/requirements/model";

const NO_STORE = { "Cache-Control": "no-store" };

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function guardFail(f: GuardFailure) {
  return fail(f.status, f.error);
}

function internal(e: unknown) {
  return fail(500, e instanceof RequirementsStoreError ? "store_unavailable" : "internal_error");
}

const FAILURE_STATUS: Record<StoreFailure, [number, string]> = {
  not_found: [404, "record_not_found"],
  invalid: [400, "invalid_body"],
  version_conflict: [409, "version_conflict"],
  too_large: [413, "payload_too_large"],
};

function respond(r: StoreResult<RequirementRecord>) {
  if (r.ok) return NextResponse.json({ record: r.value }, { headers: NO_STORE });
  const [status, error] = FAILURE_STATUS[r.code];
  return fail(status, error);
}

export async function GET(req: Request, ctx: RouteContext<"/api/requirements/[id]">) {
  const denied = checkLoopback(req);
  if (denied) return guardFail(denied);
  const { id } = await ctx.params;
  try {
    const record = getRequirementsStore().get(id);
    if (record === null) return fail(404, "record_not_found");
    return NextResponse.json({ record }, { headers: NO_STORE });
  } catch (e) {
    return internal(e);
  }
}

export async function PUT(req: Request, ctx: RouteContext<"/api/requirements/[id]">) {
  const denied = checkLoopback(req) ?? checkUpdateHeaders(req);
  if (denied) return guardFail(denied);
  const body = await readJsonBody(req);
  if (!body.ok) return guardFail(body.failure);
  const parsed = parsePutBody(body.value);
  if (parsed === null) return fail(400, "invalid_body");
  const { id } = await ctx.params;
  try {
    return respond(getRequirementsStore().saveAnswers(id, parsed));
  } catch (e) {
    return internal(e);
  }
}

export async function POST(req: Request, ctx: RouteContext<"/api/requirements/[id]">) {
  const denied = checkLoopback(req) ?? checkUpdateHeaders(req);
  if (denied) return guardFail(denied);
  const body = await readJsonBody(req);
  if (!body.ok) return guardFail(body.failure);
  const parsed = parsePostBody(body.value);
  if (parsed === null) return fail(400, "invalid_body");
  const { id } = await ctx.params;
  try {
    const store = getRequirementsStore();
    if (parsed.action === "import") return respond(store.importSuggestions(id, parsed.suggestions));
    return respond(store.decide(id, parsed));
  } catch (e) {
    return internal(e);
  }
}
