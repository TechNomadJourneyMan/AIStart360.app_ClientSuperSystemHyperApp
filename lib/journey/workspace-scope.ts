export const STORE_JOURNEY_WORKSPACE_PREFIX = 'store-v2:'

export function isStoreJourneyWorkspace(workspaceId: string): boolean {
  return workspaceId.startsWith(STORE_JOURNEY_WORKSPACE_PREFIX)
}
