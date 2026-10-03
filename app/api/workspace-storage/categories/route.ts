import { NextRequest, NextResponse } from "next/server";

import { getWorkspaceStorageAccess } from "@/lib/storage/workspace-storage-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  action?: "add" | "edit" | "delete";
  categoryId?: string;
  name?: string;
};

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function categoryName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

export async function POST(request: NextRequest) {
  const auth = await getWorkspaceStorageAccess();
  if (!auth.success) return fail(auth.error, auth.status);
  if (!(await memberHasPermission(auth.member, "tags_quick_replies", "manage"))) {
    return fail("You do not have permission to manage Storage categories.", 403);
  }

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return fail("Invalid JSON request.", 400);
  }

  if (body.action === "add") {
    const name = categoryName(body.name);
    if (!name) return fail("A category name is required.", 400);
    const { data, error } = await supabaseAdmin
      .from("workspace_file_categories")
      .insert({ business_id: auth.member.business_id, name })
      .select("id,name,created_at,updated_at")
      .single();
    if (error?.code === "23505") return fail(`"${name}" already exists.`, 409);
    if (error || !data) return fail("Unable to add that category.", 500);
    return NextResponse.json({ success: true, category: data });
  }

  const categoryId = body.categoryId?.trim() ?? "";
  if (!categoryId) return fail("categoryId is required.", 400);

  if (body.action === "edit") {
    const name = categoryName(body.name);
    if (!name) return fail("A category name is required.", 400);
    const { data, error } = await supabaseAdmin
      .from("workspace_file_categories")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", categoryId)
      .eq("business_id", auth.member.business_id)
      .select("id,name,created_at,updated_at")
      .maybeSingle();
    if (error?.code === "23505") return fail(`"${name}" already exists.`, 409);
    if (error) return fail("Unable to rename that category.", 500);
    if (!data) return fail("Storage category was not found.", 404);
    return NextResponse.json({ success: true, category: data });
  }

  if (body.action === "delete") {
    const { data, error } = await supabaseAdmin
      .from("workspace_file_categories")
      .delete()
      .eq("id", categoryId)
      .eq("business_id", auth.member.business_id)
      .select("id")
      .maybeSingle();
    if (error) return fail("Unable to delete that category.", 500);
    if (!data) return fail("Storage category was not found.", 404);
    return NextResponse.json({ success: true });
  }

  return fail("Unsupported Storage category action.", 400);
}
