/**
 * (app) route group layout — pass-through.
 *
 * The unified Advantage Foundry shell (GameNav) is rendered by the root
 * layout via AppShell. This file exists only so the route group resolves;
 * it must NOT render a second nav or header.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
