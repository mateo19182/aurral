import path from "node:path";
import express from "express";
import { noCache } from "../../../middleware/cache.js";
import { verifyTokenAuth } from "../../../middleware/auth.js";
import { resolveCanonicalTrackPath } from "../../../services/canonicalLibraryReadAdapter.js";
import { libraryManager } from "../../../services/libraryManager.js";
import {
  FileExportError,
  prepareAlbumArchive,
  prepareSelectionArchive,
  streamTrackArchive,
} from "../../../services/libraryFileExportService.js";

// Use the same album/track lookup as playback. Never accept a filesystem path
// from the client, and allow ordinary signed-in users to save original files.
export function registerFileExports(router) {
  const requireDownloadUser = (req, res, next) => {
    if (!verifyTokenAuth(req) || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return next();
  };
  const sendArchive = (prepare) => async (req, res) => {
    try {
      await streamTrackArchive(res, await prepare(req));
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const status = error instanceof FileExportError ? error.status : 500;
      res.status(status).json({ error: status === 500 ? "Download failed" : error.message });
    }
  };
  router.get("/album-download/:albumId", noCache, requireDownloadUser,
    sendArchive((req) => prepareAlbumArchive(req.params.albumId)));
  router.post("/bulk-download", noCache, requireDownloadUser,
    express.urlencoded({ extended: false, limit: "64kb" }),
    sendArchive((req) => {
      let selection;
      try {
        selection = typeof req.body?.tracks === "string"
          ? JSON.parse(req.body.tracks) : req.body?.tracks;
      } catch {
        throw new FileExportError(400, "Invalid track selection");
      }
      return prepareSelectionArchive(selection);
    }));
  const routes = [
    ["/canonical-download/:albumId/:trackId", (albumId, trackId) =>
      resolveCanonicalTrackPath(albumId, trackId)],
    ["/file-download/:albumId/:trackId", async (albumId, trackId) => {
      const tracks = await libraryManager.getTracks(albumId);
      const track = tracks.find((item) => String(item.id) === String(trackId));
      return track?.hasFile ? track.path : null;
    }],
  ];

  for (const [route, resolvePath] of routes) {
    router.get(route, noCache, requireDownloadUser, async (req, res) => {
      try {
        const filePath = await resolvePath(req.params.albumId, req.params.trackId);
        if (!filePath) return res.status(404).json({ error: "Track file missing" });
        res.download(filePath, path.basename(filePath), (error) => {
          if (!error || res.headersSent || res.destroyed) return;
          const status = error.status === 404 || error.code === "ENOENT" ? 404 : 500;
          res.status(status).json({
            error: status === 404 ? "Track file missing" : "Download failed",
          });
        });
      } catch {
        if (!res.headersSent) res.status(500).json({ error: "Download failed" });
      }
      return undefined;
    });
  }
}
