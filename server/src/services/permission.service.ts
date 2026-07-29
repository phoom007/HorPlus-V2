import { RoleEntity, RolePermissions } from '../db/repositories/role.repository.js';

export class PermissionService {
  /**
   * Checks whether a role has permission for a specific module and action.
   */
  public hasPermission(role: RoleEntity, moduleName: string, actionName: string): boolean {
    if (!role || !role.permissions) return false;

    // Owner override
    if (role.code === 'OWNER') return true;

    const perms: RolePermissions = role.permissions as RolePermissions;

    // Check wildcard module '*'
    if (perms['*'] && (perms['*'].includes('*') || perms['*'].includes(actionName))) {
      return true;
    }

    // Check specific module
    const moduleActions = perms[moduleName];
    if (!moduleActions || !Array.isArray(moduleActions)) {
      return false;
    }

    return moduleActions.includes('*') || moduleActions.includes(actionName);
  }
}

export const permissionService = new PermissionService();
