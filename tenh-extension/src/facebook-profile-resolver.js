/* Read only the rendered customer identity in the exact Page inbox.
 * No private Facebook endpoints, cookies, access tokens or name searches.
 * The address bar alone is not proof that Facebook loaded the requested thread.
 */
globalThis.TenhFacebookProfileResolver = (() => {
  const selectors = globalThis.TenhFacebookSelectors;
  const normalize = value => String(value ?? "").normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
      style.visibility !== "hidden" && !element.closest('[hidden], [aria-hidden="true"]');
  };
  const excluded = 'nav, [role="navigation"], [role="feed"], [role="log"], article, [role="article"], [contenteditable="true"]';

  function profileInboxRoute(value, pageId) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port ||
          !["business.facebook.com", "www.facebook.com", "facebook.com"].includes(url.hostname)) return null;
      const pages = ["asset_id", "page_id", "mailbox_id"].flatMap(key => url.searchParams.getAll(key));
      if (pages.some(id => id !== pageId)) return null;
      const selected = ["selected_item_id", "thread_id"].flatMap(key => url.searchParams.getAll(key));
      if (selected.length && (new Set(selected).size !== 1 || !/^\d{1,32}$/.test(selected[0]))) return null;
      if (url.searchParams.getAll("thread_type").some(type => type !== "FB_MESSAGE")) return null;
      const sections = url.searchParams.getAll("section");
      if (sections.length > 1 || sections.some(section => section !== "messages")) return null;
      if (url.hostname === "business.facebook.com") {
        if (!/^\/latest\/inbox(?:\/[^/]+)?\/?$/.test(url.pathname) || !pages.length || !selected.length) return null;
        return { key: `suite:${pageId}:${selected[0]}`, selectedItemId: selected[0], url: url.href, suite: true };
      }
      const segments = url.pathname.split("/").filter(Boolean);
      const pageInbox = segments[0] === pageId && ["messages", "inbox"].includes(segments[1]) && segments.length === 2;
      const pageInboxThread = segments[0] === pageId && segments[1] === "inbox" &&
        segments.length === 3 && /^\d{1,32}$/.test(segments[2]);
      const messages = segments[0] === "messages" && (segments.length === 1 || (segments[1] === "t" && segments.length === 3));
      const legacyIds = ["threadid", "tid"].flatMap(key => url.searchParams.getAll(key));
      if (legacyIds.some(id => !/^[A-Za-z0-9_.:-]{1,200}$/.test(id))) return null;
      if (pageInboxThread && (selected.length || legacyIds.length)) return null;
      if (!(pageInboxThread || pageInbox || messages) || (!selected.length && !legacyIds.length && segments.length !== 3)) return null;
      const params = [...url.searchParams.entries()].filter(([key]) => ["selected_item_id", "thread_id", "threadid", "tid"].includes(key)).sort();
      return { key: `${segments.join("/")}:${JSON.stringify(params)}`, selectedItemId: selected[0] || null, url: url.href, suite: false };
    } catch { return null; }
  }

  function visibleError() {
    const texts = new Set([...document.querySelectorAll('h1, h2, h3, [role="heading"], [role="alert"], span, p, div')]
      .filter(el => visible(el) && !el.closest(excluded))
      .map(el => normalize(el.textContent)).filter(text => text.length > 0 && text.length <= 180));
    if (texts.has("no contact card") && [...texts].some(text => /your page can no longer see this person.s profile information/.test(text))) return "facebook_no_contact_card";
    if ([...texts].some(text => /^something went wrong\.?$/.test(text)) && [...texts].some(text => /trouble loading your experience/.test(text))) return "facebook_inbox_load_failed";
    return null;
  }

  function context(options) {
    if (document.querySelector('input[type="password"]')) return { reason: "facebook_sign_in_required" };
    if (options.linkSource !== "meta_conversations_api") return { reason: "profile_conversation_link_unavailable" };
    const expected = profileInboxRoute(options.loadedConversationLink || options.conversationLink, options.pageId);
    const actual = profileInboxRoute(window.location.href, options.pageId);
    if (!expected || !actual || expected.key !== actual.key) return { reason: "conversation_mismatch" };
    const error = visibleError();
    if (error) return { reason: error };

    // The provider-returned URL is independently bound to Page + PSID on the
    // server. If the DOM exposes a selected row, reject any conflicting row.
    const selected = [...document.querySelectorAll('[aria-selected="true"], [aria-current="true"], [aria-current="page"]')].filter(visible);
    const identities = new Set();
    for (const row of selected) {
      const links = [...row.querySelectorAll('a[href]')];
      if (row.matches('a[href]')) links.push(row);
      const parent = row.closest('a[href]'); if (parent) links.push(parent);
      for (const link of links) {
        try {
          const route = profileInboxRoute(new URL(link.getAttribute("href"), window.location.href).href, options.pageId);
          if (route) identities.add(route.key);
        } catch { /* Unrelated malformed links are not conversation evidence. */ }
      }
    }
    if (identities.size && (identities.size !== 1 || !identities.has(actual.key))) return { reason: "conversation_mismatch" };
    return { pageId: options.pageId, matchedThreadId: options.threadId, selectedItemId: actual.selectedItemId,
      conversationLink: options.conversationLink, linkSource: options.linkSource };
  }

  function identityRegions(customerName) {
    const wanted = normalize(customerName);
    if (!wanted) return [];
    const regions = new Set();
    for (const heading of document.querySelectorAll('h1, h2, h3, [role="heading"]')) {
      if (!visible(heading) || heading.closest(excluded) || normalize(heading.textContent) !== wanted) continue;
      let node = heading.parentElement;
      for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        if (node.matches('body, main, [role="main"]') || node.closest(excluded) ||
            node.querySelector('[contenteditable], [role="log"], [role="feed"], [aria-selected]') ||
            normalize(node.textContent).length > 1500) break;
        regions.add(node);
        if (node.matches('aside, [role="complementary"], [role="dialog"], header')) break;
      }
    }
    return [...regions];
  }

  const profileLabel = label => /^(?:view (?:facebook )?profile|facebook profile|មើលប្រវត្តិរូប)$/.test(label);
  const labelsFor = element => [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title"), element.querySelector('img')?.alt].map(normalize).filter(Boolean);
  const cardExcluded = `${excluded}, [role="row"], [role="listitem"], [role="listbox"], [aria-selected], [data-message-id]`;

  function hasVisibleName(root, action, wanted) {
    for (const element of root.querySelectorAll('span, div, p, strong, b, bdi, h1, h2, h3, [role="heading"]')) {
      if (!visible(element) || element.closest(cardExcluded) || element.contains(action) || action.contains(element)) continue;
      // Names may be split across inline elements. Compare complete visible
      // text, retaining words and accents; never use a partial/fuzzy name.
      const parts = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement && visible(node.parentElement) && !node.parentElement.closest(cardExcluded)) parts.push(node.nodeValue || "");
      }
      if ([parts.join(""), parts.join(" ")].some(text => normalize(text) === wanted)) return true;
    }
    return false;
  }

  function inCustomerPanel(element) {
    if (element.closest('aside, [role="complementary"], [role="dialog"]')) return true;
    // Some Suite layouts use plain divs for the right-hand contact panel.
    // Require a tall, narrow panel on the right, outside message content.
    for (let node = element, depth = 0; node && depth < 10; node = node.parentElement, depth++) {
      if (node.matches('body, main, [role="main"]') || node.closest(cardExcluded) ||
          node.querySelector('[role="log"], [role="feed"], [contenteditable], [data-message-id]')) break;
      const box = node.getBoundingClientRect();
      if (visible(node) && box.left >= window.innerWidth * 0.6 && box.width >= 180 &&
          box.width <= window.innerWidth * 0.4 && box.right <= window.innerWidth + 2 &&
          box.height >= Math.min(300, window.innerHeight * 0.4)) return true;
    }
    return false;
  }

  function profileCardRegions(customerName) {
    const wanted = normalize(customerName), regions = new Set();
    const actions = [...document.querySelectorAll('a[href], [role="link"], button, [role="button"]')]
      .filter(action => visible(action) && !action.closest(cardExcluded) && labelsFor(action).some(profileLabel));
    let unlinkedCards = 0;
    if (wanted) for (const action of actions) {
      for (let node = action.parentElement, depth = 0; node && depth < 10; node = node.parentElement, depth++) {
        if (node.matches('body, main, [role="main"], form') || node.closest(cardExcluded) ||
            node.querySelector(`${cardExcluded}, [contenteditable]`) || normalize(node.textContent).length > 600) break;
        if (!hasVisibleName(node, action, wanted) || ![...node.querySelectorAll('img, svg image, [role="img"]')].some(visible) || !inCustomerPanel(node)) continue;
        regions.add(node);
        if (!action.hasAttribute("href")) unlinkedCards++;
        break;
      }
    }
    return { regions: [...regions], unlinkedCards, profileActions: actions.length,
      linkActions: actions.filter(action => action.hasAttribute("href")).length };
  }

  function readCurrent(options = {}) {
    const match = context(options);
    if (match.reason) return match;
    const headings = identityRegions(options.customerName), cards = profileCardRegions(options.customerName);
    const urls = new Set(), regions = [...new Set([...headings, ...cards.regions])];
    const diagnostics = { headingRegions: headings.length, cardRegions: cards.regions.length,
      profileActions: cards.profileActions, linkActions: cards.linkActions };
    let unrecognizedLabel = false, unsupportedLink = false;
    for (const region of regions) {
      for (const anchor of region.querySelectorAll('a[href], [role="link"][href]')) {
        if (!visible(anchor) || anchor.closest(excluded)) continue;
        // Check each label independently: whitespace or a different visible
        // caption must not mask a matching accessible label on the same link.
        const labelled = labelsFor(anchor).some(label => label === normalize(options.customerName) || profileLabel(label));
        const url = selectors.profileCandidateUrl(anchor.getAttribute("href"));
        if (!url) { if (labelled) unsupportedLink = true; continue; }
        if (!labelled) { unrecognizedLabel = true; continue; }
        const id = new URL(url).searchParams.get("id");
        if (id === options.threadId || id === options.pageId) { unsupportedLink = true; continue; }
        urls.add(url);
      }
    }
    if (urls.size > 1) return { ...match, diagnostics, reason: "ambiguous_profile" };
    if (!urls.size) return { ...match, diagnostics, canReveal: !unsupportedLink && !unrecognizedLabel && !cards.unlinkedCards && revealControls(options).length === 1,
      reason: !regions.length ? "profile_customer_heading_missing" : unsupportedLink ? "profile_link_format_unsupported"
        : unrecognizedLabel ? "profile_link_label_unrecognized" : cards.unlinkedCards ? "profile_action_without_link" : "profile_link_not_rendered" };
    return { ...match, found: true, profileUrl: [...urls][0] };
  }

  function revealControls(options) {
    const wanted = normalize(options.customerName);
    if (!wanted) return [];
    return [...document.querySelectorAll('button, [role="button"]')].filter(control => {
      if (!visible(control) || control.closest(`${excluded}, a[href], [role="row"], [role="listbox"], [aria-selected]`)) return false;
      if (control.matches(':disabled, [aria-disabled="true"], [aria-expanded="true"]')) return false;
      const labels = [control.getAttribute("aria-label"), control.textContent].map(normalize);
      return labels.includes(wanted) && Boolean(control.querySelector('h1, h2, h3, [role="heading"]') || control.closest('header'));
    });
  }

  // The worker calls this only in its disposable inactive lookup tab. Check
  // current visibility and conversation again before interacting with the UI.
  function reveal(options = {}) {
    const match = context(options);
    if (match.reason) return match;
    if (document.visibilityState !== "hidden") return { reason: "facebook_tab_in_use" };
    const controls = revealControls(options);
    if (controls.length !== 1) return { ...match, revealed: false };
    controls[0].click();
    return { ...match, revealed: true };
  }
  return { readCurrent, reveal };
})();
