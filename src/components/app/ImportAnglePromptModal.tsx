import type { ImportFacePromptChoice, PendingAnglePromptFile } from '../../hooks/useImportReviewWorkflow';
import type { ExternalImportAngleMode } from '../../engine/importers';

interface ImportAnglePromptModalProps {
  pendingFile: PendingAnglePromptFile;
  onSetImportStyle: (_choice: PendingAnglePromptFile['importStyle']) => void;
  onSetAngleMode: (_choice: ExternalImportAngleMode) => void;
  onSetFaceMode: (_choice: ImportFacePromptChoice) => void;
  onCancel: () => void;
  onAccept: () => void;
}

const ImportAnglePromptModal = ({
  pendingFile,
  onSetImportStyle,
  onSetAngleMode,
  onSetFaceMode,
  onCancel,
  onAccept,
}: ImportAnglePromptModalProps) => {
  const industryStyle = pendingFile.importStyle === 'industry-style';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 px-4 py-6">
      <div className="w-full max-w-md border border-slate-500 bg-slate-900 shadow-2xl">
        <div className="border-b border-slate-700 bg-slate-800 px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
            Import Settings
          </div>
          <div className="mt-1 text-lg font-semibold text-white">Choose JXL Import Handling</div>
          <div className="mt-1 text-xs text-slate-400">{pendingFile.file.name}</div>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm text-slate-200">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">
              Import Style
            </div>
            <div className="mt-2 space-y-3">
              <ImportChoiceButton
                active={pendingFile.importStyle === 'generic'}
                onClick={() => onSetImportStyle('generic')}
                label="Generic"
                description="Keep current WebNet-style grouped import flow and serializer behavior."
              />
              <ImportChoiceButton
                active={industryStyle}
                onClick={() => onSetImportStyle('industry-style')}
                label="Industry Style"
                description="Preserve raw JobXML fieldbook HZ, zenith, corrected slope distance, and round-based `DB/DM/DE` blocks."
              />
            </div>
            {industryStyle && (
              <div className="mt-2 text-xs text-amber-300">
                Industry Style is fixed mode: raw fieldbook order, raw circles, and no face-split
                prompt options.
              </div>
            )}
          </div>
          <ImportChoiceButton
            active={pendingFile.angleMode === 'raw'}
            disabled={industryStyle}
            onClick={() => onSetAngleMode('raw')}
            label="Raw Angles"
            description="Keep imported angle values as-is from the source file."
          />
          <ImportChoiceButton
            active={pendingFile.angleMode === 'reduced'}
            disabled={industryStyle}
            onClick={() => onSetAngleMode('reduced')}
            label="Reduced Angles (BS = 0)"
            description="Use reduced-angle workflow with backsight-zero direction-set shaping."
          />
          <div className="border-t border-slate-700 pt-3">
            <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">
              Face Treatment
            </div>
            <div className="mt-2 space-y-3">
              <ImportChoiceButton
                active={pendingFile.faceMode === 'on'}
                disabled={industryStyle}
                onClick={() => onSetFaceMode('on')}
                label="Normalized Behavior"
                description="Keep one logical direction set and normalize reliable face-II shots to face-I."
              />
              <ImportChoiceButton
                active={pendingFile.faceMode === 'off'}
                disabled={industryStyle}
                onClick={() => onSetFaceMode('off')}
                label="Split Behavior"
                description="Split reliable face-I and face-II shots into separate direction-set blocks."
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-slate-700 bg-slate-800 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="border border-slate-500 bg-slate-700 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="ml-2 border border-cyan-500 bg-cyan-900/40 px-4 py-2 text-xs uppercase tracking-wide text-cyan-100 hover:bg-cyan-800/60"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};

interface ImportChoiceButtonProps {
  active: boolean;
  label: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}

const ImportChoiceButton = ({
  active,
  label,
  description,
  disabled = false,
  onClick,
}: ImportChoiceButtonProps) => (
  <div>
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full border px-3 py-3 text-left text-xs uppercase tracking-wide ${
        disabled
          ? 'cursor-not-allowed border-slate-800 bg-slate-950 text-slate-500'
          : active
          ? 'border-cyan-500 bg-cyan-900/40 text-cyan-100'
          : 'border-slate-600 bg-slate-950 text-slate-100 hover:border-cyan-400'
      }`}
    >
      {label}
    </button>
    <div className="mt-1 text-xs text-slate-400">{description}</div>
  </div>
);

export default ImportAnglePromptModal;
