exports.createClient = () => ({
  channel() { return { on() { return this; }, subscribe() { window.fixtureRealtime.opens++; return this; } }; },
  removeChannel() { window.fixtureRealtime.closes++; },
});
