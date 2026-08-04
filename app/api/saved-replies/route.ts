import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function clean(value: string | null | undefined) {
  const result = value?.trim();
  return result ? result : null;
}

function shortcut(value: string | null | undefined) {
  const result = clean(value);
  if (!result) return null;
  return (result.startsWith("/") ? result : `/${result}`).toLowerCase();
}

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get("businessId");
  const activeOnly = request.nextUrl.searchParams.get("activeOnly") === "true";

  if (!businessId) {
    return NextResponse.json(
      { success: false, error: "businessId is required." },
      { status: 400 },
    );
  }

  let query = supabaseAdmin
    .from("saved_replies")
    .select("id,business_id,title,shortcut,message_text,category,sort_index,is_active,created_at,updated_at")
    .eq("business_id", businessId)
    .order("is_active", { ascending: false })
    .order("sort_index", { ascending: true })
    .order("title", { ascending: true });

  if (activeOnly) query = query.eq("is_active", true);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to load quick replies.", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, savedReplies: data ?? [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    businessId?: string;
    title?: string;
    shortcut?: string | null;
    messageText?: string;
    category?: string | null;
    sortIndex?: number;
    isActive?: boolean;
  };

  const businessId = body.businessId?.trim();
  const title = body.title?.trim();
  const messageText = body.messageText?.trim();

  if (!businessId || !title || !messageText) {
    return NextResponse.json(
      { success: false, error: "Business, title, and message are required." },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("saved_replies")
    .insert({
      business_id: businessId,
      title,
      shortcut: shortcut(body.shortcut),
      message_text: messageText,
      category: clean(body.category),
      sort_index: Math.max(0, Math.trunc(body.sortIndex ?? 0)),
      is_active: body.isActive ?? true,
    })
    .select("id,business_id,title,shortcut,message_text,category,sort_index,is_active,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.code === "23505"
          ? "A saved reply with this title or shortcut already exists."
          : "Unable to create saved reply.",
        details: error.message,
      },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  return NextResponse.json({ success: true, savedReply: data });
}
