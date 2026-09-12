/* Passive profile-link sync. It reads ONLY an explicit profile link in the
 * selected customer's visible details. No cookie access, private endpoints,
 * automatic profile clicks, background search or guessing of public IDs. */
(() => {
  const helpers = globalThis.TenhProfileSyncHelpers;
  if (!helpers || globalThis.__tenhPassiveProfileSync || window.top !== window) return;
  globalThis.__tenhPassiveProfileSync = true;
  let stopped = false, timer = null, observer = null, candidate = null, flight = false;
  const accepted = new Map(), attempted = new Map();
  let responseTimer = null;
  function visible(node) {
    if (!node || node.closest('[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }
  const name = value => String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  function inspect() {
    const scope = helpers.context(location.href);
    if (!scope || document.hidden) return null;
    // Requires either an explicit matching customer ID on the details pane,
    // or a selected thread link + matching customer-name heading. A global
    // account/menu 'View profile' link is never eligible.
    const selected = Array.from(document.querySelectorAll('[aria-selected="true"],a[aria-current="page"]'));
    const selectedNames = new Set();
    for (const row of selected) {
      const anchors = row.matches("a[href]") ? [row] : Array.from(row.querySelectorAll("a[href]"));
      if (!anchors.some(a => { const c = helpers.context(a.href); return c?.pageId === scope.pageId && c.psid === scope.psid; })) continue;
      const title = row.querySelector('[data-customer-name],[role="heading"],h2,h3')?.textContent || row.getAttribute("data-customer-name") || row.getAttribute("aria-label");
      if (title) selectedNames.add(name(title));
    }
    const panes = Array.from(document.querySelectorAll('[data-customer-id],[data-psid],[data-testid*="customer-detail"],[data-testid*="contact-detail"],[role="complementary"],[aria-label="Customer details"],[aria-label="Contact details"]'));
    const urls = new Set();
    for (const pane of panes) {
      if (!visible(pane)) continue;
      // A customer-authored chat message is never a source of profile identity.
      if (pane.closest('[role="log"],[data-testid*="message-row"],[data-testid*="message-bubble"]')) continue;
      const detailSelector = '[role="complementary"],[data-testid*="customer-detail"],[data-testid*="contact-detail"],[aria-label="Customer details"],[aria-label="Contact details"]';
      if (!pane.matches(detailSelector) && !pane.closest(detailSelector)) continue;
      const explicit = pane.getAttribute("data-customer-id") || pane.getAttribute("data-psid");
      const heading = pane.querySelector('[data-customer-name],h1,h2,h3,[role="heading"]');
      const paneName = pane.getAttribute("data-customer-name") || heading?.getAttribute("data-customer-name") || heading?.textContent;
      if (explicit ? explicit !== scope.psid : !selectedNames.has(name(paneName))) continue;
      for (const link of pane.querySelectorAll("a[href]")) {
        if (!visible(link) || link.closest('[role="menu"],nav,[role="navigation"],[role="banner"]')) continue;
        const label = name([link.textContent, link.getAttribute("aria-label"), link.getAttribute("title")].filter(Boolean).join(" "));
        if (!/(?:view|open)(?: public| facebook)? profile|facebook profile|មើលប្រវត្តិរូប/.test(label)) continue;
        const url = helpers.profile(link.href, scope); if (url) urls.add(url);
      }
    }
    // Ambiguous UI is not a reason to store whichever link appeared first.
    return urls.size === 1 ? { ...scope, publicProfileUrl: [...urls][0] } : null;
  }
  function stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; if (responseTimer) clearTimeout(responseTimer); responseTimer = null; observer?.disconnect(); window.removeEventListener("focus", schedule); window.removeEventListener("popstate", schedule); document.removeEventListener("visibilitychange", schedule); }
  function finish(error, answer, signature) {
    flight = false;
    if (responseTimer) clearTimeout(responseTimer); responseTimer = null;
    if (/extension context invalidated/i.test(String(error?.message || error || ""))) { stop(); return; }
    if (answer?.saved === true) {
      if (accepted.size >= 100) accepted.delete(accepted.keys().next().value);
      accepted.set(signature, Date.now());
    }
    if (attempted.size >= 100) attempted.delete(attempted.keys().next().value);
    const slow = /conflict|disabled|permission|unauthorized|invalid/.test(String(answer?.reason || ""));
    attempted.set(signature, Date.now() + (slow ? 300000 : 30000));
    // No repeated automatic HTTP write on a rejected/ambiguous link. A later
    // navigation, details change or focus is an opportunity to retry.
  }
  function tick() {
    timer = null;
    if (stopped) return;
    try { if (!chrome.runtime?.id) { stop(); return; } } catch { stop(); return; }
    const observed = inspect();
    if (!observed) { candidate = null; return; }
    const signature = JSON.stringify(observed);
    if (Date.now() - (accepted.get(signature) || 0) < 300000 || (attempted.get(signature) || 0) > Date.now() || flight) return;
    if (!candidate || candidate.signature !== signature) {
      candidate = { signature, at: Date.now() }; timer = setTimeout(tick, 1200); return;
    }
    if (Date.now() - candidate.at < 1100) { timer = setTimeout(tick, 1200); return; }
    flight = true; let completed = false;
    const settle = (err, answer) => { if (completed) return; completed = true; finish(err, answer, signature); };
    responseTimer = setTimeout(() => settle(new Error("profile_sync_timeout"), null), 20000);
    try {
      const pending = chrome.runtime.sendMessage({ type: "FB_PROFILE_URL_OBSERVED", ...observed }, answer => {
        let error; try { error = chrome.runtime.lastError; } catch (e) { error = e; }
        settle(error, answer);
      });
      if (pending?.then) pending.then(answer => settle(null, answer), error => settle(error, null));
    } catch (e) { settle(e, null); }
  }
  function schedule() { if (!stopped && !timer) timer = setTimeout(tick, 800); }
  // Exposes only a read function to this extension's isolated world for tests.
  globalThis.TenhPassiveProfileInspector = { inspect, stop };
  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["href", "aria-selected", "aria-current", "data-customer-id", "data-psid", "data-customer-name", "aria-label"] });
  window.addEventListener("focus", schedule); window.addEventListener("popstate", schedule);
  document.addEventListener("visibilitychange", schedule); window.addEventListener("pagehide", stop, { once: true });
  schedule();
})();
