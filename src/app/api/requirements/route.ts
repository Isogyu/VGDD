// GET /api/requirements：要件の記録の一覧（id・題・時刻・ready だけ）。POST /api/requirements：題だけで記録を作る。T-043。
// ローカルの要求だけを受ける：DB と本文に触れる前に、要求の URL と Host が loopback でなければ 403。
// 更新（POST）は、同じ origin（なければ・違えば 403）と application/json（でなければ 415）、本文は 32,768 バイトまで（超えたら 413）。
// CORS の許可は返さない。応答には固定のエラーの符号だけを入れ、例外の本文・パス・SQL は出さない。
// connection() は使わない：POST を export するルートは Next.js がビルド時に固めない（app-route の hasNonStaticMethods）。
// また connection() は要求の外（試験で Request を直接渡すとき）では例外になる。
import { NextResponse } from "next/server";
import { parseCreateBody } from "@/lib/requirements/model";
import {
  RequirementsStoreError,
  checkLoopback,
  checkUpdateHeaders,
  getRequirementsStore,
  readJsonBody,
  type GuardFailure,
} from "@/lib/requirements/store";

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

export async function GET(req: Request) {
  const denied = checkLoopback(req);
  if (denied) return guardFail(denied);
  try {
    return NextResponse.json({ records: getRequirementsStore().list() }, { headers: NO_STORE });
  } catch (e) {
    return internal(e);
  }
}

export async function POST(req: Request) {
  const denied = checkLoopback(req) ?? checkUpdateHeaders(req);
  if (denied) return guardFail(denied);
  const body = await readJsonBody(req);
  if (!body.ok) return guardFail(body.failure);
  const parsed = parseCreateBody(body.value);
  if (parsed === null) return fail(400, "invalid_body");
  try {
    const record = getRequirementsStore().create(parsed.title);
    return NextResponse.json({ record }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return internal(e);
  }
}
