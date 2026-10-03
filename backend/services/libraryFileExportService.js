import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import {
  getCanonicalLibraryForAlbumIds,
  getCanonicalLibraryForTrackIds,
} from "./libraryQueryService.js";
import { resolveCanonicalTrackPath } from "./canonicalLibraryReadAdapter.js";

export const MAX_ARCHIVE_TRACKS = 500;

export class FileExportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function canonicalId(value) {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(id)) {
    throw new FileExportError(400, "Invalid library identity");
  }
  return id;
}

function safeComponent(value, fallback) {
  return String(value || "").normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_")
    .replace(/[. ]+$/g, "").slice(0, 180) || fallback;
}

function uniqueEntryName(name, used) {
  const extension = path.posix.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  let result = name;
  let suffix = 2;
  while (used.has(result.toLowerCase())) result = `${stem} (${suffix++})${extension}`;
  used.add(result.toLowerCase());
  return result;
}

async function prepareArchive(selection, model, name) {
  if (!selection.length) throw new FileExportError(404, "No tracks to download");
  if (selection.length > MAX_ARCHIVE_TRACKS) {
    throw new FileExportError(413, `Select at most ${MAX_ARCHIVE_TRACKS} tracks per download`);
  }
  const albums = new Map(model.albums.map((album) => [album.id, album]));
  const tracks = new Map(model.tracks.map((track) => [track.id, track]));
  const entries = [];
  const missing = [];
  const usedNames = new Set();
  for (const { albumId, trackId } of selection) {
    const album = albums.get(albumId);
    const track = tracks.get(trackId);
    if (!album || !track?.albums.some((relation) => relation.albumId === albumId)) {
      throw new FileExportError(404, "Track not found in album");
    }
    const label = { artist: album.albumArtist, album: album.title, title: track.title };
    const filePath = resolveCanonicalTrackPath(albumId, trackId);
    const fileStat = filePath ? await stat(filePath).catch(() => null) : null;
    if (!fileStat?.isFile()) {
      missing.push(label);
      continue;
    }
    const entryName = [
      safeComponent(album.albumArtist, "Unknown Artist"),
      safeComponent(album.title, "Unknown Album"),
      safeComponent(path.basename(filePath), `Track ${trackId}`),
    ].join("/");
    entries.push({ albumId, trackId, filePath, stat: fileStat, name: uniqueEntryName(entryName, usedNames) });
  }
  if (!entries.length) throw new FileExportError(404, "No available audio files in this selection");
  return { entries, missing, name: `${safeComponent(name, "Music")}.zip` };
}

export async function prepareAlbumArchive(reference) {
  const albumId = canonicalId(reference);
  const model = getCanonicalLibraryForAlbumIds({ ids: [albumId], availableOnly: false });
  const album = model.albums.find((item) => item.id === albumId);
  if (!album) throw new FileExportError(404, "Album not found");
  const selection = model.tracks
    .filter((track) => track.albums.some((relation) => relation.albumId === albumId))
    .map((track) => ({ albumId, trackId: track.id }));
  return prepareArchive(selection, model, `${album.albumArtist} - ${album.title}`);
}

export async function prepareSelectionArchive(value) {
  if (!Array.isArray(value) || !value.length) {
    throw new FileExportError(400, "Select at least one track");
  }
  if (value.length > MAX_ARCHIVE_TRACKS) {
    throw new FileExportError(413, `Select at most ${MAX_ARCHIVE_TRACKS} tracks per download`);
  }
  const unique = new Map();
  for (const item of value) {
    const albumId = canonicalId(item?.albumId);
    const trackId = canonicalId(item?.trackId);
    unique.set(`${albumId}:${trackId}`, { albumId, trackId });
  }
  const selection = [...unique.values()];
  const model = getCanonicalLibraryForTrackIds({ ids: selection.map((item) => item.trackId) });
  return prepareArchive(selection, model, "Selected music");
}

export async function streamTrackArchive(res, archive) {
  const zip = new yazl.ZipFile();
  const activeStreams = new Set();
  const cleanup = () => {
    for (const stream of activeStreams) stream.destroy();
    zip.outputStream.destroy();
  };
  res.once("close", cleanup);
  zip.on("error", (error) => zip.outputStream.destroy(error));
  try {
    for (const entry of archive.entries) {
      zip.addReadStreamLazy(entry.name, {
        compress: false,
        size: entry.stat.size,
        mtime: entry.stat.mtime,
      }, (callback) => {
        if (res.destroyed) return callback(new Error("Download cancelled"));
        const stream = createReadStream(entry.filePath);
        activeStreams.add(stream);
        stream.once("close", () => activeStreams.delete(stream));
        callback(null, stream);
      });
    }
    zip.addBuffer(Buffer.from(JSON.stringify({
      downloaded: archive.entries.length,
      files: archive.entries.map((entry) => entry.name),
      missing: archive.missing,
    }, null, 2)), "download-notes.json");
    res.attachment(archive.name);
    res.set("X-Aurral-Track-Count", String(archive.entries.length));
    res.set("X-Aurral-Missing-Count", String(archive.missing.length));
    // The archive is generated as it is sent. Audio files stay uncompressed,
    // and neither the server nor the browser buffers the whole collection.
    zip.end();
    await pipeline(zip.outputStream, res);
  } finally {
    res.removeListener("close", cleanup);
    cleanup();
  }
}
