// Compatibility tombstone for installed clients and saved links. No data access.
function retired() {
  return Response.json(
    { success: false, code: "TEAM_CHAT_RETIRED", error: "Team Chat Rooms have been removed. Please update TENH and use Inbox." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
export { retired as GET, retired as POST, retired as PUT, retired as PATCH, retired as DELETE };
