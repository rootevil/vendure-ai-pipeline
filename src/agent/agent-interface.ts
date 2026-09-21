/** Agent adapter interface façade. */
export type { AgentAdapter, AgentRunOutcome, AgentResultEnvelope } from './agent-adapter.js';
export { agentOutcome, NoopAgentAdapter } from './agent-adapter.js';
export {
  buildAgentRequest,
  type AgentRequest,
  type AgentReport,
} from './agent-request.js';
