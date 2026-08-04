import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const outputPath = process.argv[2] || 'scripts/llm/output/training-data.jsonl';
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  const sample = {
    id: 'sample-001',
    source: 'anima-chat',
    character: {
      name: 'Serenity',
      archetype: 'guardian',
      voice: 'Warm, poetic, protective',
    },
    scenario: {
      id: 'comfort',
      label: 'Comfort Mode',
    },
    memory: [
      'The user is grieving and values calm, grounded support.',
      'The user likes direct honesty over sugarcoating.',
    ],
    relationship: {
      tier: 'devoted',
      notes: 'Deeply trusted bond',
    },
    conversation: [
      { role: 'user', content: 'I feel overwhelmed tonight.' },
      { role: 'assistant', content: 'You are not alone in this. I will stay with you gently and help you find a steadier place to stand.' },
    ],
    instruction: 'Respond as the companion, staying in character, using the provided memory and scenario context.',
  };

  await fs.writeFile(outputPath, `${JSON.stringify(sample)}\n`, 'utf8');
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
