export const MAX_PORTABLE_PROJECT_TEXT_BYTES = 10 * 1024 * 1024;
export const MAX_PROJECT_BUNDLE_BYTES = 25 * 1024 * 1024;
export const MAX_ASSOCIATED_SETTINGS_TEXT_BYTES = 5 * 1024 * 1024;

export const readBrowserFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });

export const readBrowserFileAsUint8Array = (file: File): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error(`Expected binary data for ${file.name}.`));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(file);
  });

const downloadBlob = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const saveBrowserTextFile = async (
  name: string,
  text: string,
  pickerTypes: Array<{ description: string; accept: Record<string, string[]> }>,
): Promise<boolean> => {
  const picker = (window as Window & {
    showSaveFilePicker?: (_options: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (_content: string) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: pickerTypes,
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return true;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return false;
    }
  }
  downloadBlob(name, new Blob([text], { type: 'application/json' }));
  return true;
};

export const saveBrowserBinaryFile = async (
  name: string,
  bytes: Uint8Array,
  pickerTypes: Array<{ description: string; accept: Record<string, string[]> }>,
): Promise<boolean> => {
  const binaryBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const picker = (window as Window & {
    showSaveFilePicker?: (_options: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (_content: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: pickerTypes,
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([binaryBuffer], { type: 'application/zip' }));
      await writable.close();
      return true;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return false;
    }
  }
  downloadBlob(name, new Blob([binaryBuffer], { type: 'application/zip' }));
  return true;
};

export const assertBrowserFileSize = (
  file: File,
  maxBytes: number,
  label: string,
): void => {
  if (file.size <= maxBytes) return;
  throw new Error(
    `${label} is too large (${Math.round(file.size / 1024)} KB > ${Math.round(maxBytes / 1024)} KB limit).`,
  );
};
