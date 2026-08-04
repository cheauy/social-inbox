import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

type UpdateContactBody = {
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  companyName?: string | null;
  customerNote?: string | null;
};

type RouteContext = {
  params: Promise<{
    contactId: string;
  }>;
};

function cleanOptionalValue(
  value: string | null | undefined,
) {
  const cleaned = value?.trim();

  return cleaned ? cleaned : null;
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const { contactId } = await context.params;

  let body: UpdateContactBody;

  try {
    body = (await request.json()) as UpdateContactBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      {
        status: 400,
      },
    );
  }

  const fullName = cleanOptionalValue(body.fullName);
  const phone = cleanOptionalValue(body.phone);
  const email = cleanOptionalValue(body.email);
  const companyName = cleanOptionalValue(
    body.companyName,
  );
  const customerNote = cleanOptionalValue(
    body.customerNote,
  );

  if (
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Please enter a valid email address.",
      },
      {
        status: 400,
      },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .update({
      full_name: fullName,
      phone,
      email,
      company_name: companyName,
      customer_note: customerNote,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId)
    .select(`
      id,
      full_name,
      phone,
      email,
      company_name,
      customer_note,
      updated_at
    `)
    .maybeSingle();

  if (error) {
    console.error(
      "Unable to update contact:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "Unable to update customer profile.",
        details: error.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        success: false,
        error: "Customer was not found.",
      },
      {
        status: 404,
      },
    );
  }

  return NextResponse.json({
    success: true,
    contact: data,
  });
}