/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BABEL_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
