/**
 * Built-in Microsoft public client ID for device code flow.
 *
 * This is the well-known "Microsoft Graph Command Line Tools" application
 * (App ID: 14d82eec-204b-4c2f-b7e8-296a70dab67e). It is a Microsoft-owned
 * first-party public client that supports the OAuth 2.0 device authorization
 * grant flow against Microsoft Graph without requiring users to register
 * their own Azure AD application.
 *
 * Users can sign in with any Microsoft work, school, or personal account.
 * The client supports delegated scopes including Mail.Read, Mail.ReadWrite,
 * Files.Read, offline_access, openid, and profile.
 *
 * If a user has configured their own AZURE_AD_CLIENT_ID (or equivalent),
 * that value takes precedence over this built-in default.
 */
export const BUILTIN_MICROSOFT_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
export const BUILTIN_MICROSOFT_TENANT_ID = "common";

/**
 * Default Graph API scopes for the device code flow.
 * These are delegated permissions — the user consents to them at login time.
 */
export const MICROSOFT_GRAPH_SCOPES = [
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Files.Read",
  "https://graph.microsoft.com/Files.Read.All",
  "offline_access",
  "openid",
  "profile",
  "email",
];

/**
 * Resolves the effective Microsoft client ID.
 *
 * Priority:
 *   1. Environment variable AZURE_AD_CLIENT_ID / AZURE_CLIENT_ID / MICROSOFT_CLIENT_ID
 *   2. App config file (config.graph.clientId)
 *   3. Built-in Microsoft Graph Command Line Tools public client
 *
 * @param configuredId — the ID from env vars or config file (may be empty)
 * @returns the client ID to use for authentication
 */
export function resolveMicrosoftClientId(configuredId?: string): string {
  if (configuredId && configuredId.trim()) return configuredId.trim();
  return BUILTIN_MICROSOFT_CLIENT_ID;
}

/**
 * Resolves the effective Microsoft tenant ID.
 *
 * Priority:
 *   1. Environment variable AZURE_AD_TENANT_ID / AZURE_TENANT_ID / MICROSOFT_TENANT_ID
 *   2. App config file (config.graph.tenantId)
 *   3. "common" (allows any Microsoft account type)
 *
 * @param configuredTenant — the tenant from env vars or config file (may be empty)
 * @returns the tenant ID to use for authentication
 */
export function resolveMicrosoftTenantId(configuredTenant?: string): string {
  if (configuredTenant && configuredTenant.trim()) return configuredTenant.trim();
  return BUILTIN_MICROSOFT_TENANT_ID;
}
