#!/usr/bin/env node
import { runFinalClientDemo } from '../src/cli/final-client-demo.js';

const demo = await runFinalClientDemo();
process.stdout.write(`${demo.lines.join('\n')}\n`);
process.exitCode = demo.exitCode;
