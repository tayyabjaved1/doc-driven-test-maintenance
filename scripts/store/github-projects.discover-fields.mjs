#!/usr/bin/env node
/**
 * Setup helper for Stage 1 of the porting checklist. Prints the real field
 * and option ids for a GitHub Projects v2 board, so config.yml's
 * store.github_projects section can be filled in without guessing --
 * field/option ids are per-project and nothing in this repo invents them.
 *
 * Usage: STORE_TOKEN=... node scripts/store/github-projects.discover-fields.mjs --org your-org --project 1
 */
import { ghGraphql } from '../lib/gh.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const org = arg('org');
  const number = Number(arg('project'));
  if (!org || !number) {
    console.error('Usage: --org <org> --project <number>');
    process.exit(1);
  }
  const token = process.env.STORE_TOKEN;
  if (!token) {
    console.error('Set STORE_TOKEN first -- see .env.example.');
    process.exit(1);
  }

  const projectQuery = `
    query($org: String!, $number: Int!) {
      organization(login: $org) {
        projectV2(number: $number) {
          id
          fields(first: 50) {
            nodes {
              ... on ProjectV2FieldCommon { id name }
              ... on ProjectV2SingleSelectField { id name options { id name } }
            }
          }
        }
      }
    }`;
  const res = await ghGraphql(token, projectQuery, { org, number });
  const project = res?.data?.organization?.projectV2;
  if (!project) {
    console.error(`Could not find project #${number} for org "${org}". Check the project number and STORE_TOKEN's access.`);
    process.exit(1);
  }

  console.log(`Project id: ${project.id}\n`);
  for (const field of project.fields.nodes) {
    console.log(`Field "${field.name}": ${field.id}`);
    if (field.options) {
      for (const option of field.options) {
        console.log(`  option "${option.name}": ${option.id}`);
      }
    }
  }
  console.log('\nCopy the field ids into config.yml under store.github_projects.fields.');
  console.log('Status option names (not ids) go under store.github_projects.statuses -- the adapter resolves option ids at runtime.');
}

main();
