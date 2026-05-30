import { init } from "@instantdb/react";

export const instantAppId = import.meta.env.VITE_INSTANT_APP_ID as string | undefined;

export const db = instantAppId
  ? init({
      appId: instantAppId,
    })
  : null;
