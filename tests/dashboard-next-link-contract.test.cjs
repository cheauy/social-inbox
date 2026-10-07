const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { loader } = require('./tenh-seven/harness.cjs');

test('return to Inbox uses the installed Next click contract; modified clicks remain native', () => {
  const jsx = (type, props) => ({ type, props });
  let pathname = '/dashboard/analytics';
  const load = loader({ './inbox-return-context': { useInboxReturnHref: () => '/dashboard/inbox' }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/link': { __esModule: true, default: 'Link' },
    'next/navigation': { usePathname: () => pathname } });
  const Nav = load('components/dashboard/dashboard-nav-link.tsx').DashboardNavLink;
  const node = Nav({ href: '/dashboard/inbox', children: 'Inbox' });
  assert.equal(node.type, 'Link');
  assert.equal(node.props.prefetch, false);
  const source = fs.readFileSync(require.resolve('next/dist/client/app-dir/link'), 'utf8');
  const parsed = ts.createSourceFile('link.js', source, ts.ScriptTarget.Latest, true);
  const functions = parsed.statements.filter(n => ts.isFunctionDeclaration(n) && ['isModifiedEvent', 'linkClicked'].includes(n.name?.text));
  assert.equal(functions.length, 2);
  const navigations = [];
  const context = { window: {}, _react: { default: require('react') },
    _islocalurl: { isLocalURL: href => href.startsWith('/dashboard/') },
    _routerreducertypes: require('next/dist/client/components/router-reducer/router-reducer-types'),
    require: name => {
      assert.equal(name, '../components/app-router-instance');
      return { dispatchNavigateAction: (...args) => navigations.push(args) };
    } };
  vm.createContext(context);
  vm.runInContext(functions.map(n => n.getText(parsed)).join('\n') + '\nglobalThis.click = linkClicked;', context);
  let prevented = 0;
  const event = { currentTarget: { nodeName: 'A', getAttribute: () => null, hasAttribute: () => false },
    nativeEvent: {}, preventDefault: () => prevented++ };
  context.click(event, node.props.href, { current: null }, false, undefined);
  assert.equal(prevented, 1);
  assert.equal(navigations.length, 1);
  pathname = '/dashboard/inbox';
  const active = Nav({ href: '/dashboard/inbox', children: 'Inbox' });
  context.click(event, active.props.href, { current: null }, false, undefined, active.props.onNavigate);
  assert.equal(prevented, 2);
  assert.equal(navigations.length, 1, 'active Inbox never dispatches a navigation or fetch');
  assert.equal(navigations[0][0], '/dashboard/inbox');
  assert.equal(navigations[0][1], 'push');
  context.click({ ...event, ctrlKey: true }, node.props.href, { current: null }, false, undefined);
  assert.equal(prevented, 2);
  assert.equal(navigations.length, 1);
  // Actual installed click function, with a reduced local-URL/router fixture.
  // This does not claim full Next hydration or production browser coverage.
});
