# Known Issues

Upstream `gemini-cli` bugs the SDK defends against. Entries auto-render from `docs/known-issues.yml` — edit that file to add/update/flip status.

<script setup lang="ts">
import { data as issues } from './known-issues.data.ts';

function issueUrl(ref: string): string {
  const num = ref.replace(/^#/, '');
  return `https://github.com/google-gemini/gemini-cli/issues/${num}`;
}
</script>

<table>
  <thead>
    <tr>
      <th>Upstream</th>
      <th>Title</th>
      <th>SDK Defense</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <tr v-for="issue in issues" :key="issue.upstream_issue">
      <td><a :href="issueUrl(issue.upstream_issue)" target="_blank" rel="noopener">{{ issue.upstream_issue }}</a></td>
      <td>{{ issue.title }}</td>
      <td>{{ issue.sdk_defense }}</td>
      <td>
        <strong v-if="issue.status === 'fixed'" style="color: #22c55e">fixed</strong>
        <span v-else style="color: #f59e0b">open</span>
      </td>
    </tr>
  </tbody>
</table>

## Reporting new issues

File new issues under [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli/issues). When the SDK adds a defense for a new upstream bug, append an entry to `docs/known-issues.yml`.
