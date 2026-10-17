# Nishkam UX rules

Every change to a page follows this file. If a change breaks a rule, fix the change or change this file first, on purpose.

## 1. Who and what
- People come to **practice chip design**. Every screen answers: *what can I do here, and what do I do next?*
- **One main action per screen.** The landing page: Start practicing. A problem: Submit. Studio: Run the next stage. Everything else is secondary and looks secondary.
- **Plain words.** No taglines, slogans or jargon in working screens. A label says what happens: "Open Studio", not "Explore".

## 2. Layout
- **Top bar, the same on every page:** logo on the left; actions on the right, in this fixed order:
  `[page-specific info] · Open Studio · Local runner · Profile`
  The profile control is always last, at the far right.
- **Nothing moves when something opens.** Menus, popovers and toasts float. They never push other items. Test it by measuring before and after.
- **Spacing scale:** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 px. No other values.
- **Phones (under 700px):** only what works on a phone. Studio is gated, so its controls are hidden, not squeezed. No text wraps inside buttons (`white-space: nowrap`), and nothing scrolls sideways.

## 3. Components (reuse them; don't invent new ones)
- **Pill button:** 30px tall, 0 12px padding, glass. Primary = solid #1430ff; secondary = glass.
- **Glass surface:** dark translucent background, `backdrop-filter: blur(28px) saturate(180%)`, 1px light border, inset top highlight, 16px radius.
- **Menu:** opens from its trigger as a glass panel, right-aligned. It closes on Esc and on an outside click. Arrow keys move between items. Use `role="menu"` and `aria-expanded`.
- **Card:** glass surface with 24px padding. Stat cards show the number large and the label small and uppercase.
- **Empty and loading states:** never leave a bare "Loading…". Show a skeleton or a sentence saying what's happening. If it fails, say what failed and what to do.

## 4. Motion
- Motion explains a change (open/close, reveal). It's never decoration on working screens.
- 150–250 ms, ease-out. Animate transform and opacity only.
- Under `prefers-reduced-motion`, turn all of it off.

## 5. Accessibility
- Everything works by keyboard, with a visible focus ring (2px brand-hi).
- Text contrast is at least 4.5:1. Buttons are real `<button>`s and links are real `<a>`s.
- Every icon-only control has a label.

## 6. States to check for every change
| | signed out | signed in | admin |
|---|---|---|---|
| 1440px | ✓ | ✓ | ✓ |
| 390px | ✓ | ✓ | ✓ |
Plus: menu open, error state, empty state.

## 7. Done means (the gate before any push that touches web/)
1. Screenshots of every state above that the change touches, looked at by a person or by Opus, not only by the agent that built it.
2. No layout shift when menus open (measured).
3. No console errors on the page itself, locally.
4. **After deploy:** load the LIVE page and check the console again. Local tests miss deploy-only bugs.
5. If any of these checks didn't run, the report says which ones, and the change does not ship.
