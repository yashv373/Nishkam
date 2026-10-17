# Nishkam UX baseline v1

Status: **APPROVED by the owner on 2026-10-18. Binding** for every change to web/. Change this file first, on purpose, if a rule needs to change. Visual examples: docs/ux-examples.html.

Built from three inputs: our own draft v0, research on UX methods, and research on comparable products. Each rule is tagged:
- **[ours]**: from our draft and the owner's own decisions.
- **[std]**: from a published standard (sources at the bottom).
- **[pattern]**: what the best comparable products do.
- **[choice]**: our own pick where the sources gave no number.

## 1. Purpose
1. One main action per screen. It looks primary; everything else looks secondary. Landing: Start practicing. Problem: Submit. Studio: Run. **[ours] [pattern]**
2. Plain words. Labels say what happens. No slogans on working screens. **[ours]**
3. Show the system's status. Never leave the user in silence. **[std: NN/g heuristic 1]**

## 2. Navigation
4. **One top bar and one account menu on every page** (landing, practice, profile, admin, Studio). Logo on the left links home. On the right, in this fixed order: `page info (e.g. points) · Open Studio · Local runner · Account ▾`. The account menu is always last. **[ours] [pattern]**
5. The account menu holds: name + @handle, My profile, Admin panel (admins only), Sign out. Signing in starts from the same spot. **[pattern]**
6. Menus follow the WAI-ARIA menu-button pattern:
   - Enter/Space/↓ opens the menu;
   - arrow keys move between items;
   - Esc closes and returns focus to the trigger;
   - an outside click closes it;
   - roles are `aria-haspopup`, `aria-expanded`, `role="menu"` and `menuitem`.

   **[std: APG]**
7. Opening anything (menu, tooltip, toast) never moves other content. Test it by measuring element positions. **[ours]**
8. Messages for people who don't need them stay out of the main flow. Example: the Studio access-key note goes in a tooltip, not loose text. **[pattern]**

## 3. Feedback (the core loop)
9. Response time:
   - under 0.1 s feels instant;
   - over 1 s, show progress;
   - over 10 s, show what's happening, with a way to stop.

   **[std: NN/g response times]**
10. Grading shows its steps: the engine download (%), then checking cycles. **[pattern]**
11. A result starts with a large pass/fail banner (what was checked and how many cycles), then the details, such as the counterexample table. **[pattern]**
12. After a pass, offer the next step: a Next problem button and your points or rank change. **[pattern]**
13. Every view has all its states: loading (skeleton or a sentence, never a bare "Loading…"), empty (why it's empty and what to do), and error (what failed and what to do next). **[std: NN/g heuristic 9] [pattern]**
14. Studio: one Run button that becomes Stop, a status dot per stage, and a log that opens by itself when a stage fails. **[pattern]**

## 4. Visual system (one source of values)
15. All raw values live in **one tokens file** (`web/tokens.css`). Pages use the variables, never raw hex colours or off-scale px. **[std: Design Tokens CG] [choice: a single file, no build pipeline]**
16. Spacing scale: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 px. Type scale: 12 · 14 · 16 · 20 · 24 · 32 · 48 px. Radius: 6 · 12 · 16 · pill. **[choice]**
17. Components to reuse (no one-off styles):
    - **pill button**: 30px tall on desktop, 12px side padding;
    - **glass surface**: blur 28px, saturate 180%, 1px light border, inset highlight;
    - **card**: glass with 24px padding;
    - **menu panel**;
    - **stat card**: big number, small uppercase label;
    - **badge**.

    **[ours]**
18. **Colour contrast** (computed with the WCAG formula) **[std: WCAG 1.4.3 / 1.4.11]**:
    - Body text is white or near-white. Text needs 4.5:1, or 3:1 for large text. UI parts and focus rings need 3:1.
    - Brand blue **#1430ff is for fills only** (buttons with white text, accents). As text it fails: 2.90:1 on #000 and 2.35:1 on #1c1c1e.
    - Blue text and links use **#4a63ff on pure black only** (4.52:1). On panels (#1c1c1e, 3.66:1), blue is allowed only for large text and icons; otherwise use white.

## 5. Motion
19. Hover 100–150 ms. Menus open in 200–250 ms and close faster. Panels take 300 ms at most. Ease-out. Animate only transform and opacity. **[std: Material motion tokens]**
20. Turn all motion off under `prefers-reduced-motion`. **[std: WCAG]** On working screens, motion only explains a change. Showpiece effects belong on the landing page only. **[ours]**

## 6. Touch, keyboard and phones
21. Click and tap targets: at least 24×24 px **[std: WCAG 2.5.8 AA]**; we use 30px on desktop and 44px on phones **[choice]**.
22. Everything works by keyboard, with a visible focus ring. Buttons are real `<button>`s and links are real `<a>`s. Icon-only controls have a label. **[std]**
23. Under 700px, show only what works on a phone. Studio is gated, so its controls are hidden, not squeezed. No text wraps inside buttons, and nothing scrolls sideways. **[ours]**

## 7. How we enforce it (the done-gate before any push to web/)
24. Every frontend agent brief starts with: *"Read docs/UX.md. It is binding."* **[ours]**
25. Screenshot every touched state: signed out / signed in / admin × 1440 / 390, plus menu-open, empty and error. **Opus looks at them**, not only the agent that built them. **[ours] [std: Playwright toHaveScreenshot]**
26. Automatic checks:
    - no layout shift on open;
    - no sideways scroll;
    - no console errors;
    - axe-core reports no **serious or critical** issues.

    **[std: axe-core impact levels]**
27. After deploy, load the **live** page and check the console. Local tests miss deploy-only bugs. **[ours]**
28. A report says which checks did not run. Something unchecked does not ship. **[ours]**
29. For each big flow (first submit, first Studio run), test with 5 real users. Track task success, time on task and SUS (68 is average). **[std: NN/g 5 users; MeasuringU SUS]**

## 8. Not adopting yet (overkill for us now)
Token build pipelines, Storybook, paid visual-regression services, WCAG AAA everywhere, A/B tests, personas and journey maps. Laws of UX are guidance, not hard rules.

## Sources
WCAG 2.2 (SC 1.4.3, 1.4.11, 2.5.8) · WAI-ARIA Authoring Practices: menu button · NN/g: 10 usability heuristics, response-time limits, "test with 5 users" · MeasuringU: SUS average 68 · Laws of UX (lawsofux.com) · GOV.UK design principles · W3C Design Tokens Community Group (designtokens.org) · Material motion duration tokens · Deque axe-core impact levels · Playwright visual comparisons. The full notes with links and access dates are in the owner's private research notes.
