import { Download, FileArchive } from "lucide-react";

export default function TrackDownloadToolbar({ count, disabled, downloadingFiles, onSelectAll, onClear, onDownload, onDownloadFiles }) {
  return (
    <div className="native-library-download-toolbar" role="group" aria-label="Bulk downloads">
      <button type="button" className="btn btn-surface btn-sm" onClick={onSelectAll} disabled={disabled}>
        Select available tracks
      </button>
      <button type="button" className="btn btn-surface btn-sm" onClick={onDownloadFiles} disabled={!count || downloadingFiles}>
        <Download aria-hidden="true" /> {downloadingFiles ? "Starting file downloads…" : `Save selected files (${count})`}
      </button>
      <button type="button" className="btn btn-surface btn-sm" onClick={onDownload} disabled={!count}>
        <FileArchive aria-hidden="true" /> Save selected ZIP ({count})
      </button>
      {count > 0 ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>Clear selection</button>
      ) : null}
    </div>
  );
}
