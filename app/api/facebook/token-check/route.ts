import { NextResponse } from "next/server";
import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";

export const dynamic = "force-dynamic";

export async function GET() {
  const pageAccessToken =
  await getFacebookPageAccessToken(
    
  );

  const version =
    process.env.FACEBOOK_GRAPH_API_VERSION;



  const url = new URL(
    `https://graph.facebook.com/${version}/me`,
  );

  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", pageAccessToken);

  const response = await fetch(url, {
    cache: "no-store",
  });

  const result = await response.json();

  return NextResponse.json(result, {
    status: response.status,
  });
}