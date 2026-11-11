import { router, type Href } from 'expo-router';

// App-side rules for the Figma links that point at a fixed screen instead of "the previous
// screen" (figma-review N7): a back control returns to where the user came from, and a
// "홈으로 / 내역으로" link leaves the whole input flow.

/** Returns to the previous screen, or to `fallback` when the screen was opened directly. */
export function goBack(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/** Leaves the current flow entirely and shows a tab-level screen. */
export function leaveFlowTo(href: Href) {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}
