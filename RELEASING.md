# Releasing Dopamine to npm

All publishable packages live under the **`@dopaminefx`** npm org and are
versioned **independently** with [Changesets](https://github.com/changesets/changesets).
You never edit a version by hand or `npm publish` from your laptop — CI does it.

## What ships

| Package | Source | Notes |
| --- | --- | --- |
| `@dopaminefx/core` | `packages/core` | shared runtime |
| `@dopaminefx/effects` | `packages/effects` | batteries-included umbrella |
| `@dopaminefx/react` | `packages/react` | React bindings |
| `@dopaminefx/build` | `tools/dopamine` | the cross-platform build toolchain |
| `@dopaminefx/effect-*` | `effects/<name>/web` | one per effect, each versioned on its own |

`@dopaminefx/demo` (`examples/demo`) is **private** and never published — it is
listed in `ignore` in `.changeset/config.json`.

> Effects publish from their tracked workspace package (`effects/<name>/web`).
> The build first runs `dopamine build`, which syncs the portable `.dope.json`
> into `src/` and emits the byte-identical `dist/web/effect-*` standalone form;
> the `files` allowlist (`dist`, `src`) ships both the compiled output and the
> embedded `.dope` in the published tarball.

## The flow

1. **In every PR that changes a published package, add a changeset:**

   ```bash
   npm run changeset
   ```

   Select the packages you changed and a bump type for each:

   - **patch** — fixes / internal changes, no API change.
   - **minor** — new backwards-compatible features (a new effect, a new knob).
   - **major** — a breaking change to a package's public API or `.dope` contract.

   Each effect bumps independently — touching `effect-aurora` need not move any
   other effect. Commit the generated `.changeset/*.md` with your code. A PR
   with no changeset publishes nothing (fine for docs/CI-only changes).

2. **Merge to `main`.** The **release** workflow (`.github/workflows/release.yml`)
   sees the pending changesets and opens/updates a **"Version Packages"** PR that
   bumps versions, updates internal dependency ranges, and writes `CHANGELOG.md`
   entries. Review it like any PR.

3. **Merge the "Version Packages" PR.** With no changesets left, the workflow
   runs `npm run release`, which builds every package and `changeset publish`es
   the bumped ones to npm **with provenance**, then pushes a `pkg@version` git
   tag for each published package.

There is no manual tagging step — the per-package git tags are an output of the
publish, not a trigger.

## One-time setup: npm credentials (`NPM_TOKEN`)

CI authenticates to npm with a **granular access token** stored as the
`NPM_TOKEN` repository secret. Do this once:

### 1. Make sure the `@dopaminefx` org exists and you can publish to it

- Sign in at <https://www.npmjs.com> with an account that is an **owner** of the
  `dopaminefx` org (create the org at <https://www.npmjs.com/org/create> if it
  doesn't exist — the org name is `dopaminefx`, so packages are `@dopaminefx/…`).

### 2. Create a granular access token

- Go to <https://www.npmjs.com/settings/~/tokens> → **Generate New Token** →
  **Granular Access Token**.
- **Token name:** `dopamine-ci` (anything memorable).
- **Expiration:** pick a date and set a calendar reminder to rotate it (npm caps
  granular tokens at ~1 year).
- **Packages and scopes:**
  - **Permissions:** *Read and write*.
  - **Scope:** select the **`@dopaminefx`** organization (so the token covers
    every current and future `@dopaminefx/*` package, including ones that don't
    exist yet — the first publish needs to create them).
- **Organizations:** if asked, grant the token access to the `dopaminefx` org.
- Generate and **copy the token** (`npm_…`) — you only see it once.

> The org must allow token-based automation publishing. If the org enforces
> 2FA for writes, set the publishing setting to **"Require two-factor
> authentication or automation tokens"** (Org → Settings) so the automation
> token can publish unattended. Granular access tokens bypass the interactive
> 2FA prompt for the scopes they're granted.

### 3. Add it to GitHub as a repository secret

- In the repo: **Settings → Secrets and variables → Actions → New repository
  secret**.
- **Name:** `NPM_TOKEN`  ·  **Value:** the `npm_…` token from step 2.

That's the only secret required. `GITHUB_TOKEN` is provided automatically by
Actions.

### 4. (Provenance) confirm the repo is public

Publishing uses `--provenance` (via `NPM_CONFIG_PROVENANCE=true` + `id-token:
write`), which attaches a signed build attestation linking each published
version to this repo and workflow. Provenance requires a **public** repository.
If `10in30/dopamine` is private, either make it public or drop the
`NPM_CONFIG_PROVENANCE` env from `release.yml` (publishing still works without
provenance).

## Optional later hardening: OIDC Trusted Publishing

Once the packages exist on npm you can drop the long-lived token entirely and
switch to npm **Trusted Publishing**: in each package's npm settings, add a
trusted publisher pointing at `10in30/dopamine` and `release.yml`. After that,
remove `NODE_AUTH_TOKEN`/`NPM_TOKEN` — the `id-token: write` permission alone
authenticates the publish. (It can't do the *first* publish of a brand-new
package, which is why we bootstrap with a token.)

## First release / going to 1.0.0

The packages currently sit at `0.1.0` and have never been published. To cut the
first real release, add a changeset (likely `minor` for everything, or `major`
to jump to `1.0.0`), merge it, then merge the resulting "Version Packages" PR.
The first publish creates the packages in the `@dopaminefx` org.
