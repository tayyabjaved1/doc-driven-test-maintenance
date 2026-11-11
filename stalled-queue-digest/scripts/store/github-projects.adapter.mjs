import { ghGraphql } from '../lib/gh.mjs';

/** GitHub Projects v2 adapter. Implements adapter.interface.md's single
 * read-only function. Uses a dedicated, read-only `STORE_TOKEN` -- see
 * README.md's "fail closed" note; never the repo-ops or agent credential. */

function storeToken() {
  const token = process.env.STORE_TOKEN;
  if (!token) throw new Error('STORE_TOKEN is not set (must be a read-only PAT) -- see README.md');
  return token;
}

async function projectId(config) {
  const { org, project_number } = config.store.github_projects;
  const query = `
    query($org: String!, $number: Int!) {
      organization(login: $org) { projectV2(number: $number) { id } }
    }`;
  const res = await ghGraphql(storeToken(), query, { org, number: project_number });
  const id = res?.data?.organization?.projectV2?.id;
  if (!id) throw new Error(`Could not resolve project id for ${org}/#${project_number}`);
  return id;
}

/** @inheritdoc adapter.interface.md */
export async function listPendingItems(config) {
  const { status_field: statusField, owning_area_field: areaField, pending_statuses: pendingStatuses } =
    config.store.github_projects;
  const { page_size: pageSize, max_pages: maxPages, retry_budget_seconds: retryBudgetSeconds } =
    config.collector;
  const retryBudgetMs = (retryBudgetSeconds ?? 120) * 1000;

  const pid = await projectId(config);
  const pendingSet = new Set(pendingStatuses);
  const results = [];

  let after = null;
  let page = 0;
  // Bounded by page count AND (via ghGraphql's own retryBudgetMs per call)
  // time per call -- not an unbounded loop. See adapter.interface.md.
  while (page < maxPages) {
    page += 1;
    const query = `
      query($id: ID!, $first: Int!, $after: String) {
        node(id: $id) {
          ... on ProjectV2 {
            items(first: $first, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                content {
                  ... on DraftIssue { title }
                  ... on Issue { title url }
                  ... on PullRequest { title url }
                }
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt field { ... on ProjectV2FieldCommon { name } } }
                    ... on ProjectV2ItemFieldTextValue { text updatedAt field { ... on ProjectV2FieldCommon { name } } }
                  }
                }
              }
            }
          }
        }
      }`;
    const res = await ghGraphql(storeToken(), query, { id: pid, first: pageSize, after }, retryBudgetMs);
    const itemsPage = res?.data?.node?.items;
    if (!itemsPage) throw new Error('Unexpected response shape querying project items');

    for (const node of itemsPage.nodes ?? []) {
      const fieldValues = node.fieldValues?.nodes ?? [];
      const statusValue = fieldValues.find((fv) => fv?.field?.name === statusField);
      const areaValue = fieldValues.find((fv) => fv?.field?.name === areaField);

      const statusName = statusValue?.name; // single-select only; a text status field isn't supported
      if (!statusName || !pendingSet.has(statusName)) continue; // not pending -- skip

      results.push({
        id: node.id,
        title: node.content?.title ?? '(untitled)',
        url: node.content?.url ?? null,
        owningArea: areaValue?.text ?? areaValue?.name ?? 'Unassigned',
        pendingStatus: statusName,
        // The status field's OWN updatedAt -- when the item entered THIS
        // status -- never node.content's or the item's generic timestamp.
        // null (not a substituted fallback) when genuinely unavailable.
        enteredStateAt: statusValue?.updatedAt ?? null,
      });
    }

    if (!itemsPage.pageInfo?.hasNextPage) break;
    after = itemsPage.pageInfo.endCursor;
    await new Promise((r) => setTimeout(r, 300)); // pace pagination
  }

  return results;
}
