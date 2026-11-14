// @ts-check
/**
 * Where the app-wide swipe navigation (ProtocolApp: swipe right = back,
 * swipe left = Home) must not fire.
 *
 * - input / textarea: text selection and caret drags.
 * - canvas: every 3D or drawn surface (Cyberworld, NetBattle, arenas, the
 *   presence stage). On a touch screen their camera-orbit and walk drags are
 *   long horizontal swipes, so without this a drag in Cyberworld on an iPad
 *   navigated away from it, back to whatever page came before.
 * - [data-no-swipe]: any surface that opts out (menus, sheets, game HUDs).
 */
export const APP_SWIPE_EXCLUDE = "input, textarea, canvas, [data-no-swipe]";
