import { writeFileSync } from 'node:fs';
import { jsonSchemas, schemaFile, serialize } from '../src/json-schemas.ts';

const dir = new URL('../schemas/', import.meta.url);
for (const [name, schema] of Object.entries(jsonSchemas())) {
  writeFileSync(new URL(schemaFile(name), dir), serialize(schema));
  console.log(`wrote schemas/${schemaFile(name)}`);
}
