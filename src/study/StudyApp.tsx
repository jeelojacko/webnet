// Transitional browser entry for the `/study` route.
//
// The Study application now lives in `study-desktop/src/` (one source of
// truth for the standalone Tauri desktop app). This shim keeps the browser
// route working unchanged until the route migrates off the host bundle.
export { default } from '../../study-desktop/src/StudyApp';
