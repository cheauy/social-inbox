import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Context = { params: Promise<{ savedReplyId: string }> };

function clean(value: string | null | undefined) {
  const result = value?.trim();
  return result ? result : null;
}

function shortcut(value: string | null | undefined) {
  const result = clean(value);
  if (!result) return null;
  return (result.startsWith("/") ? result : `/${result}`).toLowerCase();
}

export async function PATCH(request: NextRequest, context: Context) {
  const { savedReplyId } = await context.params;
  const body = await request.json() as {
    title?: string;
    shortcut?: string | null;
    messageText?: string;
    category?: string | null;
    sortIndex?: number;
    isActive?: boolean;
  };

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.title !== undefined) updates.title = body.title.trim();
  if (body.shortcut !== undefined) updates.shortcut = shortcut(body.shortcut);
  if (body.messageText !== undefined) updates.message_text = body.messageText.trim();
  if (body.category !== undefined) updates.category = clean(body.category);
  if (body.sortIndex !== undefined) updates.sort_index = Math.max(0, Math.trunc(body.sortIndex));
  if (body.isActive !== undefined) updates.is_active = body.isActive;

  const { data, error } = await supabaseAdmin
    .from("saved_replies")
    .update(updates)
    .eq("id", savedReplyId)
    .select("id,business_id,title,shortcut,message_text,category,sort_index,is_active,created_at,updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to update saved reply.", details: error.message },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { success: false, error: "Saved reply was not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true, savedReply: data });
}

export async function DELETE(_request: NextRequest, context: Context) {
  const { savedReplyId } = await context.params;
  const { error } = await supabaseAdmin
    .from("saved_replies")
    .delete()
    .eq("id", savedReplyId);

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to delete saved reply.", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
