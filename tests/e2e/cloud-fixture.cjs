// Scripted transport for the root bootstrap. Mutations use canned responses;
// database.test.cjs executes the SQL, this fixture does not reimplement it.
function cloudSdkFixture(postgrestFixture, config) {
  const fixture = postgrestFixture();
  Object.assign(fixture.tables, config.tables || {});
  const state = window.cloudTest = {
    fixture, replies: [], channels: [], authCalls: [],
    households: config.households || [], details: config.details || {},
    session: config.session || null, loginError: null, confirmEmail: false,
  };
  let authListener;
  state.setSession = session => { state.session = session; authListener?.('SIGNED_IN', session); };
  const client = fixture.client, from = client.from;
  client.from = table => {
    const query = from(table);
    for (const method of ['insert', 'update', 'delete']) query[method] = () => { throw new Error('Direct DML is forbidden'); };
    return query;
  };
  client.rpc = async (name, args) => {
    fixture.calls.push({ rpc: name, args: structuredClone(args) });
    const index = state.replies.findIndex(reply => reply.name === name && (!reply.operation || reply.operation === args.operation));
    if (index >= 0) {
      const reply = state.replies.splice(index, 1)[0];
      if (reply.defer) await new Promise(resolve => { state.release = resolve; });
      if (reply.tables) Object.assign(fixture.tables, reply.tables);
      return { data: reply.data, error: reply.error };
    }
    if (name === 'budget_list_households') return { data: structuredClone(state.households) };
    if (name === 'budget_household_details') return { data: structuredClone(state.details[args.household_id]) };
    throw new Error('Unscripted RPC: ' + name + '/' + (args.operation || ''));
  };
  const session = () => ({ user: { id: '00000000-0000-0000-0000-000000000001', email: 'tester@example.invalid' } });
  client.auth = {
    async getSession() { return { data: { session: state.session } }; },
    onAuthStateChange(callback) { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword(credentials) {
      state.authCalls.push({ method: 'login', email: credentials.email });
      if (state.loginError) return { error: state.loginError };
      state.session = session(); return { data: { session: state.session } };
    },
    async signUp(credentials) {
      state.authCalls.push({ method: 'signup', email: credentials.email });
      state.session = state.confirmEmail ? null : session(); return { data: { session: state.session } };
    },
    async signOut() { state.session = null; authListener?.('SIGNED_OUT', null); return {}; },
  };
  client.channel = name => {
    const channel = { name, handlers: [], removed: false,
      on(type, filter, callback) { channel.handlers.push({ type, filter, callback }); return channel; },
      subscribe(callback) { channel.status = callback; return channel; },
    };
    state.channels.push(channel); return channel;
  };
  client.removeChannel = channel => { channel.removed = true; return Promise.resolve(); };
  return client;
}
module.exports = { cloudSdkFixture };
