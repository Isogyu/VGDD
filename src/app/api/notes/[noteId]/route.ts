// DELETE /api/notes/[noteId]?userId=…：本人のメモを削除する（M2 の提案で採用。07 §3「本人が削除できる」）
// 本人のものでなければ 404（存在を知らせない）
import { NextResponse } from "next/server";
import { getUser } from "@/lib/db";
import { deleteNote } from "@/lib/sessions";

export async function DELETE(req: Request, ctx: RouteContext<"/api/notes/[noteId]">) {
  const { noteId } = await ctx.params;
  const id = Number(noteId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  if (!deleteNote(id, userId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, deleted: id });
}
