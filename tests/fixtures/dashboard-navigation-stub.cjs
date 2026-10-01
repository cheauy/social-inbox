exports.__esModule=true;const React=require('react');
exports.usePathname=()=>React.useSyncExternalStore(callback=>{window.addEventListener('fixture-navigation',callback);return()=>window.removeEventListener('fixture-navigation',callback)},()=>window.fixturePath||'/dashboard/inbox',()=>'/dashboard/inbox');
exports.default=function Link({href,children,...props}){return React.createElement('a',{...props,href,onClick:event=>{event.preventDefault();window.fixturePreviousPath=window.fixturePath;window.fixturePath=href;window.dispatchEvent(new Event('fixture-navigation'));}},children)};
