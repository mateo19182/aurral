import { buildAuthenticatedApiUrl } from "./api/core.js";

export const MAX_ARCHIVE_TRACKS = 500;

export function saveAlbumToDevice(albumId) {
  saveTrackToDevice(buildAuthenticatedApiUrl(`/library/album-download/${encodeURIComponent(albumId)}`));
}

export function saveSelectedTracksToDevice(tracks) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = buildAuthenticatedApiUrl("/library/bulk-download");
  form.target = "_blank";
  form.rel = "noopener";
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "tracks";
  input.value = JSON.stringify(tracks);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export function getTrackDownloadUrl(streamPath) {
  const match = /^\/library\/(canonical|file)-stream\/([^/?#]+)\/([^/?#]+)$/.exec(
    String(streamPath || ""),
  );
  if (!match) return null;
  return buildAuthenticatedApiUrl(`/library/${match[1]}-download/${match[2]}/${match[3]}`);
}

export function saveTrackToDevice(url) {
  // Let the browser stream the attachment to disk rather than buffering the
  // audio in a Blob. A separate context keeps errors from replacing Aurral.
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
