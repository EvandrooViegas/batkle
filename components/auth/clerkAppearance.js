// Batkle's palette (see the .bk-root tokens in app/globals.css) for the dialogs Clerk draws itself: account settings.
const LIGHT = {
  colorPrimary: '#14131A',
  colorPrimaryForeground: '#FFFFFF',
  colorForeground: '#14131A',
  colorMutedForeground: '#5B5766',
  colorBackground: '#FFFFFF',
  colorInput: '#FFFFFF',
  colorInputForeground: '#14131A',
  colorNeutral: '#14131A',
  colorBorder: '#CFCBBD',
  colorRing: '#FFD84D',
  colorDanger: '#C2412F',
  colorSuccess: '#1F7A5A',
  colorWarning: '#F2A900',
}

const DARK = {
  colorPrimary: '#F6F3EA',
  colorPrimaryForeground: '#14131A',
  colorForeground: '#F6F3EA',
  colorMutedForeground: '#ACA8B9',
  colorBackground: '#211F2A',
  colorInput: '#1B1A22',
  colorInputForeground: '#F6F3EA',
  colorNeutral: '#F6F3EA',
  colorBorder: '#4A4757',
  colorRing: '#FFD84D',
  colorDanger: '#F0826F',
  colorSuccess: '#4CC79A',
  colorWarning: '#F2A900',
}

/** Clerk appearance in Batkle's colours and fonts; pass `dark` when the app is in dark mode. */
export function clerkAppearance(dark = false) {
  return {
    variables: {
      ...(dark ? DARK : LIGHT),
      fontFamily: 'var(--font-bk-body), ui-sans-serif, system-ui, sans-serif',
      fontFamilyButtons: 'var(--font-bk-body), ui-sans-serif, system-ui, sans-serif',
      borderRadius: '0.625rem',
    },
    elements: {
      headerTitle: { fontFamily: 'var(--font-bk-display), ui-sans-serif, system-ui, sans-serif', fontWeight: 700, letterSpacing: '-0.02em' },
      formButtonPrimary: { fontWeight: 700, textTransform: 'none' },
    },
  }
}
