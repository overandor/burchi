import { Configuration } from "@azure/msal-browser";
import { normalizeOrigin } from "@/lib/utils";
import {
  resolveMicrosoftClientId,
  resolveMicrosoftTenantId,
  BUILTIN_MICROSOFT_CLIENT_ID,
  BUILTIN_MICROSOFT_TENANT_ID,
} from "@/lib/auth/microsoft-public-client";

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function getMsalConfig(clientId: string, tenantId: string): Configuration {
  // Use the built-in Microsoft Graph Command Line Tools public client as default
  const effectiveClientId = resolveMicrosoftClientId(clientId);
  const effectiveTenantId = resolveMicrosoftTenantId(tenantId);

  if (!UUID_REGEX.test(effectiveClientId)) {
    console.warn("[msal-config] Warning: client ID is not a valid UUID format. Authentication may not work.");
  }

  return {
    auth: {
      clientId: effectiveClientId,
      authority: `https://login.microsoftonline.com/${effectiveTenantId}`,
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
  "Files.Read.All",
  "offline_access",
];

export { BUILTIN_MICROSOFT_CLIENT_ID, BUILTIN_MICROSOFT_TENANT_ID };
