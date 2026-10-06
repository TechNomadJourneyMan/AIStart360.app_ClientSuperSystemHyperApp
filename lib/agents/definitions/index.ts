/**
 * Built-in agents. Importing this module registers them (see registry.ts).
 * Order does not matter; keys must be unique.
 */
import { registerAgent } from '../registry'
import { monitoringAgent } from './monitoring'

registerAgent(monitoringAgent)
