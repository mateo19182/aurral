import assert from "node:assert/strict";
import { once } from "node:events";
import { writeFile, unlink, mkdir, truncate } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
let secondTrack;
let missingTrack;
let otherAlbum;
let otherTrack;
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
  secondTrack = store.upsertLibraryTrack({
    identityKey: "export-track-two", title: "Second track", artistName: "Artist",
  });
  store.linkLibraryAlbumTrack({ albumId: album.id, trackId: secondTrack.id, trackNumber: 2 });
  const secondPath = path.join(state.baseDir, "disc-two", filename);
  await mkdir(path.dirname(secondPath));
  await writeFile(secondPath, Buffer.from("second-original-file"));
  store.upsertLibraryMediaFile({
    trackId: secondTrack.id, albumId: album.id, source: "aurral", path: secondPath,
    format: "flac", available: true,
  });
  missingTrack = store.upsertLibraryTrack({
    identityKey: "export-track-missing", title: "Missing track", artistName: "Artist",
  });
  store.linkLibraryAlbumTrack({ albumId: album.id, trackId: missingTrack.id, trackNumber: 3 });
  store.upsertLibraryMediaFile({
    trackId: missingTrack.id, albumId: album.id, source: "aurral", path: path.join(state.baseDir, "missing.flac"),
    format: "flac", available: false,
  });
  otherAlbum = store.upsertLibraryAlbum({
    identityKey: "export-other-album", artistId: artist.id,
    title: "../Other\\Album", albumArtist: "Artist",
  });
  otherTrack = store.upsertLibraryTrack({
    identityKey: "export-other-track", title: "Other track", artistName: "Artist",
  });
  store.linkLibraryAlbumTrack({ albumId: otherAlbum.id, trackId: otherTrack.id, trackNumber: 1 });
  const otherPath = path.join(state.baseDir, "other.flac");
  await writeFile(otherPath, "other-original-file");
  store.upsertLibraryMediaFile({
    trackId: otherTrack.id, albumId: otherAlbum.id, source: "aurral",
    path: otherPath, format: "flac", available: true,
  });
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

function readZip(bytes) {
  return JSON.parse(execFileSync("python3", ["-c", [
    "import sys, io, zipfile, json, base64",
    "z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))",
    "assert z.testzip() is None",
    "print(json.dumps({n: base64.b64encode(z.read(n)).decode() for n in z.namelist()}))",
  ].join("\n")], { input: bytes, encoding: "utf8" }));
}

const selectionRequest = (selection, options = {}) => authenticated("/api/library/bulk-download", {
  method: "POST",
  body: new URLSearchParams({ tracks: JSON.stringify(selection) }),
  ...options,
});

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

test("album ZIP contains original files, unique names and a missing-track note", async () => {
  const response = await authenticated(`/api/library/album-download/${album.id}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /attachment;.*\.zip/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("x-aurral-track-count"), "2");
  assert.equal(response.headers.get("x-aurral-missing-count"), "1");
  const files = readZip(Buffer.from(await response.arrayBuffer()));
  const names = Object.keys(files).filter((name) => name !== "download-notes.json");
  assert.equal(names.length, 2);
  assert.equal(new Set(names).size, 2);
  assert.ok(names.every((name) => name.startsWith("Artist/Album/")));
  assert.ok(names.every((name) => !name.split("/").includes("..")));
  const contents = names.map((name) => Buffer.from(files[name], "base64"));
  assert.ok(contents.some((bytes) => bytes.equals(audio)));
  assert.ok(contents.some((bytes) => bytes.equals(Buffer.from("second-original-file"))));
  const notes = JSON.parse(Buffer.from(files["download-notes.json"], "base64"));
  assert.equal(notes.downloaded, 2);
  assert.deepEqual(notes.missing.map((item) => item.title), ["Missing track"]);
  assert.ok(!JSON.stringify(notes).includes(state.baseDir));
});

test("bulk selection is deduplicated and exports only selected tracks", async () => {
  const chosen = { albumId: album.id, trackId: secondTrack.id };
  const response = await selectionRequest([chosen, chosen]);
  assert.equal(response.status, 200);
  const files = readZip(Buffer.from(await response.arrayBuffer()));
  const names = Object.keys(files).filter((name) => name !== "download-notes.json");
  assert.equal(names.length, 1);
  assert.deepEqual(Buffer.from(files[names[0]], "base64"), Buffer.from("second-original-file"));
});

test("tracks across albums keep separate folders and sanitize metadata paths", async () => {
  const response = await selectionRequest([
    { albumId: album.id, trackId: track.id },
    { albumId: otherAlbum.id, trackId: otherTrack.id },
  ]);
  assert.equal(response.status, 200);
  const files = readZip(Buffer.from(await response.arrayBuffer()));
  const names = Object.keys(files).filter((name) => name !== "download-notes.json");
  assert.equal(names.length, 2);
  assert.ok(names.every((name) => !name.startsWith("/") && !name.includes("\\")));
  assert.ok(names.every((name) => !name.split("/").includes("..")));
  assert.ok(names.some((name) => name.startsWith("Artist/Album/")));
  assert.ok(names.some((name) => name.startsWith("Artist/.._Other_Album/")));
});

test("bulk downloads reject anonymous, invalid and expired sessions", async () => {
  for (const url of [
    `/api/library/album-download/${album.id}`,
    `/api/library/album-download/${album.id}?token=${expiredToken}`,
    "/api/library/bulk-download",
    "/api/library/bulk-download?token=invalid",
  ]) {
    const response = await request(url, url.includes("bulk-download") ? {
      method: "POST", body: new URLSearchParams({ tracks: "[]" }),
    } : {});
    assert.equal(response.status, 401);
    await response.arrayBuffer();
  }
});

test("invalid, empty and excessive selections return clear errors before streaming", async () => {
  for (const [selection, status] of [
    [[], 400],
    [null, 400],
    [[{ albumId: "../../etc", trackId: track.id }], 400],
    [[{ albumId: album.id, trackId: 999999999 }], 404],
    [[{ albumId: otherAlbum.id, trackId: track.id }], 404],
    [Array.from({ length: 501 }, () => ({ albumId: album.id, trackId: track.id })), 413],
    [[{ albumId: album.id, trackId: missingTrack.id }], 404],
  ]) {
    const response = await selectionRequest(selection);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("content-disposition"), null);
    assert.ok((await response.json()).error);
  }
  const malformed = await authenticated("/api/library/bulk-download", {
    method: "POST", body: new URLSearchParams({ tracks: "{invalid" }),
  });
  assert.equal(malformed.status, 400);
});

test("unknown albums return 404", async () => {
  const response = await authenticated("/api/library/album-download/999999999");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Album not found" });
});

test("album file list returns authenticated download identities without filesystem paths", async () => {
  const response = await authenticated(`/api/library/album-files/${album.id}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.files.length, 2);
  assert.deepEqual(body.files.map((file) => file.downloadPath).sort(), [
    `/library/canonical-download/${album.id}/${track.id}`,
    `/library/canonical-download/${album.id}/${secondTrack.id}`,
  ].sort());
  assert.ok(body.files.every((file) => file.filename === filename));
  assert.deepEqual(body.missing.map((item) => item.title), ["Missing track"]);
  assert.ok(!JSON.stringify(body).includes(state.baseDir));
});

test("selected file list accepts the browser JSON request and deduplicates tracks", async () => {
  const response = await request("/api/library/bulk-files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tracks: [
      { albumId: album.id, trackId: secondTrack.id },
      { albumId: album.id, trackId: secondTrack.id },
      { albumId: otherAlbum.id, trackId: otherTrack.id },
    ] }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.files.length, 2);
  for (const file of body.files) {
    const downloaded = await authenticated(`/api${file.downloadPath}`);
    assert.equal(downloaded.status, 200);
    await downloaded.arrayBuffer();
  }
});

test("normal album and bulk file lists require a valid session", async () => {
  for (const url of [
    `/api/library/album-files/${album.id}`,
    `/api/library/album-files/${album.id}?token=${expiredToken}`,
    "/api/library/bulk-files",
  ]) {
    const response = await request(url, url.includes("bulk-files") ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"tracks":[]}',
    } : {});
    assert.equal(response.status, 401);
    await response.arrayBuffer();
  }
});

test("cancelling a large ZIP leaves the server able to serve subsequent downloads", async () => {
  const largePath = path.join(state.baseDir, "cancel-test.flac");
  await writeFile(largePath, "");
  await truncate(largePath, 32 * 1024 * 1024);
  const largeTrack = store.upsertLibraryTrack({
    identityKey: "export-cancel-track", title: "Cancel test", artistName: "Artist",
  });
  store.linkLibraryAlbumTrack({ albumId: otherAlbum.id, trackId: largeTrack.id, trackNumber: 2 });
  store.upsertLibraryMediaFile({
    trackId: largeTrack.id, albumId: otherAlbum.id, source: "aurral",
    path: largePath, format: "flac", available: true,
  });
  const abort = new AbortController();
  const response = await selectionRequest([{ albumId: otherAlbum.id, trackId: largeTrack.id }], {
    signal: abort.signal,
  });
  assert.equal(response.status, 200);
  abort.abort();
  const next = await authenticated(canonicalPath());
  assert.equal(next.status, 200);
  assert.deepEqual(Buffer.from(await next.arrayBuffer()), audio);
});

test("a deleted indexed file returns a clean 404 without leaking filesystem paths", async () => {
  await unlink(filePath);
  const response = await authenticated(canonicalPath());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Track file missing" });
  assert.equal(response.headers.get("content-disposition"), null);
});
