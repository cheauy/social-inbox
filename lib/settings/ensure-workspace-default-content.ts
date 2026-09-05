import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Hidden per-workspace seed markers.
 *
 * TENH keeps these rows inactive and filters them from every user-facing
 * tags / quick-replies query. The markers let older workspaces receive the
 * starter content once without recreating deleted defaults later.
 */
export const DEFAULT_TAG_SEED_MARKER =
  "__TENH_DEFAULT_TAGS_SEEDED_V1__";

export const DEFAULT_SAVED_REPLY_SEED_MARKER =
  "__TENH_DEFAULT_QUICK_REPLIES_SEEDED_V1__";

const DEFAULT_TAGS = [
  {
    name: "New Lead",
    color: "#3B82F6",
    sort_index: 10,
    description: "New customer or sales opportunity.",
    is_active: true,
  },
  {
    name: "VIP",
    color: "#8B5CF6",
    sort_index: 20,
    description: "Priority customer who may need extra attention.",
    is_active: true,
  },
  {
    name: "Follow Up",
    color: "#F59E0B",
    sort_index: 30,
    description: "Conversation that needs a follow-up.",
    is_active: true,
  },
  {
    name: "Urgent",
    color: "#EF4444",
    sort_index: 40,
    description: "Time-sensitive customer request.",
    is_active: true,
  },
] as const;

const DEFAULT_SAVED_REPLIES = [
  {
    title: "Greeting",
    shortcut: "/hello",
    message_text:
      "Hi! Thanks for contacting us. How can we help you today?",
    category: "General",
    sort_index: 10,
    is_active: true,
  },
  {
    title: "Thank you",
    shortcut: "/thanks",
    message_text:
      "Thank you for your message. We’re happy to help.",
    category: "General",
    sort_index: 20,
    is_active: true,
  },
  {
    title: "Follow up",
    shortcut: "/followup",
    message_text:
      "Just following up on your message. Please let us know if you still need help.",
    category: "Follow up",
    sort_index: 30,
    is_active: true,
  },
  {
    title: "Closing",
    shortcut: "/close",
    message_text:
      "Thanks for contacting us. If you need anything else, just send us a message.",
    category: "General",
    sort_index: 40,
    is_active: true,
  },
] as const;

/*
 * The categories a workspace starts with.
 *
 * Sales is here because the placeholder in the form has always suggested it,
 * and a workspace with one category is a workspace where nobody files anything.
 * Ten apart so a category can be dragged between two without renumbering the
 * rest.
 */
const DEFAULT_SAVED_REPLY_CATEGORIES = [
  { name: "General", sort_index: 10 },
  { name: "Sales", sort_index: 20 },
  { name: "Follow up", sort_index: 30 },
] as const;

/*
 * Tops up rather than replaces. An existing workspace keeps the categories it
 * has -- including any the migration adopted from replies already filed -- and
 * only gains the defaults it is missing. Matching is case-insensitive, so a
 * workspace that already has "sales" does not end up with two.
 */
async function ensureDefaultSavedReplyCategories(
  businessId: string,
) {
  const { data: existingRows, error: existingError } =
    await supabaseAdmin
      .from("saved_reply_categories")
      .select("id,name,sort_index")
      .eq("business_id", businessId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingNames = new Set(
    (existingRows ?? []).map((row) =>
      String(row.name ?? "").trim().toLowerCase(),
    ),
  );

  const missing = DEFAULT_SAVED_REPLY_CATEGORIES.filter(
    (category) =>
      !existingNames.has(
        category.name.toLowerCase(),
      ),
  );

  if (missing.length === 0) {
    return;
  }

  /*
   * Defaults go after whatever is already there, so a workspace that arranged
   * its own categories does not find them pushed down.
   */
  const highest = (existingRows ?? []).reduce(
    (top, row) =>
      Math.max(
        top,
        Number(row.sort_index ?? 0) || 0,
      ),
    0,
  );

  const { error: insertError } =
    await supabaseAdmin
      .from("saved_reply_categories")
      .insert(
        missing.map((category, index) => ({
          business_id: businessId,
          name: category.name,
          sort_index:
            existingNames.size === 0
              ? category.sort_index
              : highest + (index + 1) * 10,
        })),
      );

  if (insertError) {
    /*
     * A duplicate here means another request seeded the same workspace at the
     * same time, which is a race rather than a failure worth surfacing.
     */
    if (
      insertError.code === "23505" ||
      insertError.message
        .toLowerCase()
        .includes("duplicate key")
    ) {
      return;
    }

    throw new Error(insertError.message);
  }
}

async function ensureDefaultTags(businessId: string) {
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("tags")
    .select("id,name")
    .eq("business_id", businessId);

  if (existingError) {
    throw existingError;
  }

  const rows = existingRows ?? [];
  const alreadySeeded = rows.some(
    (row) => row.name === DEFAULT_TAG_SEED_MARKER,
  );

  if (alreadySeeded) {
    return;
  }

  const visibleRows = rows.filter(
    (row) => row.name !== DEFAULT_TAG_SEED_MARKER,
  );

  // Only backfill starter tags into a workspace that has never had tag data.
  // Existing/customized workspaces are marked as initialized without adding
  // unexpected defaults.
  if (visibleRows.length === 0) {
    const { error: defaultsError } = await supabaseAdmin.from("tags").insert(
      DEFAULT_TAGS.map((tag) => ({
        business_id: businessId,
        ...tag,
      })),
    );

    // A concurrent request may have inserted the defaults first. In that
    // case the unique constraint can report 23505 and the workspace is still
    // safe to mark as initialized.
    if (defaultsError && defaultsError.code !== "23505") {
      throw defaultsError;
    }
  }

  const { error: markerError } = await supabaseAdmin.from("tags").insert({
    business_id: businessId,
    name: DEFAULT_TAG_SEED_MARKER,
    color: "#64748B",
    sort_index: 2_147_483_647,
    description: null,
    is_active: false,
  });

  if (markerError && markerError.code !== "23505") {
    throw markerError;
  }
}

async function ensureDefaultSavedReplies(businessId: string) {
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("saved_replies")
    .select("id,title")
    .eq("business_id", businessId);

  if (existingError) {
    throw existingError;
  }

  const rows = existingRows ?? [];
  const alreadySeeded = rows.some(
    (row) => row.title === DEFAULT_SAVED_REPLY_SEED_MARKER,
  );

  if (alreadySeeded) {
    return;
  }

  const visibleRows = rows.filter(
    (row) => row.title !== DEFAULT_SAVED_REPLY_SEED_MARKER,
  );

  if (visibleRows.length === 0) {
    const { error: defaultsError } = await supabaseAdmin
      .from("saved_replies")
      .insert(
        DEFAULT_SAVED_REPLIES.map((reply) => ({
          business_id: businessId,
          ...reply,
        })),
      );

    if (defaultsError && defaultsError.code !== "23505") {
      throw defaultsError;
    }
  }

  const { error: markerError } = await supabaseAdmin
    .from("saved_replies")
    .insert({
      business_id: businessId,
      title: DEFAULT_SAVED_REPLY_SEED_MARKER,
      shortcut: null,
      message_text: DEFAULT_SAVED_REPLY_SEED_MARKER,
      category: null,
      sort_index: 2_147_483_647,
      is_active: false,
    });

  if (markerError && markerError.code !== "23505") {
    throw markerError;
  }
}

/**
 * Initialize the 4 starter tags and 4 starter quick replies for one workspace.
 * Each workspace receives its own rows, so edits/deletes never affect another
 * workspace. Hidden seed markers ensure deleted starter content stays deleted.
 */
export async function ensureWorkspaceDefaultContent(businessId: string) {
  const normalizedBusinessId = businessId.trim();

  if (!normalizedBusinessId) {
    throw new Error("A workspace is required before seeding default content.");
  }

  await Promise.all([
    ensureDefaultTags(normalizedBusinessId),
    ensureDefaultSavedReplies(normalizedBusinessId),
    ensureDefaultSavedReplyCategories(
      normalizedBusinessId,
    ),
  ]);
}
