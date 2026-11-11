/** Loads the configured store adapter (config.yml's `store.adapter`). */
export async function loadAdapter(config) {
  const name = config.store?.adapter;
  if (!name) throw new Error('config.yml is missing store.adapter');
  switch (name) {
    case 'github-projects':
      return import('../store/github-projects.adapter.mjs');
    case 'fake': // test-only -- see scripts/store/fake.adapter.mjs
      return import('../store/fake.adapter.mjs');
    default:
      throw new Error(
        `Unknown store.adapter "${name}". Implemented: github-projects. See scripts/store/adapter.interface.md to add another.`
      );
  }
}
