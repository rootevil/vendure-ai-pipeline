import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { MockAgentAdapter } from '../src/agent/mock-adapter.js';
import { buildAgentRequest } from '../src/agent/agent-request.js';
import type { PipelineConfig } from '../src/config/load-config.js';
import { createLogger } from '../src/logging/logger.js';
import { createExecutionContext } from '../src/safety/execution-context.js';
import { ArtifactPresenceValidator } from '../src/validator/validator.js';
import { minimalTask } from './helpers/minimal-task.js';

function configFor(root: string): PipelineConfig {
  return {
    mode: 'acceptance',
    artifactsDir: join(root, 'artifacts'),
    workspaceDir: join(root, 'workspace', 'runs'),
    maxIdenticalRetries: 2,
    maxTotalAttempts: 3,
    allowNetwork: false,
    logLevel: 'error',
    writeAllowlist: ['src'],
    agentMode: 'mock',
    agentTimeoutMs: 30_000,
    openhandsCommand: 'openhands',
    mockAgentBehavior: 'success',
  };
}

describe('agent integration contract', () => {
  it('writes agent-request with task, workspace, tools, limits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-req-'));
    try {
      const task = minimalTask({
        writeAllowlist: ['src'],
        validationSteps: [
          { id: 'evidence', type: 'evidence_present' },
          {
            id: 'hello',
            type: 'workspace_file_contains',
            path: 'src/hello.txt',
            contains: 'HELLO_PIPELINE',
          },
        ],
      });
      const context = createExecutionContext({
        config: configFor(root),
        task,
        logger: createLogger({ level: 'error' }),
        runId: 'agent-1',
      });
      const request = buildAgentRequest(context, 30_000);
      assert.equal(request.taskId, task.id);
      assert.equal(request.workspace, context.workspaceDir);
      assert.equal(request.repository, context.workspaceDir);
      assert.deepEqual(request.acceptanceCriteria, task.acceptanceCriteria);
      assert.ok(request.availableTools.length > 0);
      assert.equal(request.timeLimitMs, 30_000);
      assert.equal(request.retryLimit.maxTotalAttempts, task.retryPolicy.maxTotalAttempts);
      assert.equal(request.pipelineAuthority, 'independent_validator_only');

      const agent = new MockAgentAdapter({ behavior: 'success' });
      const outcome = await agent.run(context);
      assert.equal(outcome.claimedSuccess, true);
      assert.ok(outcome.request);
      assert.ok((outcome.commandsExecuted ?? []).length > 0);
      assert.ok(outcome.finalReport);

      const onDisk = JSON.parse(
        readFileSync(join(context.workspaceDir, 'agent-request.json'), 'utf8'),
      ) as { pipelineAuthority: string };
      assert.equal(onDisk.pipelineAuthority, 'independent_validator_only');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('agent claimedSuccess does not imply validator PASS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-pass-'));
    try {
      const task = minimalTask({ writeAllowlist: ['src'] });
      const context = createExecutionContext({
        config: configFor(root),
        task,
        logger: createLogger({ level: 'error' }),
        runId: 'agent-2',
      });
      const agent = new MockAgentAdapter({ behavior: 'success' });
      const outcome = await agent.run(context);
      assert.equal(outcome.claimedSuccess, true);

      const validator = new ArtifactPresenceValidator();
      const decision = await validator.validate({
        context,
        mode: 'acceptance',
        agentClaimedSuccess: outcome.claimedSuccess,
        requiredEvidence: task.requiredEvidence,
        presentEvidence: ['status.json'],
        testExitCode: null,
      });
      assert.equal(decision.status, 'BLOCK');
      assert.ok(decision.notes.some((n) => /ignored/i.test(n)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
