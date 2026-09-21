import type { TaskDefinition } from '../models/types.js';
import type { BusinessTaskCard } from './business-task-card.js';
import { compileTechnicalScenario } from './compile-technical-scenario.js';
import { technicalScenarioToTaskDefinition } from './technical-scenario-to-task.js';
import type { TechnicalScenario } from './technical-scenario.js';

/**
 * Expand a business task card into a runnable TaskDefinition
 * via the client-shaped technical scenario.
 */
export function compileBusinessTaskCard(card: BusinessTaskCard): TaskDefinition {
  const technical = compileTechnicalScenario(card);
  return technicalScenarioToTaskDefinition(technical);
}

export function compileBusinessTaskCardToTechnical(card: BusinessTaskCard): TechnicalScenario {
  return compileTechnicalScenario(card);
}
