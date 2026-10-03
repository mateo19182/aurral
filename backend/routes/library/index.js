import { registerStream } from "./handlers/stream.js";
import { registerArtists } from "./handlers/artists.js";
import { registerAlbums } from "./handlers/albums.js";
import { registerTracks } from "./handlers/tracks.js";
import { registerDownloads } from "./handlers/downloads.js";
import { registerMisc } from "./handlers/misc.js";
import { registerCanonical } from "./handlers/canonical.js";
import { registerFileExports } from "./handlers/fileExports.js";
import mountRoutes from "../shared/mountRoutes.js";

export default mountRoutes([
  registerCanonical,
  registerStream,
  registerArtists,
  registerAlbums,
  registerTracks,
  registerFileExports,
  registerDownloads,
  registerMisc,
]);
