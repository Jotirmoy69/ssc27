/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_ADMIN_EMAIL?: string;
  readonly VITE_ADMIN_EMAIL_1?: string;
  readonly VITE_ADMIN_EMAIL_2?: string;
  readonly VITE_ADMIN_EMAIL_3?: string;
  readonly VITE_ADMIN_EMAIL_4?: string;
  readonly VITE_ADMIN_EMAIL_5?: string;
  readonly VITE_ADMIN_EMAIL_6?: string;
  readonly VITE_ADMIN_EMAIL_7?: string;
  readonly VITE_ADMIN_EMAIL_8?: string;
  readonly VITE_ADMIN_EMAIL_9?: string;
  readonly VITE_ADMIN_EMAIL_10?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
