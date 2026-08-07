import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses = new Set([
  "open",
  "pending",
  "resolved",
  "closed",
  "spam",
]);

const allowedSorts = new Set([
  "recently_active",
  "oldest_activity",
  "newest_customer",
  "oldest_customer",
  "most_conversations",
  "name_asc",
  "name_desc",
]);

type CustomerRow = {
  id: string;
  business_id: string;
  full_name: string | null;
  profile_picture_url: string | null;
  platform_user_id: string;
  phone: string | null;
  address: string | null;
  customer_note: string | null;
  created_at: string;
  last_contact_at: string | null;

  conversations:
    | Array<{
        id: string;
        status: string;
        assigned_to: string | null;
        last_message_at: string | null;

        assigned_member:
          | {
              id: string;
              full_name: string;
              role: string;
              profile_picture_url:
                | string
                | null;
            }
          | Array<{
              id: string;
              full_name: string;
              role: string;
              profile_picture_url:
                | string
                | null;
            }>
          | null;

        social_account:
          | {
              id: string;
              platform: string;
              account_name: string | null;
            }
          | Array<{
              id: string;
              platform: string;
              account_name: string | null;
            }>
          | null;
      }>
    | null;

  contact_tags:
    | Array<{
        tag:
          | {
              id: string;
              name: string;
              color: string;
            }
          | Array<{
              id: string;
              name: string;
              color: string;
            }>
          | null;
      }>
    | null;
};

function getSingleResult<T>(
  value: T | T[] | null,
): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function safeSearchValue(
  value: string,
) {
  return value
    .replaceAll(",", " ")
    .replaceAll("%", "")
    .replaceAll("_", "")
    .trim();
}

export async function GET(
  request: NextRequest,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;

  const searchParams =
    request.nextUrl.searchParams;

  const search =
    safeSearchValue(
      searchParams.get("search") ?? "",
    );

  const status =
    searchParams
      .get("status")
      ?.trim() ?? "all";

  const assignment =
    searchParams
      .get("assignment")
      ?.trim() ?? "all";

  const tagId =
    searchParams
      .get("tagId")
      ?.trim() ?? "";

  const customerType =
    searchParams
      .get("customerType")
      ?.trim() ?? "all";

  const sort =
    searchParams
      .get("sort")
      ?.trim() ??
    "recently_active";

  const page = Math.max(
    Number(
      searchParams.get("page") ??
        "1",
    ) || 1,
    1,
  );

  const pageSize = Math.min(
    Math.max(
      Number(
        searchParams.get("pageSize") ??
          "20",
      ) || 20,
      1,
    ),
    100,
  );

  if (
    status !== "all" &&
    !allowedStatuses.has(status)
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid customer status filter.",
      },
      {
        status: 400,
      },
    );
  }

  if (!allowedSorts.has(sort)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid customer sort option.",
      },
      {
        status: 400,
      },
    );
  }

  const from =
    (page - 1) * pageSize;

  const to =
    from + pageSize - 1;

  let query =
    supabaseAdmin
      .from("contacts")
      .select(
        `
          id,
          business_id,
          full_name,
          profile_picture_url,
          platform_user_id,
          phone,
          address,
          customer_note,
          created_at,
          last_contact_at,

          conversations (
            id,
            status,
            assigned_to,
            last_message_at,

            assigned_member:team_members (
              id,
              full_name,
              role,
              profile_picture_url
            ),

            social_account:social_accounts (
              id,
              platform,
              account_name
            )
          ),

          contact_tags (
            tag:tags (
              id,
              name,
              color
            )
          )
        `,
        {
          count: "exact",
        },
      )
      .eq(
        "business_id",
        currentMember.business_id,
      );

  if (search) {
    query = query.or(
      [
        `full_name.ilike.%${search}%`,
        `phone.ilike.%${search}%`,
        `platform_user_id.ilike.%${search}%`,
        `customer_note.ilike.%${search}%`,
      ].join(","),
    );
  }

  if (tagId) {
    query = query.eq(
      "contact_tags.tag_id",
      tagId,
    );
  }

  if (
    customerType ===
    "without_phone"
  ) {
    query = query.is(
      "phone",
      null,
    );
  }

  if (
    customerType ===
    "with_note"
  ) {
    query = query.not(
      "customer_note",
      "is",
      null,
    );
  }

  switch (sort) {
    case "oldest_activity":
      query = query.order(
        "last_contact_at",
        {
          ascending: true,
          nullsFirst: false,
        },
      );
      break;

    case "newest_customer":
      query = query.order(
        "created_at",
        {
          ascending: false,
        },
      );
      break;

    case "oldest_customer":
      query = query.order(
        "created_at",
        {
          ascending: true,
        },
      );
      break;

    case "name_asc":
      query = query.order(
        "full_name",
        {
          ascending: true,
          nullsFirst: false,
        },
      );
      break;

    case "name_desc":
      query = query.order(
        "full_name",
        {
          ascending: false,
          nullsFirst: false,
        },
      );
      break;

    case "most_conversations":
      /*
       * Supabase cannot reliably order by the
       * nested conversation count in this query.
       * We sort the returned page after loading it.
       */
      query = query.order(
        "last_contact_at",
        {
          ascending: false,
          nullsFirst: false,
        },
      );
      break;

    case "recently_active":
    default:
      query = query.order(
        "last_contact_at",
        {
          ascending: false,
          nullsFirst: false,
        },
      );
      break;
  }

  const {
    data,
    error,
    count,
  } = await query.range(from, to);

  if (error) {
    console.error(
      "Unable to load customers:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load customers.",
        details: error.message,
      },
      {
        status: 500,
      },
    );
  }

  let customers =
    (data ?? []) as unknown as CustomerRow[];

  const transformedCustomers =
    customers
      .map((customer) => {
        const conversations =
          customer.conversations ?? [];

        const sortedConversations =
          [...conversations].sort(
            (first, second) => {
              const firstTime =
                first.last_message_at
                  ? new Date(
                      first.last_message_at,
                    ).getTime()
                  : 0;

              const secondTime =
                second.last_message_at
                  ? new Date(
                      second.last_message_at,
                    ).getTime()
                  : 0;

              return (
                secondTime -
                firstTime
              );
            },
          );

        const latestConversation =
          sortedConversations[0] ??
          null;

        const assignedMember =
          latestConversation
            ? getSingleResult(
                latestConversation.assigned_member,
              )
            : null;

        const socialAccount =
          latestConversation
            ? getSingleResult(
                latestConversation.social_account,
              )
            : null;

        const tags =
          (customer.contact_tags ?? [])
            .map((relation) =>
              getSingleResult(
                relation.tag,
              ),
            )
            .filter(
              (
                tag,
              ): tag is {
                id: string;
                name: string;
                color: string;
              } => Boolean(tag),
            );

        return {
          id: customer.id,

          fullName:
            customer.full_name ??
            "Facebook customer",

          profilePictureUrl:
            customer.profile_picture_url,

          platformUserId:
            customer.platform_user_id,

          phone: customer.phone,
          address: customer.address,

          customerNote:
            customer.customer_note,

          createdAt:
            customer.created_at,

          lastActiveAt:
            customer.last_contact_at,

          conversationCount:
            conversations.length,

          latestConversation:
            latestConversation
              ? {
                  id:
                    latestConversation.id,

                  status:
                    latestConversation.status,

                  assignedTo:
                    latestConversation.assigned_to,

                  lastMessageAt:
                    latestConversation.last_message_at,

                  assignedMember:
                    assignedMember
                      ? {
                          id:
                            assignedMember.id,

                          fullName:
                            assignedMember.full_name,

                          role:
                            assignedMember.role,

                          profilePictureUrl:
                            assignedMember.profile_picture_url,
                        }
                      : null,

                  socialAccount:
                    socialAccount
                      ? {
                          id:
                            socialAccount.id,

                          platform:
                            socialAccount.platform,

                          accountName:
                            socialAccount.account_name,
                        }
                      : null,
                }
              : null,

          tags,
        };
      })
      .filter((customer) => {
        if (
          status !== "all" &&
          customer.latestConversation
            ?.status !== status
        ) {
          return false;
        }

        if (
          assignment ===
            "unassigned" &&
          customer.latestConversation
            ?.assignedTo
        ) {
          return false;
        }

        if (
          assignment === "me" &&
          customer.latestConversation
            ?.assignedTo !==
            currentMember.id
        ) {
          return false;
        }

        if (
          assignment !== "all" &&
          assignment !==
            "unassigned" &&
          assignment !== "me" &&
          customer.latestConversation
            ?.assignedTo !==
            assignment
        ) {
          return false;
        }

        if (
          customerType ===
            "multiple_conversations" &&
          customer.conversationCount <
            2
        ) {
          return false;
        }

        if (
          customerType ===
            "new_customers" &&
          customer.conversationCount >
            1
        ) {
          return false;
        }

        if (
          customerType ===
            "returning_customers" &&
          customer.conversationCount <
            2
        ) {
          return false;
        }

        return true;
      });

  if (
    sort ===
    "most_conversations"
  ) {
    transformedCustomers.sort(
      (first, second) =>
        second.conversationCount -
        first.conversationCount,
    );
  }

  const [
    totalCustomersResult,
    activeTodayResult,
    unassignedResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("contacts")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq(
        "business_id",
        currentMember.business_id,
      ),

    supabaseAdmin
      .from("contacts")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .gte(
        "last_contact_at",
        new Date(
          new Date().setHours(
            0,
            0,
            0,
            0,
          ),
        ).toISOString(),
      ),

    supabaseAdmin
      .from("conversations")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .is(
        "assigned_to",
        null,
      ),
  ]);

  return NextResponse.json({
    success: true,

    customers:
      transformedCustomers,

    summary: {
      totalCustomers:
        totalCustomersResult.count ??
        0,

      activeToday:
        activeTodayResult.count ??
        0,

      unassignedConversations:
        unassignedResult.count ??
        0,
    },

    filters: {
      search,
      status,
      assignment,
      tagId,
      customerType,
      sort,
    },

    pagination: {
      page,
      pageSize,

      total:
        count ?? 0,

      totalPages: Math.max(
        Math.ceil(
          (count ?? 0) /
            pageSize,
        ),
        1,
      ),
    },
  });
}