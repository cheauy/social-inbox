type FacebookProfileIdentity = {
  facebook_profile_id?: string | null;
  platform_user_id?: string | null;
};

export function getFacebookCustomerProfileUrl(contact: FacebookProfileIdentity | null | undefined): string | null {
  // A Page-scoped Messenger ID is never a fallback for a public Facebook ID.
  const publicId = contact?.facebook_profile_id?.trim();
  return publicId && /^[0-9]{1,30}$/.test(publicId)
    ? `https://www.facebook.com/profile.php?id=${publicId}`
    : null;
}
