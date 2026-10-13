# Dependency security patches

Use Node 22 and `npm ci`. Installation applies the patches in
`dependency-patches.json`; `npm run build` verifies their hashes before building.
Do not deploy an installation made with `--ignore-scripts` without explicitly
running `npm run postinstall`.

`npm run audit:security` verifies the installed source hashes, runs regression
tests, then queries the npm advisory database. Unknown advisories fail the check.
The original package versions and upstream alerts remain visible in `npm audit`.

## Temporary upstream mitigation, 2026-10-13

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
has no published patched version. The local patch to braces 3.0.3 limits parser
nesting and each recursive AST consumer to 128 levels. Normal expansion,
deep patterns below the input character limit, deep ASTs and cycles are tested.
The dependency is used by the development toolchain.

Every installed copy is checked against exact upstream and patched SHA-256
hashes. An unexpected version or source change stops installation/building.
When upstream publishes a fix, remove its patch and advisory exception together,
update the lockfile and rerun the regression suite and application checks.

Production credentials belong in the hosting environment, never in this repo.
Values in `.env.test` and CI are deterministic, isolated test fixtures and must
never be reused in production.
