import type { ImportReviewModalProps } from './ImportReviewModal.types';

interface ImportReviewModalFooterProps {
  onCancel: ImportReviewModalProps['onCancel'];
  onImport: ImportReviewModalProps['onImport'];
  onImportAsNewFile: ImportReviewModalProps['onImportAsNewFile'];
}

const ImportReviewModalFooter = ({
  onCancel,
  onImport,
  onImportAsNewFile,
}: ImportReviewModalFooterProps) => (
  <div className="flex items-center justify-end gap-2 border-t border-slate-700 bg-slate-800 px-5 py-4">
    <button
      type="button"
      onClick={onCancel}
      className="border border-slate-500 bg-slate-700 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 hover:bg-slate-600"
    >
      Cancel
    </button>
    <button
      type="button"
      onClick={onImport}
      className="border border-cyan-400 bg-cyan-900 px-4 py-2 text-xs uppercase tracking-wide text-cyan-100 hover:bg-cyan-800"
    >
      Import Selected Rows
    </button>
    <button
      type="button"
      onClick={onImportAsNewFile}
      className="border border-emerald-400 bg-emerald-900 px-4 py-2 text-xs uppercase tracking-wide text-emerald-100 hover:bg-emerald-800"
    >
      Import As New File
    </button>
  </div>
);

export default ImportReviewModalFooter;
