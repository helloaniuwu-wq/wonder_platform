export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  APP_NAME: string;
  ENVIRONMENT: string;
  SECRET_KEY?: string;
  JWT_SECRET?: string;
  ACCESS_TOKEN_EXPIRE_MINUTES: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_BASE_URL: string;
  OPENROUTER_VISION_MODEL: string;
  OPENROUTER_DEEPSEEK_MODEL: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL: string;
  DEEPSEEK_MODEL: string;
  RESEND_API_KEY?: string;
  ADMIN_EMAIL?: string;
  CORS_ORIGINS: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_active: number | boolean;
  created_at: string;
  role: string;
  is_verified: number | boolean;
}

export type Variables = {
  user: UserRow;
};
