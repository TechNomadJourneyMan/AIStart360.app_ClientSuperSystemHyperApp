/**
 * Built-in agents. Importing this module registers them (see registry.ts).
 * Order does not matter; keys must be unique.
 */
import { registerAgent } from '../registry'
import { documentIntelligenceAgent } from './document-intelligence'
import { documentReaperAgent } from './document-reaper'
import { DIAGNOSTIC_AGENTS } from './diagnostics'
import { monitoringAgent } from './monitoring'
import { reportAgent } from './report'

registerAgent(monitoringAgent)
registerAgent(documentIntelligenceAgent)
registerAgent(documentReaperAgent)
for (const agent of DIAGNOSTIC_AGENTS) registerAgent(agent)
registerAgent(reportAgent)
