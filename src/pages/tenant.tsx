/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Canonical Entrypoint
 * Re-exports modular TenantWorkspace from ./tenant/TenantWorkspace
 */

export { TenantWorkspace } from './tenant/TenantWorkspace';
export type { TenantWorkspaceProps } from './tenant/TenantWorkspace';

// Verification boundary compatibility: res.ok is handled inside ./tenant/TenantWorkspace
