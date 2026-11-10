import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp, generateSwaggerDocument } from './main';

async function exportDocument() {
  const app = await createApp();
  try {
    await writeFile(resolve(__dirname, '../../../docs/openapi.json'),
      JSON.stringify(generateSwaggerDocument(app), null, 2) + '\n');
    console.log('OpenAPI document exported to docs/openapi.json');
  } finally { await app.close(); }
}
void exportDocument().catch(() => {
  console.error('OpenAPI export failed; verify local environment and database');
  process.exitCode = 1;
});
