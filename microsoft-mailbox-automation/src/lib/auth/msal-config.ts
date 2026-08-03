import { Configuration } from "@azure/msal-browser";
import { normalizeOrigin } from "@/lib/utils";

export function getMsalConfig(clientId: string, tenantId: string): Configuration {
  return {
    auth: {
      clientId: clientId || "00000000-0000-0000-0000-000000000000",
      authority: `https://login.microsoftonline.com/${tenantId || "common"}`,
      redirectUri: typeof window !== "undefined" ? normalizeOrigin(window.location.origin) : "",
    },
    cache: {
      cacheLocation: "localStorage",
    },
    system: {
      loggerOptions: {
        loggerCallback: (_level: number, message: string) => {
          console.log(`[MSAL] ${message}`);
        },
        logLevel: 3,
      },
    },
  };
}

export const GRAPH_SCOPES = [
  "User.Read",
  "Mail.Read",
  "Mail.ReadWrite",
  "Files.Read",
  "Files.ReadWrite",
  "Files.Read.All",
  "Files.ReadWrite.All",
  "offline_access",
];
