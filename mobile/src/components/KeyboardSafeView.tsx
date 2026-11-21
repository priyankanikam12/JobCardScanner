// mobile\src\components\KeyboardSafeView.tsx
// 2026-11-21: SUPERSEDED - the app's global keyboard fix is src\components\KeyboardSafe.tsx (wired in App.tsx and every screen).
// Nothing imports this file any more; it only re-exports so an old import cannot break the build. Safe to delete.
export { KeyboardSafeView, KeyboardAwareScrollView, useKeyboardHeight } from './KeyboardSafe'
