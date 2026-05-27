export type AppConfig = {
  nodeEnv: string;
  port: number;
  appOrigin: string;
  sqlitePath: string;
  sessionCookieName: string;
  oidcProvider: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcRedirectUri?: string;
  openAiApiKey?: string;
  openAiModel: string;
};

export function getConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 3000),
    appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
    sqlitePath: process.env.SQLITE_PATH ?? ".data/judged-by-ai.sqlite",
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "jba_session",
    oidcProvider: process.env.OIDC_PROVIDER ?? "authentik",
    oidcIssuer: process.env.OIDC_ISSUER,
    oidcClientId: process.env.OIDC_CLIENT_ID,
    oidcClientSecret: process.env.OIDC_CLIENT_SECRET,
    oidcRedirectUri: process.env.OIDC_REDIRECT_URI,
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  };
}
