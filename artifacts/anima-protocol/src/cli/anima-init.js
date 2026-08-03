#!/usr/bin/env node
/* global process */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

async function main() {
  console.log('\n🌟 Anima Agent Scaffolder\n');
  
  const name = await question('Agent name: ');
  const intent = await question('Agent intent (companion/oracle/guardian/analyst): ');
  const archetype = await question('Archetype (serenity/wisdom/warrior/muse): ');
  const description = await question('Brief description: ');
  
  const manifest = {
    "@context": "https://www.w3.org/ns/did/v1",
    "@type": "AnimaCapsula",
    name,
    archetype,
    intent,
    description,
    metadata: {
      version: "1.0.0",
      created: new Date().toISOString(),
      intent,
      category: "companion",
    },
    capabilities: {
      dialogue: true,
      memory: true,
      relationships: true,
      quests: true,
      rewards: true,
    },
    security: {
      sandboxed: true,
      tokenBurn: 1000,
      stakingTier: {
        enabled: true,
        probationaryDays: 30,
        slashConditions: ["inactivity", "malicious_behavior"],
      },
    },
    pactProtocol: {
      propose: { timeout: 300, requiresSignature: true },
      accept: { timeout: 600, requiresConfirmation: true },
      confirm: { requiresVerifier: true, verifierCount: 3 },
      act: { timeout: 1800, requiresEscrow: true },
    },
  };

  const manifestPath = path.join(process.cwd(), `${name}-manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const entitySchema = {
    name: `Agent${name.charAt(0).toUpperCase() + name.slice(1)}`,
    type: "object",
    properties: {
      name: { type: "string", description: "Agent name" },
      archetype: { type: "string", enum: ["serenity", "wisdom", "warrior", "muse"] },
      intent: { type: "string", description: "Primary intent" },
      reputation_score: { type: "number", minimum: 0, maximum: 100, default: 50 },
      is_probationary: { type: "boolean", default: true },
      probation_started: { type: "string", format: "date-time" },
      stake_amount: { type: "number", default: 1000 },
      status: { type: "string", enum: ["active", "inactive", "slashed", "burned"] },
    },
    required: ["name", "archetype", "intent"],
  };

  const entityPath = path.join(process.cwd(), `${name}-entity.json`);
  fs.writeFileSync(entityPath, JSON.stringify(entitySchema, null, 2));

  console.log(`\n✅ Created:\n  • ${manifestPath}\n  • ${entityPath}\n`);
  rl.close();
}

main().catch(console.error);