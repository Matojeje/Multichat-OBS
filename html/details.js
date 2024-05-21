// https://alexwlchan.net/2020/remembering-if-a-details-element-was-opened/

// Remember the state of a <details> element.
//
// If the element is opened and the page is reloaded, the element will
// be reopened.
//
// Pass the ID of the <details> element after the page has loaded.
//
function rememberIfDetailsWasDisclosed(detailsId) {
  const localStorageKey = "detailsWasDisclosed_" + detailsId;

  const details = document.getElementById(detailsId);

  // Listen to the toggle event, which fires whenever the <details>
  // is opened or closed.  The event fires after the state has changed,
  // so looking it up will tell us the current value.
  // See https://developer.mozilla.org/en-US/docs/Web/HTML/Element/details#Events
  details.addEventListener("toggle", event => {
    if (details.open) {
      localStorage.setItem(localStorageKey, true);
    } else {
      localStorage.removeItem(localStorageKey);
    }
  });

  // If the stored value tells us the <details> was open the last time we
  // opened the page, re-open it now.
  if (localStorage.getItem(localStorageKey)) {
    details.open = true;
  }
}
