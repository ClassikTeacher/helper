import { Hud } from './components/Hud';

/**
 * Root component — composition of the overlay HUD. Global hotkey/overlay wiring
 * is a bootstrap concern (tasks.md phase 0.3), not a component concern.
 */
export function App() {
  return (
    // The HUD tracks the (resizable) window: it fills the viewport, minus a
    // 20px transparent gutter on every side.
    <div className="box-border h-screen bg-transparent p-5 text-neutral-100">
      <Hud />
    </div>
  );
}
