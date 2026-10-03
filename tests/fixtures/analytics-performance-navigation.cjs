const React = require('react');
function useSearchParams() {
  const [query, setQuery] = React.useState(() => location.search);
  React.useEffect(() => {
    const sync = () => setQuery(location.search);
    window.addEventListener('popstate', sync); window.addEventListener('fixture-query', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('fixture-query', sync); };
  }, []);
  return React.useMemo(() => new URLSearchParams(query), [query]);
}
module.exports = { useSearchParams, usePathname: () => '/dashboard/analytics' };
