module.exports = { createClient: () => ({
  channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {},
  auth: { getSession: async () => ({ data: { session: null } }) },
}) };
