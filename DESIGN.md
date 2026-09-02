# Design System -- PorchSongs

## Product Context
- **What this is:** A personal song lyric rewriter. Paste lyrics, chat with AI to workshop them, chords auto-realign.
- **Who it's for:** Independent songwriters, worship leaders, hobbyist musicians, parents who play at home.
- **Space/industry:** Music/creative tools. Peers: LyricStudio, Hookpad, Songwriter's Pad, Songcraft.
- **Project type:** Web app (two-pane rewrite workshop) with marketing/landing pages.

## Aesthetic Direction
- **Direction:** Organic/Natural with subtle Editorial influence
- **Decoration level:** Intentional (warm cream surfaces, paper-like quality, not overdone)
- **Mood:** Warm, crafted, personal. Like sitting on a porch with a guitar and a notebook. The product should feel handmade and analog, not sterile or techy. The lyrics are always the hero.
- **Reference sites:** LyricStudio (bold but techy), Songcraft (warm, closest peer), Hookpad (clean, educational). PorchSongs differentiates with warm organic tones and serif display type.

## Typography
- **Display/Hero:** Fraunces -- warm, soft-serif variable font with craft character. Signals "artisan, not SaaS." Used for page titles, hero headings, section titles, and marketing headlines. Loaded as a variable font (wght 400-700, optical size 9-144): headings can use real semibold/bold weights (Instrument Serif shipped only 400, so bolder headings were browser-synthesized and rendered poorly), and the optical size axis serves a sturdier, more readable cut at small sizes and a more elegant one at display sizes automatically.
- **Body:** Plus Jakarta Sans -- modern, highly readable geometric sans with warm character. Used for body text, UI labels, buttons, navigation, and lyrics display.
- **UI/Labels:** Same as body (Plus Jakarta Sans)
- **Data/Tables:** Plus Jakarta Sans with `tabular-nums` -- the family ships tabular figures (OpenType `tnum`), so statistics, pricing, and usage counts align without loading a separate face.
- **Code/Chords:** JetBrains Mono -- excellent for chord alignment above lyrics, code blocks, and monospaced content.
- **Loading:** Google Fonts for Fraunces, Plus Jakarta Sans (400-700; 300 is unused), and JetBrains Mono.
- **Scale:**
  - 48px -- page titles (Fraunces)
  - 36px -- section headings (Fraunces)
  - 30px -- card titles (Fraunces)
  - 24px -- subheadings (Plus Jakarta Sans, semibold)
  - 20px -- large body (Plus Jakarta Sans, semibold)
  - 16px -- body text (Plus Jakarta Sans)
  - 14px -- UI labels, secondary text, buttons (Plus Jakarta Sans)
  - 12px -- captions, metadata, timestamps (Plus Jakarta Sans)

## Color
- **Approach:** Restrained (1 accent + warm neutrals). The burnt sienna primary is the only strong color. No blue or purple anywhere except semantic info states.
- **Primary:** `#b25627` -- burnt sienna. The brand color. Used for CTAs, active states, chord coloring, links. Chosen to clear WCAG AA (4.69:1) against the paper background for body-size text; the earlier `#b85c2c` sat at 4.33:1.
- **Primary hover:** `#9e4e24` -- deeper sienna for hover/pressed states.
- **Primary light:** `#f3dfd2` -- warm tint for selected states, badges, light backgrounds.
- **Background:** `#faf9f6` -- warm paper, not sterile white. Creates a subtle "songwriter's notebook" feel.
- **Card:** `#ffffff` -- pure white for elevated card surfaces.
- **Panel:** `#f5f3ef` -- warm off-white for sidebars, chat bubbles, code blocks.
- **Foreground:** `#2b2825` -- warm near-black for body text.
- **Muted foreground:** `#7a756d` -- warm gray for secondary text, placeholders, metadata.
- **Border:** `#e6e3dc` -- warm border for cards, dividers, form inputs.
- **Semantic:**
  - Success: `#2d7a50` (bg: `#ddf3e4`, text: `#1a5c38`)
  - Warning: `#a16207` (bg: `#fef3c7`, text: `#854d0e`)
  - Error: `#b91c1c` (bg: `#fee2e2`, text: `#991b1b`)
  - Info: `#1d5fa6` (bg: `#dbeafe`, text: `#1e40af`)
- **Dark mode strategy:** Redesign surfaces with warm dark tones. Reduce primary saturation slightly, lighten for readability. Dark surfaces use stone/warm grays (#1c1917, #292524, #44403c), not cool grays.
  - Primary dark: `#d4773e`
  - Primary hover dark: `#e08a52`
  - Primary light dark: `#3d2a1d`
  - Background dark: `#1c1917`
  - Card dark: `#292524`
  - Panel dark: `#221f1c` (one step above the background, so panels keep their layering)
  - Foreground dark: `#e7e5e4`
  - Muted dark: `#a8a29e`
  - Border dark: `#44403c`

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable (lyrics need breathing room)
- **Scale:** 2xs(2px) xs(4px) sm(8px) md(16px) lg(24px) xl(32px) 2xl(48px) 3xl(64px)

## Layout
- **Approach:** Grid-disciplined for the app, slightly more editorial for marketing pages
- **Grid:** Single column (mobile), 2 columns (app workshop panes), responsive breakpoints
- **Max content width:** 1120px
- **Border radius:**
  - sm: 4px (inputs, small badges, code blocks)
  - md: 8px (buttons, cards, dropdowns, alerts)
  - lg: 12px (modals, large cards, panels)
  - full: 9999px (pills, avatar circles, tags)

## Motion
- **Approach:** Minimal-functional. This is a writing tool, not a showcase. Songwriters care about content.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:**
  - micro: 50-100ms (button press, checkbox toggle)
  - short: 150-250ms (hover transitions, focus rings, dropdown open)
  - medium: 250-400ms (modal enter, panel slide)
  - long: 400-700ms (page transitions, only if needed)
- **Rules:** No scroll-driven animations. No entrance choreography. Transitions serve comprehension, not decoration.

## Shadows
- **sm:** `0 1px 3px rgba(0, 0, 0, 0.06)` -- cards at rest
- **md:** `0 2px 8px rgba(0, 0, 0, 0.08)` -- cards on hover, dropdowns
- **lg:** `0 8px 32px rgba(0, 0, 0, 0.12)` -- modals, overlays
- **inset:** `inset 0 1px 4px rgba(0, 0, 0, 0.04)` -- subtle inner shadow for recessed text areas (editors, chat panels, code blocks)
- **Dark mode:** Increase opacity (0.3, 0.4, 0.5) since shadows need more contrast on dark surfaces.

## Design Risks (Intentional Departures)
These are deliberate creative choices that differentiate PorchSongs from competitors:

1. **Serif display font:** Every competitor uses all-sans-serif. Instrument Serif for headings signals craft over SaaS.
2. **No blue primary:** The entire space gravitates to blue/purple accents. Burnt sienna is the brand.
3. **Warm paper backgrounds:** Most apps use pure white. The #faf9f6 base creates warmth throughout.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-21 | Initial design system created | Created by /design-consultation based on competitive research (LyricStudio, Hookpad, Songwriter's Pad, Songcraft, Kiin AI) and product context |
| 2026-03-21 | Chose Instrument Serif for display | Warm editorial serif differentiates from all-sans-serif competitors in the songwriting tool space |
| 2026-03-21 | Chose Plus Jakarta Sans for body | Modern, warm geometric sans with excellent readability for long-form lyrics |
| 2026-03-21 | Refined primary from #c06830 to #b85c2c | Slightly deeper burnt sienna with more warmth and visual weight |
| 2026-03-21 | Set background to #faf9f6 | Warm paper feel instead of sterile white, reinforces the "songwriter's notebook" metaphor |
