# npm lockfile fixture

`package-lock.v3.json` is hand-authored for this project (same license as the repo).
Package names are fictional; it describes no real repository and says nothing about
live vulnerability status. It covers: nested installs (two versions of `lib-c`),
resolution walking up `node_modules`, a scoped package, a dev-only dependency, and
an optional dependency that is not installed.