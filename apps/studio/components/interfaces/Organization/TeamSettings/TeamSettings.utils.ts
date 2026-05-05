import { PermissionAction } from '@supabase/shared-types/out/constants'

import type { OrganizationMember } from '@/data/organizations/organization-members-query'
import { doPermissionsCheck, useGetPermissions } from '@/hooks/misc/useCheckPermissions'
import { IS_PLATFORM } from '@/lib/constants'
import type { Permission, Role } from '@/types'

export const useGetRolesManagementPermissions = (
  orgSlug?: string,
  roles?: Role[],
  permissions?: Permission[]
): { rolesAddable: Number[]; rolesRemovable: Number[] } => {
  const { permissions: allPermissions, organizationSlug } = useGetPermissions(
    permissions,
    orgSlug,
    permissions !== undefined && orgSlug !== undefined
  )

  // Self-hosted: no cloud permission system — all roles are manageable
  if (!IS_PLATFORM) {
    const ids = (roles ?? []).map((r) => r.id as Number)
    return { rolesAddable: ids, rolesRemovable: ids }
  }

  const rolesAddable: Number[] = []
  const rolesRemovable: Number[] = []
  if (!roles || !orgSlug) return { rolesAddable, rolesRemovable }

  roles.forEach((role: Role) => {
    const canAdd = doPermissionsCheck(
      allPermissions,
      PermissionAction.CREATE,
      'auth.subject_roles',
      {
        resource: { role_id: role.id },
      },
      organizationSlug
    )
    if (canAdd) rolesAddable.push(role.id)

    const canRemove = doPermissionsCheck(
      allPermissions,
      PermissionAction.DELETE,
      'auth.subject_roles',
      {
        resource: { role_id: role.id },
      },
      organizationSlug
    )
    if (canRemove) rolesRemovable.push(role.id)
  })

  return { rolesAddable, rolesRemovable }
}

export const hasMultipleOwners = (members: OrganizationMember[] = [], roles: Role[] = []) => {
  const membersWhoAreOwners = members.filter((member) => {
    const [memberRoleId] = member.role_ids ?? []
    const role = roles.find((role: Role) => role.id === memberRoleId)
    return role?.name === 'Owner' && !member.invited_at
  })
  return membersWhoAreOwners.length > 1
}
