/**
 * Shared design tokens for the mobile app (2026-09-04, "Hub Pulse" reskin).
 *
 * Mobile previously had no central theme file - every screen hardcoded its own hex colors in a
 * local `StyleSheet.create({...})`. This mirrors that same "every screen re-declares its colors"
 * pattern rather than introducing a new styling system, but at least gives every screen ONE place
 * to import shared values from, so the app-wide navy/amber reskin (matching the sister BGauss "Hub
 * Downtime Captain"/"Hub Pulse" app) doesn't have to be hand-copied hex-by-hex into four files -
 * and any future palette tweak only has to happen here.
 *
 * Base blue/red/green/background values match web's `web/src/styles/global.css` `:root` block
 * (the app's actual design-system source of truth) so both platforms stay in sync; `navy`/`amber`
 * are the two new accents introduced by this reskin, also matching the equivalent new CSS
 * variables added to global.css in the same change.
 */
export const colors = {
  // Core brand
  primary: '#2563eb',
  primaryDark: '#1e40af',
  primarySoft: '#eef4ff',
  success: '#059669',
  successSoft: '#ecfdf5',
  warning: '#d97706',
  warningSoft: '#fffbeb',
  danger: '#dc2626',
  dangerSoft: '#fef2f2',

  // Neutrals
  bg: '#f4f6f9',
  surface: '#ffffff',
  border: '#e2e6ec',
  text: '#101828',
  textMuted: '#6b7280',

  // "Hub Pulse" reskin accents
  navy: '#101828',
  navyLight: '#1e293b',
  navyLighter: '#334155',
  amber: '#f59e0b',
  amberDark: '#b45309',
  amberSoft: '#fef3e2',

  // Text/icon colors meant to sit ON TOP of the navy header/chrome
  onNavyText: '#ffffff',
  onNavyMuted: '#94a3b8',
  onNavyBorder: '#334155',
} as const

/** Chip (pill) visual states for multi-select/filter rows - default outline, solid navy
 * "selected", solid amber "done/confirmed" - matching the reference app's 3-state chip buttons. */
export const chipStyles = {
  base: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: {
    borderColor: colors.navy,
    backgroundColor: colors.navy,
  },
  done: {
    borderColor: colors.amber,
    backgroundColor: colors.amber,
  },
  text: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.text,
  },
  textSelected: {
    color: '#ffffff',
  },
  textDone: {
    color: '#ffffff',
  },
}
