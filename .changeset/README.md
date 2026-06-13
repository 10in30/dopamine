# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).
It drives **independent, per-package versioning** for every published
`@dopaminefx/*` package (the shared runtime, the React bindings, the build
tools, and each `effect-*`).

## Adding a changeset (do this in every PR that changes a published package)

```bash
npm run changeset
```

Pick the packages you touched and the bump type for each:

- **patch** — bug fixes, internal refactors, no API change.
- **minor** — new, backwards-compatible features (e.g. a new effect knob).
- **major** — a breaking change to a package's public API or `.dope` contract.

Each effect bumps on its own — adding a knob to `effect-aurora` need not move
`effect-ripple`. Commit the generated `.changeset/*.md` file alongside your code.

## Releasing

You don't run the release by hand. On every push to `main`, the **Release**
workflow (`.github/workflows/release.yml`) either:

1. opens/updates a **"Version Packages"** PR that consumes the pending
   changesets, bumps versions, updates internal dep ranges, and writes
   `CHANGELOG.md` entries — review and merge it when you want to cut a release; or
2. (once that PR is merged and no changesets remain) **publishes** the bumped
   packages to npm with provenance and creates a `pkg@version` git tag per
   published package.

See `RELEASING.md` for the full flow and the npm credentials setup.
