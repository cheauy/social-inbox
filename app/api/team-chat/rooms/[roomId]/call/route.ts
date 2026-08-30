import { createHmac } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { getAccessibleRoom } from "@/lib/team/team-chat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

/**
 * Mint a LiveKit access token for a group call.
 *
 * A LiveKit token is just an HS256 JWT with a `video` grant, so this is
 * signed with node crypto rather than pulling in livekit-server-sdk.
 * The secret never leaves the server; the browser only ever receives a
 * short-lived token scoped to one room.
 *
 * Required env:
 *   LIVEKIT_API_KEY
 *   LIVEKIT_API_SECRET
 *   NEXT_PUBLIC_LIVEKIT_URL   (wss://your-project.livekit.cloud)
 */

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signLiveKitToken({
  apiKey,
  apiSecret,
  identity,
  name,
  room,
}: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name: string;
  room: string;
}) {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "HS256", typ: "JWT" };

  const payload = {
    iss: apiKey,
    sub: identity,
    jti: identity,
    nbf: now - 10,
    exp: now + TOKEN_TTL_SECONDS,
    name,
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload),
  )}`;

  const signature = createHmac("sha256", apiSecret)
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64Url(signature)}`;
}

export async function POST(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const currentMember = authResult.member;
  const { roomId } = await context.params;

  // Membership is checked before a token is issued, so a token can only
  // ever be minted for a room the caller can already open.
  const room = await getAccessibleRoom(currentMember, roomId);

  if (!room) {
    return NextResponse.json(
      { success: false, error: "Team chat room not found." },
      { status: 404 },
    );
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !serverUrl) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Group calling is not configured on this server yet.",
        code: "CALLS_NOT_CONFIGURED",
      },
      { status: 501 },
    );
  }

  // Namespacing by business keeps two workspaces from ever sharing a
  // LiveKit room even if room ids were somehow guessed.
  const callRoom = `tenh-${currentMember.business_id}-${room.id}`;

  const token = signLiveKitToken({
    apiKey,
    apiSecret,
    identity: currentMember.id,
    name: currentMember.full_name || "TENH member",
    room: callRoom,
  });

  return NextResponse.json({
    success: true,
    token,
    serverUrl,
    callRoom,
    roomName: room.name,
  });
}
