import { buildAuthenticatedApiUrl, getData, postData } from "./api/core.js";

export const MAX_ARCHIVE_TRACKS = 500;

export const getAlbumDownloadFiles = (albumId) =>
  getData(`/library/album-files/${encodeURIComponent(albumId)}`);

export const getSelectedDownloadFiles = (tracks) =>
  postData("/library/bulk-files", { tracks });

export async function saveFilesIndividuallyToDevice(files) {
  for (const [index, file] of files.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    const link = document.createElement("a");
    link.href = buildAuthenticatedApiUrl(file.downloadPath);
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

export function saveAlbumZipToDevice(albumId) {
  saveTrackToDevice(buildAuthenticatedApiUrl(`/library/album-download/${encodeURIComponent(albumId)}`));
}

export function saveSelectedTracksZipToDevice(tracks) {
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
