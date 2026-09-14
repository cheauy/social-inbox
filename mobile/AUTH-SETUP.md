# Mobile sign-in

Google and Facebook use the system authentication browser, then return to the
native `/auth/callback` screen to exchange the PKCE code. Password sign-in stays
inside the app. Registration confirmation emails use the same mobile callback.

## Supabase setting required

In the project's Authentication → URL Configuration → Redirect URLs, add:

```
tenhchat://auth/callback
```

Keep the existing website URL and website redirects. Do not change Site URL to
the mobile scheme. An unapproved redirect can fall back to Site URL and leave
the user on app.tenhchat.com.

If the confirmation email template was customized, ensure it uses Supabase's
`{{ .ConfirmationURL }}` rather than linking directly to the website. Keep the
confirmation step; do not replace it with a raw redirect URL.

Use a development build or installed app to test the registered `tenhchat`
scheme reliably. Expo Go uses an `exp://.../--/auth/callback` URL that depends on
the current development server; it is not the installed app's callback URL.
If testing that URL, allow only the exact development callback in Supabase and
remove it after testing. Never add a broad wildcard for all Expo projects.

## Verify

1. Start signed out. Sign in with Google, then with Facebook. The browser should
   close and the app should show the workspace chooser.
2. Cancel either provider flow; the sign-in screen should remain usable.
3. Sign in with a confirmed email/password; no browser should open.
4. Register with all five fields. Blank fields, short passwords, and different
   passwords must be rejected before a signup request.
5. Open the confirmation email on the same device where registration started.
   The app should complete the PKCE exchange and show the workspace chooser.
6. Reopen a used or expired link; the app should show a recoverable error.

Changing the app display name to “Tenh Chat” requires a fresh native build for
the installed home-screen label; the in-app labels update with the JS bundle.
