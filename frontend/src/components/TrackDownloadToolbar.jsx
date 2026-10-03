import { Download } from "lucide-react";

export default function TrackDownloadToolbar({ count, disabled, onSelectAll, onClear, onDownload }) {
  return (
    <div className="native-library-download-toolbar" role="group" aria-label="Bulk downloads">
      <button type="button" className="btn btn-surface btn-sm" onClick={onSelectAll} disabled={disabled}>
        Select available tracks
      </button>
      <button type="button" className="btn btn-surface btn-sm" onClick={onDownload} disabled={!count}>
        <Download aria-hidden="true" /> Save selected ZIP ({count})
      </button>
      {count > 0 ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>Clear selection</button>
      ) : null}
    </div>
  );
}
