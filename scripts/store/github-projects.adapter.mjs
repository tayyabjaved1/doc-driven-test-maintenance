import { ghGraphql } from '../lib/gh.mjs';

/** GitHub Projects v2 adapter. Implements scripts/store/adapter.interface.md.
 * Test cases are stored as Draft Issues on the project (title + body for the
 * case text, custom fields for Status/Priority/Role/Module) -- the simplest
 * record type Projects v2 offers with no dependency on the repo's own Issues. */

function storeToken() {
  const token = process.env.STORE_TOKEN;
  if (!token) throw new Error('STORE_TOKEN is not set -- see .env.example / docs/CREDENTIALS.md');
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
  if (!id) throw new Error(`Could not resolve project id for ${org}/#${project_number} -- check config.yml's store.github_projects`);
  return id;
}

/** Fetches the project's field + option ids once per call, keyed by the
 * human-readable names in config.yml (`store.github_projects.fields` and
 * `.statuses`) -- so the rest of this adapter, and config.yml itself, never
 * has to spell a raw field/option id. */
async function fieldMap(config) {
  const pid = await projectId(config);
  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2FieldCommon { id name }
              ... on ProjectV2SingleSelectField { id name options { id name } }
            }
          }
        }
      }
    }`;
  const res = await ghGraphql(storeToken(), query, { id: pid });
  const fields = res?.data?.node?.fields?.nodes ?? [];
  const byName = new Map(fields.map((f) => [f.name, f]));
  return { projectId: pid, byName };
}

/** @inheritdoc adapter.interface.md */
export async function preflight(config) {
  // The same call createItem/updateItemFields will make -- not a cheaper
  // proxy. If this throws, the whole run aborts before touching anything.
  await fieldMap(config);
}

/** @inheritdoc adapter.interface.md */
export async function listAll(config) {
  const { projectId: pid } = await fieldMap(config);
  const items = [];
  let after = null;
  for (;;) {
    const query = `
      query($id: ID!, $after: String) {
        node(id: $id) {
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                content { ... on DraftIssue { title body } }
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                    ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
                  }
                }
              }
            }
          }
        }
      }`;
    const res = await ghGraphql(storeToken(), query, { id: pid, after });
    const page = res?.data?.node?.items;
    for (const node of page?.nodes ?? []) {
      const fields = {};
      for (const fv of node.fieldValues?.nodes ?? []) {
        if (fv?.field?.name) fields[fv.field.name] = fv.text ?? fv.name ?? null;
      }
      items.push({ id: node.id, title: node.content?.title ?? '', fields });
    }
    if (!page?.pageInfo?.hasNextPage) break;
    after = page.pageInfo.endCursor;
    await new Promise((r) => setTimeout(r, 300)); // pace pagination -- see lib/gh.mjs
  }
  return items;
}

async function resolveFieldValueInput(fieldDef, value) {
  if (fieldDef.options) {
    const option = fieldDef.options.find((o) => o.name === value);
    if (!option) throw new Error(`Unknown option "${value}" for field "${fieldDef.name}" -- check config.yml's store.github_projects.statuses`);
    return { singleSelectOptionId: option.id };
  }
  return { text: String(value) };
}

/** @inheritdoc adapter.interface.md */
export async function getItem(config, { itemId }) {
  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2Item {
          id
          content { ... on DraftIssue { title } }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
            }
          }
        }
      }
    }`;
  const res = await ghGraphql(storeToken(), query, { id: itemId });
  const node = res?.data?.node;
  if (!node) return null; // not found -- a normal result for this function only, see adapter.interface.md
  const fields = {};
  for (const fv of node.fieldValues?.nodes ?? []) {
    if (fv?.field?.name) fields[fv.field.name] = fv.text ?? fv.name ?? null;
  }
  return { id: node.id, title: node.content?.title ?? '', fields };
}

/** @inheritdoc adapter.interface.md */
export async function createItem(config, { title, body, fields }) {
  const { projectId: pid } = await fieldMap(config);
  const createQuery = `
    mutation($projectId: ID!, $title: String!, $body: String) {
      addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
        projectItem { id }
      }
    }`;
  const res = await ghGraphql(storeToken(), createQuery, { projectId: pid, title, body: body ?? '' });
  const itemId = res?.data?.addProjectV2DraftIssue?.projectItem?.id;
  if (!itemId) throw new Error(`Failed to create item "${title}": ${JSON.stringify(res)}`);
  if (fields && Object.keys(fields).length > 0) {
    await updateItemFields(config, { itemId, fields });
  }
  return { id: itemId };
}

/** @inheritdoc adapter.interface.md */
export async function updateItemFields(config, { itemId, fields }) {
  const { projectId: pid, byName } = await fieldMap(config);
  for (const [name, value] of Object.entries(fields ?? {})) {
    const fieldDef = byName.get(name);
    if (!fieldDef) throw new Error(`Unknown field "${name}" -- check config.yml's store.github_projects.fields`);
    const valueInput = await resolveFieldValueInput(fieldDef, value);
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
          projectV2Item { id }
        }
      }`;
    const res = await ghGraphql(storeToken(), mutation, { projectId: pid, itemId, fieldId: fieldDef.id, value: valueInput });
    const updatedId = res?.data?.updateProjectV2ItemFieldValue?.projectV2Item?.id;
    if (!updatedId) {
      // Distinguish "itemId does not exist" from any other failure -- the
      // existence-resolution guard (validate-summary.mjs) depends on this.
      const errors = res?.errors ?? [];
      const notFound = errors.some((e) => /could not resolve|not found/i.test(e.message ?? ''));
      const err = new Error(`Failed to update item ${itemId}, field "${name}": ${JSON.stringify(res)}`);
      err.notFound = notFound;
      throw err;
    }
  }
}
