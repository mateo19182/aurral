# Mateo's Aurral fork

Upstream: https://github.com/lklynet/aurral

Fork: https://github.com/mateo19182/aurral

The maintained branch is `mateo/downloads`, based on upstream `v2.10.0`.
Keep `upstream` as a separate Git remote. `main` remains the upstream snapshot
created when the fork was opened; production uses `mateo/downloads`.

## Changes

The Library track menu offers **Save to device** when an original file is
available. Artist track menus also offer it when their track has a library
stream path. Metadata previews do not offer file export. The download uses the
existing account/session authentication and album/track file lookup. Ordinary
users can download without permission to delete or acquire music. The original
audio and embedded tags are preserved, and the browser writes directly to disk.
Individual downloads support byte ranges for resuming. Album pages offer
**Save album ZIP**. Track lists have checkboxes, **Select available tracks**,
**Save selected ZIP** and **Clear selection**. A selection can include tracks
from multiple albums and up to 500 tracks. The select-available button selects
the current list/page; the selection persists while paging within that view.

Archives stream to the browser without temporary ZIP files or buffering whole
audio files. Original audio is stored unchanged in artist/album folders.
Duplicate filenames get distinct names. `download-notes.json` lists exported
files and unavailable indexed tracks. Unindexed tracks cannot be listed. A
selection with no available files returns 404. ZIP transfers are generated on
demand and must be restarted if interrupted; individual files support resume.

The individual HTTP routes are `/api/library/canonical-download/:albumId/:trackId`
and `/api/library/file-download/:albumId/:trackId`. They accept authenticated
requests just like playback and never accept a filesystem path from the caller.
Missing files return 404. Anonymous requests return 401.

Album archives use `GET /api/library/album-download/:albumId`. Selected tracks
use `POST /api/library/bulk-download` with a `tracks` form field containing a
JSON array of `{ "albumId": 1, "trackId": 2 }` identities. A native browser form
lets the browser save the response directly to disk. Every export resolves
canonical library IDs on the server; callers cannot specify files or archive
paths. The archive service uses the pinned `yazl` dependency and closes its file
streams when the client cancels.

Existing server fixes are kept in their own commit, separate from file export:

- SQLite immediate transactions and atomic artist-ID index migration.
- Exact-title matching before fuzzy matching, with unresolved remixes kept distinct.
- Human review for an exact title/artist/duration match that the soft matcher rejects.
- Recognition of Aurral's native download folder in the health check.

They replace the server's four source-file bind mounts. Review each fix against
upstream when merging a release, and remove it if upstream has solved the problem.

## Validation

Use Node 26.8.1 and the dependencies in `package-lock.json`. Native dependencies
require Python, make and a C++ compiler. The upstream validation workflow lists
the additional font, ffmpeg and matcher runtime dependencies for the full suite.

```sh
npm ci
npm run lint
node --test --import ./.tests/setup-env.js .tests/library/file-exports.test.js
npm run build
```

The file-export tests use an isolated temporary database and actual HTTP file
responses. They cover ordinary-user access, session failures, original bytes,
Unicode filenames, byte ranges, missing files, invalid identities and playback.
ZIP tests validate CRCs, original bytes, duplicate names, cross-album selection,
missing-track notes, selection limits, metadata path sanitization and cancellation.

## Updating upstream

Start with a clean working tree. Choose an upstream release explicitly; do not
replace the maintained branch with upstream's branch using a force push.

```sh
git checkout mateo/downloads
git fetch upstream --tags
git checkout -b update/upstream-X.Y.Z
git merge vX.Y.Z
```

Resolve conflicts, review the compatibility fixes, run validation and build a
candidate image. Test login, playback and **Save to device** with an ordinary
user against a separate copy of the configuration before upgrading production.
Do not run two Aurral instances against the same writable configuration/database.
Once verified, merge the update branch into `mateo/downloads` and push it.

## Building and deploying

Use a unique version for each release, such as `2.10.0-mateo.3`. Images record
their Git revision and fork URL. From the source checkout:

```sh
docker build \
  --build-arg APP_VERSION=2.10.0-mateo.2 \
  --build-arg GITHUB_REPO=mateo19182/aurral \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  -t aurral-fork:2.10.0-mateo.2 .
```

Alternatively run **Fork image** in GitHub Actions on `mateo/downloads`. It runs
upstream validation before publishing `ghcr.io/mateo19182/aurral:<version>`.
Initial package visibility and server registry access may need configuring.
Only this workflow publishes fork images; upstream releases do not deploy
automatically. The registry workflow is optional for local builds.

On this server, deployment configuration and credentials remain outside Git,
one directory above `source/`. Before upgrading, stop Aurral and back up its
configuration/database and Compose file. Change the Compose image to the newly
built version and run `docker compose up -d aurral`. Preserve the music and
configuration volume mappings. Keep the previous image and configuration backup
for rollback, particularly when an upstream upgrade migrates the database.
