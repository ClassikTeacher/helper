import { Hud } from './components/Hud';

/**
 * Root component — composition of the overlay HUD. Global hotkey/overlay wiring
 * is a bootstrap concern (tasks.md phase 0.3), not a component concern.
 */
export function App() {
  return (
    <div className="min-h-screen bg-transparent text-neutral-100">
      <Hud />
    </div>
  );
}
