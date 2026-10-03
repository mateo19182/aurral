import path from "node:path";
import { noCache } from "../../../middleware/cache.js";
import { verifyTokenAuth } from "../../../middleware/auth.js";
import { resolveCanonicalTrackPath } from "../../../services/canonicalLibraryReadAdapter.js";
import { libraryManager } from "../../../services/libraryManager.js";

// Use the same album/track lookup as playback. Never accept a filesystem path
// from the client, and allow ordinary signed-in users to save original files.
export function registerFileExports(router) {
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
    router.get(route, noCache, async (req, res) => {
      if (!verifyTokenAuth(req) || !req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
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
