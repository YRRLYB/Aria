# Aria Design Constitution (`DESIGN.md`)

> Before building or changing UI, read `DESIGN.md` alongside `.agents/skills/apple-design/SKILL.md`, `.agents/skills/choreograph/SKILL.md`, and `.agents/skills/review-animations/STANDARDS.md`.

## Surfaces
- **Shell clarity over persistent clutter**: Never add a persistent floating bottom mini-player dock (`MiniPlayerDock`) across views.
  Why: keeps browsing surfaces quiet and unobstructed; playback controls live in the dedicated player view, immersive mode, and keyboard/OS media controls.
  <!-- 2026-11-27: "不要迷你控制条。我不需要这个" -->
- **Floating surfaces use translucent depth; full-width `.app-header` stays `backdrop-filter: none`**: Modals, popovers, confirm sheets, and select menus use `backdrop-filter: blur()` + a subtle top light-catching highlight edge, while `.app-header` avoids full-width backdrop blur so scrolling stays smooth on Intel Macs.
- **Desktop lyrics must feel ornamental and refined**: When desktop lyrics are enabled, render them as a restrained, delicate desk ornament rather than oversized garish subtitles.
  <!-- 2026-11-28: "做一个桌面歌词的就类似摆设的东西。不要难看" -->
- **Listen Together is a room & salon, not a second player**: Never embed duplicated transport buttons, scrub bars, or mini-lyrics inside the Listen Together view. Keep the room focused on shared artwork presence, spacious 5-seat listener cards, and the shared queue; playback controls belong to the main Player view.
  <!-- 2026-11-28: "我一直觉得一起听界面里面塞一个播放器很诡异你觉得呢？" → Plan A -->

## Color
- **Restraint on accents**: Reserve `--accent` / `--track-accent` for active focus states, interactive curves, and primary play controls. Avoid rainbow/neon animated loops on functional controls like search inputs.
- **Smooth theme shifts**: Switch between light and dark themes via `document.startViewTransition` (`220ms`) when reduced motion is not active, and initialize Electron `BrowserWindow` `backgroundColor` from `nativeTheme.shouldUseDarkColors` to prevent dark-mode startup flashes.

## Typography
- **Optical sizing & tracking**: Large display track titles use tight leading (`1.10–1.14`) and negative tracking (`-0.025em` to `-0.03em`) with `font-optical-sizing: auto`.
- **Tabular figures**: Always apply `tabular-nums` on playback clocks, volume readouts, EQ frequencies/dB gains, bitrates, and countdown timers so changing numbers never jitter horizontally.
- **Windows ClearType**: Keep `-webkit-font-smoothing: auto` on Windows so small UI text remains crisp.

## Spacing & Layout
- **Platform window chrome**: Preserve `[data-platform="darwin"]` `padding-left: 92px` on `.app-header` and `.aria-immersive-header` across all breakpoints for macOS traffic lights.
- **Edge-faded scroll containers**: Scrollable lyric flows and studio lists use soft top/bottom mask fades (`.aria-lyric-scroll`, `.aria-scroll-fade-y`) instead of harsh 1px dividers.

## Motion
- **Easing tokens**: Use `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for entrances/exits, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` for on-screen movement, and `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` for sheets. Never use `ease-in` on UI transitions.
- **Tactile press**: Interactive buttons respond on `:active` with subtle scale (`0.94–0.97`), while hover lift/scale transforms are gated inside `@media (hover: hover) and (pointer: fine)`.
- **No `transition-all` & no metronome stagger**: Always list explicit GPU-friendly properties (`transform`, `opacity`, `background-color`, `color`, `border-color`). Any staggered entrance uses shrinking non-uniform gaps under `300ms`; high-frequency keyboard actions (search focus, command toggles) use zero animation.
- **Three accessibility signals**: Root is wrapped in `<MotionConfig reducedMotion="user">`; stylesheets honor `@media (prefers-reduced-motion: reduce)`, `@media (prefers-reduced-transparency: reduce)`, and `@media (prefers-contrast: more)`.

## Interaction
- **Never use native `window.confirm()` / `window.alert()`**: Use `useConfirm()` (`ConfirmDialogProvider`) for irreversible actions and non-blocking undo/status toasts (`10s` window for recoverable edits) for routine operations.
- **Direct manipulation**: Sliders (progress scrubber, EQ Bode nodes, 31-band sweep) track 1:1 on pointer capture (`setPointerCapture`) and commit expensive audio seeks on pointer release.
- **Hi-Fi & Listen Together invariants**: Micro-fade, Crossfade, and user playback speed automatically bypass or lock to `1.0x` during Exclusive Mode (`WASAPI`/`CoreAudio` Hog Mode) or active Listen Together sync sessions.

## Copy
- **Concise, honest status copy**: Surface real reasons for audio/source states (e.g., VIP/copyright limits, bypass status, headroom warnings) in clear Chinese copy without jargon overload.
