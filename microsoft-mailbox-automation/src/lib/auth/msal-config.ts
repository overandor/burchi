import { Configuration } from "@azure/msal-browser";
import { normalizeOrigin } from "@/lib/utils";

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function getMsalConfig(clientId: string, tenantId: string): Configuration {
  const effectiveClientId = clientId || "00000000-0000-0000-0000-000000000000"; // placeholder — set AZURE_AD_CLIENT_ID env var or configure in Settings

  if (!clientId || !UUID_REGEX.test(clientId)) {
    console.warn("[msal-config] Warning: client ID is missing or not a valid UUID format. Authentication will not work until a valid client ID is configured.");
  }

  return {
    auth: {
      clientId: effectiveClientId,
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
