/** Public API of the Point B model (lib/point-b/model). The IO helpers are in `history.ts` and `load.ts`. */
export { computeModel } from './compute'
export { buildModelInputs, sanitizeHistory, withDerivedActiveBase } from './inputs'
export { determineLevel, templateKeyFor, FUNNEL_TEMPLATES } from './levels'
export { defaultProfiles, normalizeProfiles, PROFILE_KEYS, PROFILE_LIMITS } from './profiles'
export { projectCurrentPace, verdictFor } from './forecast'
export { volatilityBand } from './bands'
export { LEVER_CAPS, solveFunnelScenario, solveGrowthScenario } from './scenarios'
export {
  MODEL_VERSION, ModelInputError,
  type DataLevel, type Forecast, type MissingInput, type ModelGoal, type ModelInputs, type ModelKind, type ModelResult,
  type Origin, type Range, type ScenarioProfile, type ScenarioResult, type Sourced, type TemplateKey, type VerdictKey,
} from './types'
