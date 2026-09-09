import { useAuth } from "./auth/provider";

/*
 * Who you are, as opposed to who you are here.
 *
 * These screens were reading the team_members row, which is a membership: it
 * carries a name and an email per workspace, and they are whatever was on the
 * invitation. That is how somebody who signed up as themselves ends up
 * greeted as "Support Agent" at agent@tenhchat.local -- an address that is not
 * theirs and that nobody could sign in with.
 *
 * Your name, your email and your picture come from the account, which is what
 * the web's Profile information page shows and what you typed when you
 * registered. It is already in the session, so this costs no request.
 *
 * Role stays with the membership, because a role only means anything inside a
 * workspace -- an owner of one is an agent in another.
 */

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function useAccount() {
  const { session } = useAuth();

  const user = session?.user;
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;

  return {
    /* The name given at sign-up; the email is the one that signs in. */
    name: text(meta.full_name) ?? text(meta.name),
    email: text(user?.email),
    avatar: text(meta.avatar_url) ?? text(meta.picture),
    phone: text(user?.phone) ?? text(meta.phone),
  };
}
