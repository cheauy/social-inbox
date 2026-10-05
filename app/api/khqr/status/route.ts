import { handleKhqrRequest } from "@/lib/khqr/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleKhqrRequest(request, "status"); }
