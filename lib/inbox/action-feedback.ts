/*
 * Conversation action feedback: one pending state and one success toast per
 * action, however many ways its confirmation arrives.
 *
 * Two problems lived here. Duplicate actions were guarded by React state,
 * which is not updated until the next render, so a double click could start
 * two requests -- and the guard was global, so pinning one conversation
 * disabled Pin on every other. And a successful action could alert twice:
 * once from its own HTTP response and again from the conversation_activity
 * row it wrote, which Realtime delivers back to the same browser.
 */

/** Synchronous, per-target duplicate guard. */
export class ActionGuard {
  private readonly active = new Map<string, string>();

  private key(target: string, kind: string) {
    return `${kind}:${target}`;
  }

  /** False when this exact action on this exact target is already running. */
  begin(target: string, kind: string, label: string) {
    const key = this.key(target, kind);
    if (this.active.has(key)) return false;
    this.active.set(key, label);
    return true;
  }

  end(target: string, kind: string) {
    this.active.delete(this.key(target, kind));
  }

  /** The pending label for a target ("Saving", "Assigning"...), or null. */
  label(target: string, kind: string) {
    return this.active.get(this.key(target, kind)) ?? null;
  }

  isPending(target: string, kind: string) {
    return this.active.has(this.key(target, kind));
  }
}

type LedgerEntry = {
  conversationId: string;
  activityTypes: string[];
  memberId: string | null;
  shown: boolean;
  /* Each action is echoed by exactly one activity row. */
  echoed: boolean;
  expiresAt: number;
};

/*
 * How long a confirmed action keeps absorbing its own Realtime echo. Activity
 * rows are written right after the mutation, so they normally arrive within
 * a second; this is generous for a slow socket.
 */
const ECHO_WINDOW_MS = 20_000;

export type RealtimeDecision = "show" | "suppress";

/*
 * One success notification per local action.
 *
 * The first of {HTTP confirmation, this browser's own Realtime activity row}
 * shows it; the second is suppressed. A teammate's activity -- or this member
 * acting from another device -- has no entry here and is always shown.
 */
export class ActionNotificationLedger {
  private readonly entries = new Map<string, LedgerEntry>();
  private counter = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  expect(conversationId: string, activityTypes: string[], memberId: string | null) {
    this.prune();
    const token = `action-${++this.counter}`;
    this.entries.set(token, {
      conversationId,
      activityTypes,
      memberId,
      shown: false,
      echoed: false,
      expiresAt: this.now() + ECHO_WINDOW_MS,
    });
    return token;
  }

  /** True when the caller should show the toast now. */
  confirmLocal(token: string) {
    const entry = this.entries.get(token);
    if (!entry) return true;
    entry.expiresAt = this.now() + ECHO_WINDOW_MS;
    if (entry.shown) return false;
    entry.shown = true;
    return true;
  }

  /** The action failed: release its entry so nothing is suppressed for it. */
  cancel(token: string) {
    this.entries.delete(token);
  }

  /*
   * A conversation_activity row arrived over Realtime. "suppress" when it is
   * this browser's own confirmed action whose toast is already shown;
   * otherwise "show" (and, when it confirms a still-pending local action,
   * that action will not show a second toast when its response lands).
   */
  claimRealtime(row: Record<string, unknown>): RealtimeDecision {
    this.prune();
    const conversationId = typeof row.conversation_id === "string" ? row.conversation_id : null;
    const activityType = typeof row.activity_type === "string" ? row.activity_type : null;
    const actorId = typeof row.actor_member_id === "string" ? row.actor_member_id : null;
    if (!conversationId || !activityType || !actorId) return "show";

    // Oldest unechoed matching action first: rapid Pin -> Unpin pairs each
    // echo with its own action rather than letting one action absorb both.
    for (const entry of this.entries.values()) {
      if (entry.echoed) continue;
      if (entry.conversationId !== conversationId) continue;
      if (!entry.memberId || entry.memberId !== actorId) continue;
      if (!entry.activityTypes.includes(activityType)) continue;
      entry.echoed = true;
      if (entry.shown) return "suppress";
      entry.shown = true;
      return "show";
    }
    return "show";
  }

  private prune() {
    const now = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token);
    }
  }
}

/*
 * Rollback that never overwrites a newer change.
 *
 * Only revert a field while it still holds the value this action wrote; if a
 * teammate (or Realtime) has since changed it, theirs is the newer truth.
 */
export function revertIfStillOurs<T, K extends keyof T>(
  row: T,
  field: K,
  ourValue: T[K],
  previous: Partial<T>,
): T {
  return row[field] === ourValue ? { ...row, ...previous } : row;
}
