/** Public Journey access must be an explicit per-deployment decision. */
export function isJourneyPublicDemoEnabled(
  publicDemo = process.env.NEXT_PUBLIC_JOURNEY_PUBLIC_DEMO,
): boolean {
  return publicDemo === '1'
}
