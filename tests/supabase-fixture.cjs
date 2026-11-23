// Offline PostgREST-shaped transport. Tests execute the production adapter.
function postgrestFixture() {
  const tables = { months: [], entries: [], backlog: [] }, calls = [];
  let nextId = 0, failure;
  const client = {
    from(table) {
      let operation = 'select', value, columns = '*', single = false;
      const filters = [];
      const query = {
        select(fields = '*') { columns = fields; return query; },
        insert(row) { operation = 'insert'; value = row; return query; },
        update(patch) { operation = 'update'; value = patch; return query; },
        delete() { operation = 'delete'; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        order() { return query; }, single() { single = true; return query; },
        then(resolve, reject) {
          calls.push({ table, operation, value: structuredClone(value), filters });
          if (failure) { const error = failure; failure = null; return Promise.resolve({ data: null, error }).then(resolve, reject); }
          let rows = tables[table].filter(row => filters.every(([key, value]) => row[key] === value));
          if (operation === 'insert') {
            const input = [].concat(value);
            if (table === 'months' && input.some(row => tables.months.some(old => ['year','month','half'].every(key => old[key] === row[key])))) {
              return Promise.resolve({ data: null, error: { code: '23505' } }).then(resolve, reject);
            }
            rows = input.map(row => ({ id: ++nextId, ...structuredClone(row) })); tables[table].push(...rows);
          }
          if (operation === 'update') rows.forEach(row => Object.assign(row, structuredClone(value)));
          if (operation === 'delete') tables[table] = tables[table].filter(row => !rows.includes(row));
          let data = structuredClone(rows).map(row => columns === '*' ? row : Object.fromEntries(columns.split(',').map(key => [key, row[key]])));
          const error = single && data.length !== 1 ? new Error('Row not found') : null;
          if (single) data = data[0];
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return query;
    },
    rpc(name, args) { calls.push({ rpc: name, args }); return Promise.resolve({ data: { id: 77, ...args }, error: null }); },
  };
  return { client, calls, tables, failNext: error => { failure = error; } };
}
module.exports = { postgrestFixture };
