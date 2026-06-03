# Vendored `sqlite-vec` extension binaries

`danni-bg` loads the [`sqlite-vec`](https://github.com/asg017/sqlite-vec) loadable extension from this directory at runtime. We vendor prebuilt binaries here so a fresh checkout has reproducible vector-index behavior without depending on the operator's package manager.

## Layout

```
vendor/sqlite-vec/
├── linux-x64/vec0.so
├── linux-arm64/vec0.so
├── macos-arm64/vec0.dylib
└── macos-x64/vec0.dylib
```

`src/store/db.ts` selects the correct binary at startup based on `process.platform` + `process.arch`.

## Operator setup

This repository does **not** commit the precompiled binaries (they are platform-specific and binary). Download the matching release from <https://github.com/asg017/sqlite-vec/releases> and place the `vec0` shared library under the directory matching your platform, using the filenames above.

For each release, record the version + sha256 in `versions.txt` so the binary is reproducibly linked to a known upstream source.

## Reproducibility

The `versions.txt` (operator-maintained) MUST list the upstream `sqlite-vec` release tag and the `sha256` of the vendored binary so the supply chain is auditable.

## CI / dev shortcut

For CI runs that don't need vector search (e.g. linter-only jobs), `src/store/db.ts` may be invoked with `loadVec=false`; production runs MUST load the extension.
