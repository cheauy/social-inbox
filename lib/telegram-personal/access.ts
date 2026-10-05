/*
 * Who may do what with a Telegram Personal account. The tgp_* SQL functions
 * enforce the same rules; these helpers let routes fail early and let the UI
 * show only the actions a member can take.
 *
 * The "holder" is the TENH user who signed in with their own Telegram account.
 */

export type PersonalTeamAccess = "holder_only" | "owners" | "all_inbox_members" | "selected_members";

export type PersonalActor = { userId: string; memberId: string; role: string };
export type PersonalSessionRef = { holderUserId: string; teamAccess: PersonalTeamAccess };

const isOwner = (actor: PersonalActor) => actor.role === "owner";
const isHolder = (actor: PersonalActor, session: PersonalSessionRef) => actor.userId === session.holderUserId;

/** Self-service: any workspace Owner may connect their own account. */
export const canStartPersonalLogin = (actor: PersonalActor) => isOwner(actor);

/** QR links, password hints and login inputs belong to the holder alone. */
export const canUseLogin = (actor: PersonalActor, session: PersonalSessionRef) => isHolder(actor, session);

/** Any owner may pause or sign out an account in their workspace (e.g. a departing employee). */
export const canPause = (actor: PersonalActor, session: PersonalSessionRef) => isHolder(actor, session) || isOwner(actor);
export const canDisconnect = canPause;

/** Resuming re-exposes the holder's account, so only the holder may do it. */
export const canResume = (actor: PersonalActor, session: PersonalSessionRef) => isHolder(actor, session);
export const canSetTeamAccess = (actor: PersonalActor, session: PersonalSessionRef) => isHolder(actor, session);

/** Owners and the holder see the identity details (username, masked phone). */
export const canSeeIdentityDetails = (actor: PersonalActor, session: PersonalSessionRef) => isHolder(actor, session) || isOwner(actor);

/**
 * Phase D: whether a member may see conversations shared from this account.
 * Inbox permission is checked separately; this only narrows it.
 */
export function canSeePersonalConversations(
  actor: PersonalActor,
  session: PersonalSessionRef,
  selectedMemberIds: ReadonlySet<string>,
) {
  if (isHolder(actor, session)) return true;
  switch (session.teamAccess) {
    case "owners":
      return isOwner(actor);
    case "all_inbox_members":
      return true;
    case "selected_members":
      return selectedMemberIds.has(actor.memberId);
    default:
      return false;
  }
}
