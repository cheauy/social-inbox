exports.useRouter = () => ({ push(href) { history.pushState(null, '', href); }, refresh() {} });
