/** Only confirmed invalid sessions permit destructive local cleanup. Unknown failures stay retryable. */
export function isTerminalAuthSessionError(error: { code?: string; name?: string; status?: number } | null) {
  if (!error || error.status === 429 || (error.status ?? 0) >= 500 ||
      error.name?.includes("Retryable") || error.name === "AuthUnknownError" ||
      ["request_timeout", "unexpected_failure", "hook_timeout", "hook_timeout_after_retry"].includes(error.code ?? "")) return false;
  return error.name === "AuthSessionMissingError" || error.status === 401 ||
    ["refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired", "bad_jwt", "user_banned"].includes(error.code ?? "");
}
