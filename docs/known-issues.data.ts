import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export interface KnownIssue {
  upstream_issue: string;
  title: string;
  sdk_defense: string;
  status: 'open' | 'fixed';
}

export default {
  watch: ['./known-issues.yml'],
  load(): KnownIssue[] {
    const here = dirname(fileURLToPath(import.meta.url));
    const ymlPath = resolve(here, 'known-issues.yml');
    const raw = readFileSync(ymlPath, 'utf-8');
    return yaml.load(raw) as KnownIssue[];
  },
};
