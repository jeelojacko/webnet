// Exam Prep Locate — platform-neutral picker window/event bridge (Phase 3G).
//
// Single seam deciding how the sprint tab (parent) and the picker tab (child)
// talk. Browser hosts keep the existing transport EXACTLY: `window.open` +
// token/sprint-scoped BroadcastChannel. The Tauri desktop runtime uses native
// WebviewWindow + typed window events and never touches `window.open` or
// BroadcastChannel. No Rust domain logic, no duplicate Study UI/routes — the
// child window loads the same Study Library/picker path; only the transport
// differs. Tauri failures are explicit (`'error'` / `{ opened: false }`),
// never a silent fallback to the browser path.

import {
  buildExamPrepLocatePickerPath,
  isExamPrepLocatePickerControlMessage,
  isExamPrepLocatePickMessage,
  postExamPrepLocatePickerControl,
  postExamPrepLocatePick,
  subscribeExamPrepLocatePickerControl,
  subscribeExamPrepLocatePicks,
  type ExamPrepLocatePickerControlMessage,
  type ExamPrepLocatePickMessage,
} from './examPrepLocatePicker';
import { openStudyUrlNewTab } from '../studyWindow';
import { resolveStudyStoragePlatform } from '../studyStoragePlatform';

/** Stable single picker window label (one persistent picker per sprint). */
export const LOCATE_PICKER_WINDOW_LABEL = 'study-locate-picker';

/** Main sprint window label (pick/ready events target it). */
export const LOCATE_MAIN_WINDOW_LABEL = 'main';

/** Typed Tauri event names (parent <-> child). Payloads reuse the guards below. */
export const LOCATE_TAURI_PICK_EVENT = 'webnet-study-locate-pick';
export const LOCATE_TAURI_CONTROL_EVENT = 'webnet-study-locate-control';

export type LocatePickerRequest = { prompt: string; token: string; sprintId: string };
export type LocatePick = { documentId: string; sourceKey: string | null };
export type LocatePostResult = 'sent' | 'unsupported' | 'error';
export type LocateOpenResult = { opened: true } | { opened: false; error: string };

/** Minimal injectable Tauri surface (mocked in tests; lazy real import below). */
export type LocateTauriWindow = {
  setFocus: () => Promise<void>;
  close: () => Promise<void>;
};

export type LocateTauriDeps = {
  getByLabel: (_label: string) => Promise<LocateTauriWindow | null>;
  create: (_label: string, _url: string) => Promise<LocateTauriWindow>;
  emitTo: (_target: string, _event: string, _payload: unknown) => Promise<void>;
  listen: (_event: string, _handler: (_payload: unknown) => void) => Promise<() => void>;
};

type WebviewWindowModule = {
  WebviewWindow: {
    getByLabel: (_label: string) => Promise<{
      setFocus: () => Promise<void>;
      close: () => Promise<void>;
    } | null>;
    new (_label: string, _options?: unknown): {
      setFocus: () => Promise<void>;
      close: () => Promise<void>;
    };
  };
};

type TauriEventModule = {
  emitTo: (_target: string, _event: string, _payload?: unknown) => Promise<void>;
  listen: <T>(_event: string, _handler: (_event: { payload: T }) => void) => Promise<() => void>;
};

// Lazy real Tauri bindings (desktop runtime only). Variable specifiers keep
// bundlers from statically pulling `@tauri-apps/api` into browser bundles.
const loadTauriDeps = async (): Promise<LocateTauriDeps> => {
  const [windowMod, eventMod] = await Promise.all([
    import(/* @vite-ignore */ '@tauri-apps/api/webviewWindow') as Promise<WebviewWindowModule>,
    import(/* @vite-ignore */ '@tauri-apps/api/event') as Promise<TauriEventModule>,
  ]);
  return {
    getByLabel: (label) => windowMod.WebviewWindow.getByLabel(label),
    create: async (label, url) => {
      // `new WebviewWindow` reports only synchronous construction errors to
      // this try/catch. An asynchronous native creation failure surfaces on
      // the next IPC round-trip instead — `openPicker` already maps the
      // follow-up `emitTo` rejection to `{ opened: false }`, so a failed
      // creation is never reported as success; there is no awaitable
      // creation receipt to check beyond that without a native plugin.
      const created = new windowMod.WebviewWindow(label, {
        url,
        title: 'Locate Picker',
        width: 1100,
        height: 800,
      });
      return created;
    },
    emitTo: (target, event, payload) => eventMod.emitTo(target, event, payload),
    listen: (event, handler) =>
      eventMod.listen<unknown>(event, (wrapped) => handler(wrapped.payload)),
  };
};

let cachedTauriDeps: Promise<LocateTauriDeps> | null = null;
const defaultTauriDeps = (): Promise<LocateTauriDeps> =>
  (cachedTauriDeps ??= loadTauriDeps());

export interface LocateWindowBridge {
  readonly platform: 'browser' | 'tauri';
  openPicker: (_request: LocatePickerRequest) => Promise<LocateOpenResult>;
  closePicker: () => Promise<void>;
  subscribePicks: (
    _token: string,
    _onPick: (_pick: ExamPrepLocatePickMessage) => void,
  ) => () => void;
  postPick: (_token: string, _documentId: string, _sourceKey: string | null) => Promise<LocatePostResult>;
  subscribeControl: (
    _sprintId: string,
    _onMessage: (_message: ExamPrepLocatePickerControlMessage) => void,
  ) => () => void;
  postControlToPicker: (_message: ExamPrepLocatePickerControlMessage) => Promise<LocatePostResult>;
  postControlToParent: (_message: ExamPrepLocatePickerControlMessage) => Promise<LocatePostResult>;
}

const createBrowserBridge = (): LocateWindowBridge => ({
  platform: 'browser',
  openPicker: async (request) => {
    const result = openStudyUrlNewTab(
      buildExamPrepLocatePickerPath(request.prompt, request.token, request.sprintId),
    );
    if (!result.attempted) return { opened: false, error: result.error.message };
    postExamPrepLocatePickerControl({
      type: 'picker-context',
      sprintId: request.sprintId,
      token: request.token,
      prompt: request.prompt,
    });
    return { opened: true };
  },
  closePicker: async () => undefined,
  subscribePicks: (token, onPick) => subscribeExamPrepLocatePicks(token, onPick),
  postPick: async (token, documentId, sourceKey) =>
    postExamPrepLocatePick(token, documentId, sourceKey),
  subscribeControl: (sprintId, onMessage) =>
    subscribeExamPrepLocatePickerControl(sprintId, onMessage),
  postControlToPicker: async (message) => postExamPrepLocatePickerControl(message),
  postControlToParent: async (message) => postExamPrepLocatePickerControl(message),
});

const contextMessage = (
  request: LocatePickerRequest,
): ExamPrepLocatePickerControlMessage => ({
  type: 'picker-context',
  sprintId: request.sprintId,
  token: request.token,
  prompt: request.prompt,
});

const subscribeTauri = (
  deps: LocateTauriDeps | Promise<LocateTauriDeps>,
  event: string,
  isWanted: (_payload: unknown) => boolean,
  onMessage: (_payload: Extract<unknown, unknown>) => void,
): (() => void) => {
  let settled = false;
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  Promise.resolve(deps)
    .then((resolved) =>
      resolved.listen(event, (payload) => {
        if (cancelled || !isWanted(payload)) return;
        onMessage(payload);
      }),
    )
    .then((stop) => {
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
      settled = true;
    })
    // Registration runs after return, so a failure cannot throw to the
    // caller; surface it on the console (namespaced) instead of dropping it.
    .catch((error) => {
      console.error(`Study Locate Tauri listener for ${event} failed to register:`, error);
    });
  return () => {
    cancelled = true;
    if (settled && unlisten) {
      const stop = unlisten;
      unlisten = null;
      stop();
    }
  };
};

export const createTauriLocateWindowBridge = (
  deps: LocateTauriDeps | Promise<LocateTauriDeps>,
): LocateWindowBridge => {
  const resolve = () => Promise.resolve(deps);
  return {
    platform: 'tauri',
    openPicker: async (request) => {
      // Stable single picker window: reuse + focus when it exists, create
      // once when it does not. The child loads the SAME Study picker route
      // (native Study composition) — context rides in the URL and is also
      // pushed over the control event for the mount race. No window.open.
      try {
        const api = await resolve();
        const url = buildExamPrepLocatePickerPath(
          request.prompt,
          request.token,
          request.sprintId,
        );
        const existing = await api.getByLabel(LOCATE_PICKER_WINDOW_LABEL);
        if (existing) {
          console.info('[study][locate] picker reused and focused');
          await existing.setFocus();
        } else {
          console.info('[study][locate] picker created');
          await api.create(LOCATE_PICKER_WINDOW_LABEL, url);
        }
        await api.emitTo(
          LOCATE_PICKER_WINDOW_LABEL,
          LOCATE_TAURI_CONTROL_EVENT,
          contextMessage(request),
        );
        return { opened: true };
      } catch (error) {
        console.error('[study][locate] picker open failed', error);
        return {
          opened: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    closePicker: async () => {
      try {
        const api = await resolve();
        const existing = await api.getByLabel(LOCATE_PICKER_WINDOW_LABEL);
        if (existing) {
          await existing.close();
          console.info('[study][locate] picker closed');
        }
      } catch {
        console.warn('[study][locate] picker close failed');
        // Close is best-effort teardown; open/post surface errors instead.
      }
    },
    subscribePicks: (token, onPick) =>
      subscribeTauri(
        deps,
        LOCATE_TAURI_PICK_EVENT,
        (payload): payload is ExamPrepLocatePickMessage =>
          isExamPrepLocatePickMessage(payload) && payload.token === token,
        (payload) => onPick(payload as ExamPrepLocatePickMessage),
      ),
    postPick: async (token, documentId, sourceKey) => {
      try {
        const api = await resolve();
        await api.emitTo(LOCATE_MAIN_WINDOW_LABEL, LOCATE_TAURI_PICK_EVENT, {
          type: 'study-locate-pick',
          token,
          documentId,
          sourceKey,
        });
        return 'sent';
      } catch {
        return 'error';
      }
    },
    subscribeControl: (sprintId, onMessage) =>
      subscribeTauri(
        deps,
        LOCATE_TAURI_CONTROL_EVENT,
        (payload): payload is ExamPrepLocatePickerControlMessage =>
          isExamPrepLocatePickerControlMessage(payload) && payload.sprintId === sprintId,
        (payload) => onMessage(payload as ExamPrepLocatePickerControlMessage),
      ),
    postControlToPicker: async (message) => {
      try {
        const api = await resolve();
        await api.emitTo(LOCATE_PICKER_WINDOW_LABEL, LOCATE_TAURI_CONTROL_EVENT, message);
        return 'sent';
      } catch {
        return 'error';
      }
    },
    postControlToParent: async (message) => {
      try {
        const api = await resolve();
        await api.emitTo(LOCATE_MAIN_WINDOW_LABEL, LOCATE_TAURI_CONTROL_EVENT, message);
        return 'sent';
      } catch {
        return 'error';
      }
    },
  };
};

/** Platform-neutral entry: browser keeps window.open+BroadcastChannel, Tauri goes native. */
export const resolveLocateWindowBridge = (
  tauriDeps?: LocateTauriDeps | Promise<LocateTauriDeps>,
): LocateWindowBridge =>
  resolveStudyStoragePlatform() === 'tauri'
    ? createTauriLocateWindowBridge(tauriDeps ?? defaultTauriDeps())
    : createBrowserBridge();

export type { ExamPrepLocatePickMessage, ExamPrepLocatePickerControlMessage };
export type LocatePickMessage = ExamPrepLocatePickMessage;
