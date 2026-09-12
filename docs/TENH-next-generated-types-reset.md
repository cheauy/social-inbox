# TENH: repair malformed generated Next.js route types

## Reported error

```
.next/dev/types/routes.d.ts:285:1
Type error: Unexpected keyword or identifier.
dlerRoute extends AppRouteHandlerRoutes> {
```

The fragment in the supplied error is not a complete TypeScript declaration. The failing file is Next.js-generated development output, not an application route source file. Regenerate the output instead of editing that declaration or disabling type checking.

## What was inspected

The latest supplied source archive was `social-inbox(20260912-112456).zip`, together with `TENH-existing-web-extension-v1.2.22-changed-files.zip`. The source declares Next.js 16.2.12, `dev: next dev` and `build: next build`. Neither archive contains `.next/`, `tsconfig.json`, `next.config.*`, or a root `.gitignore`.

Consequently the original malformed file, the cause of its incomplete write and the current compiler configuration could not be reproduced/verified from those archives. Interrupted output generation, competing processes or stale/copied output are possibilities, not confirmed causes.

This patch deliberately does not invent or overwrite the missing configuration. It does not change the current application, database, extension version or installed dependencies.

## Apply the reset

1. Stop all Next.js dev/build/start processes using THIS project directory. In each running development terminal, press Ctrl+C. Do not run this reset on a directory serving a live `next start` application.
2. Extract this patch into your existing project root, alongside `package.json`. It adds one script plus tests/documentation. It is not a complete project.
3. From that project-root terminal run:

```sh
node scripts/reset-next-generated.mjs --confirm-stopped
```

The confirmation flag means you have stopped the processes; it is not automatic process detection. The script does not terminate any processes.

4. Only after the reset reports success, run your EXISTING build command:

```sh
npm run build
```

Next.js regenerates its types during the build. Keep your existing dependencies/lockfile; this does not require a framework upgrade. For development, start `npm run dev` after the build finishes (or use it instead of a production build when only restarting local development).

Optional non-destructive preview:

```sh
node scripts/reset-next-generated.mjs --dry-run
```

Do not edit `routes.d.ts` by hand, turn off TypeScript checking or copy `.next` from another machine/version. Do not add this cleanup to every build while a dev/start server is running in the same folder.

## Exactly what is removed

Only these generated artifacts under the script's project root:

- `.next/` (development and production output and framework caches)
- `tsconfig.tsbuildinfo`
- `tsconfig.build.tsbuildinfo`

`.env*`, application source, `node_modules`, package/lockfiles, `next-env.d.ts`, existing configuration, Git metadata, database files and `tenh-extension/` are not changed. A clean build can be slower because `.next` caches are cleared. Symlink/junction cleanup targets and unexpected target types are refused. Run the script from the project root; arbitrary target paths are not accepted.

No script can prevent another process starting during cleanup; stopping the application's Next.js processes is required.

## Prevent generated output from being committed

Check your existing ROOT `.gitignore` and append missing rules (do not replace it):

```gitignore
/.next/
*.tsbuildinfo
```

Check whether generated files are already tracked:

```sh
git ls-files -- .next tsconfig.tsbuildinfo tsconfig.build.tsbuildinfo
```

If output lists those generated files, stop tracking ONLY those paths:

```sh
git rm -r --cached --ignore-unmatch .next
git rm --cached --ignore-unmatch tsconfig.tsbuildinfo tsconfig.build.tsbuildinfo
```

Review the diff before committing. Do not remove source files or your existing lockfile. Adding an ignore rule alone does not untrack an already committed file.

## If the error is on Vercel

After making sure generated output is not tracked, redeploy the correct commit with **Use existing Build Cache** unchecked. Do not change your production runtime credentials, extension version, domains, callbacks or messaging settings for this error.

If a clean run regenerates the exact malformed output, collect the newly generated `routes.d.ts`, current `tsconfig.json`, `next-env.d.ts`, `next.config.*` and full fresh build log. That would need a generator/configuration investigation rather than another cache-only reset. Do not share `.env` or tokens.

## Validation performed

- Node.js 22.16.0: script syntax passes.
- 12 Node automated cleanup tests pass, 0 fail.
- Tests include the reported malformed fragment as a synthetic fixture, removal of generated output only, unchanged source/configuration/environment/extension fixtures, refusal without confirmation, dry-run, repeated reset, invalid project, wrong working directory and symlink/unexpected-path refusal.
- This is cleanup behavior validation, NOT a reproduction of the original Next.js generator failure and NOT a full application build test.
- ZIP integrity and safe archive paths checked.
- A complete TENH production build and regeneration in the user's actual project/environment have not been run/verified.

Run the included checks:

```sh
node --test tests/build-tools/reset-next-generated.test.mjs
```

The recorded test output is in `docs/next-generated-reset-tests.log`.

## Primary references checked

Next.js explains that route helpers and `next-env.d.ts` are generated by `next dev`, `next build` and `next typegen`:
https://nextjs.org/docs/app/api-reference/config/typescript

Next.js development output separation (`.next/dev`):
https://nextjs.org/docs/pages/api-reference/config/next-config-js/isolatedDevBuild

Vercel no-cache redeployment:
https://vercel.com/docs/deployments/troubleshoot-a-build
