/// <reference types="vite/client" />

// Extra build-time variables injected by scripts/deploy-web.sh.
interface ImportMetaEnv {
  /** Base URL of the replay upload API (terraform output upload_api_url).
   *  When empty the "Upload replay" button is hidden entirely. */
  readonly VITE_UPLOAD_API_URL?: string;
}
