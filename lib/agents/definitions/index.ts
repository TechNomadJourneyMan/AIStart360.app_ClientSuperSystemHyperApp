/**
 * Built-in agents. Importing this module registers them (see registry.ts).
 * Order does not matter; keys must be unique.
 */
import { registerAgent } from '../registry'
import { documentIntelligenceAgent } from './document-intelligence'
import { documentReaperAgent } from './document-reaper'
import { monitoringAgent } from './monitoring'

registerAgent(monitoringAgent)
registerAgent(documentIntelligenceAgent)
registerAgent(documentReaperAgent)
