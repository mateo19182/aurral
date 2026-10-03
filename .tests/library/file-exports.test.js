import assert from "node:assert/strict";
import { once } from "node:events";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import express from "express";
import {
  cleanupIsolatedState,
  setupIsolatedBackend,
} from "../helpers/backendTestHarness.js";

const [state, { dbOps, userOps }, store, { createSession }, { authMiddleware }] =
  await setupIsolatedBackend(
    "file-exports",
    "backend/db/helpers/index.js",
    "backend/services/libraryMediaStore.js",
    "backend/config/session-helpers.js",
    "backend/middleware/auth.js",
  );
const { registerFileExports } = await import(
  "../../backend/routes/library/handlers/fileExports.js"
);
const { registerTracks } = await import("../../backend/routes/library/handlers/tracks.js");
const { libraryManager } = await import("../../backend/services/libraryManager.js");
const { db } = await import("../../backend/config/db-sqlite.js");

const audio = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0, 1, 2, 3, 4, 5]);
const filename = '01 - Música 東京 "live".flac';
const filePath = path.join(state.baseDir, filename);
let album;
let track;
let token;
let expiredToken;
let baseUrl;
let server;
const originalGetTracks = libraryManager.getTracks;

test.before(async () => {
  dbOps.updateSettings({
    onboardingComplete: true,
    integrations: { general: { authUser: "admin", authPassword: "configured" } },
    security: { localNetworkBypass: { enabled: false } },
  });
  const user = userOps.createUser("listener", "unused-hash", "user");
  token = createSession(user.id).token;
  expiredToken = createSession(user.id).token;
  db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?").run(Date.now() - 1, expiredToken);
  const artist = store.upsertLibraryArtist({ identityKey: "export-artist", name: "Artist" });
  album = store.upsertLibraryAlbum({
    identityKey: "export-album", artistId: artist.id, title: "Album", albumArtist: "Artist",
  });
  track = store.upsertLibraryTrack({
    identityKey: "export-track", title: "Track", artistName: "Artist",
  });
  store.linkLibraryAlbumTrack({ albumId: album.id, trackId: track.id, trackNumber: 1 });
  store.upsertLibraryMediaFile({
    trackId: track.id, albumId: album.id, source: "aurral", path: filePath,
    format: "flac", available: true,
  });
  await writeFile(filePath, audio);
  libraryManager.getTracks = async (albumId) => String(albumId) === "legacy-album"
    ? [{ id: "legacy-track", hasFile: true, path: filePath }]
    : [];
  const app = express();
  app.use(authMiddleware);
  const router = express.Router();
  registerFileExports(router);
  registerTracks(router);
  app.use("/api/library", router);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  libraryManager.getTracks = originalGetTracks;
  if (server) await new Promise((resolve) => server.close(resolve));
  await cleanupIsolatedState(state);
});

const canonicalPath = () => `/api/library/canonical-download/${album.id}/${track.id}`;
const request = (url, options = {}) => fetch(`${baseUrl}${url}`, options);
const authenticated = (url, options) => request(`${url}?token=${token}`, options);

test("ordinary user saves the exact original file with a safe Unicode filename", async () => {
  const response = await authenticated(canonicalPath());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /^attachment;/);
  assert.match(response.headers.get("content-disposition"), /filename\*=UTF-8''/);
  assert.match(response.headers.get("content-disposition"), /M%C3%BAsica/);
  assert.equal(response.headers.get("content-length"), String(audio.length));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio);
});

test("anonymous and expired sessions cannot download through either endpoint", async () => {
  for (const url of [canonicalPath(), "/api/library/file-download/legacy-album/legacy-track"]) {
    for (const suffix of ["", "?token=invalid-session", `?token=${expiredToken}`]) {
      const response = await request(url + suffix);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("content-disposition"), null);
      await response.arrayBuffer();
    }
  }
});

test("legacy playback identities support original-file download", async () => {
  const response = await authenticated("/api/library/file-download/legacy-album/legacy-track");
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio);
});

test("download supports byte ranges for resumed transfers", async () => {
  const response = await authenticated(canonicalPath(), { headers: { Range: "bytes=2-5" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), `bytes 2-5/${audio.length}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio.subarray(2, 6));
});

test("playback stays inline and serves the same file", async () => {
  const response = await authenticated(`/api/library/canonical-stream/${album.id}/${track.id}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-disposition"), null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio);
});

test("unknown IDs and path traversal attempts cannot select arbitrary files", async () => {
  for (const url of [
    `/api/library/canonical-download/unknown/${track.id}`,
    `/api/library/canonical-download/${album.id}/unknown`,
    `/api/library/canonical-download/${album.id}/${encodeURIComponent("../../etc/passwd")}`,
    "/api/library/file-download/legacy-album/unknown",
  ]) {
    const response = await authenticated(url);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Track file missing" });
  }
});

test("a deleted indexed file returns a clean 404 without leaking filesystem paths", async () => {
  await unlink(filePath);
  const response = await authenticated(canonicalPath());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Track file missing" });
  assert.equal(response.headers.get("content-disposition"), null);
});
