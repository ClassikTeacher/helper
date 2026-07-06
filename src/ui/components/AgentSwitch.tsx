import type { Agent, AgentId } from '@/core/domain/agent';

interface AgentSwitchProps {
  readonly agents: readonly Agent[];
  readonly selected: AgentId;
  readonly disabled?: boolean;
  readonly onSelect: (id: AgentId) => void;
}

/**
 * Presentational: a segmented tab switch between agents (solver / reviewer).
 * Emits the chosen id via callback — no logic inside. Implemented as a radio
 * group so it's keyboard- and screen-reader-navigable.
 */
export function AgentSwitch({ agents, selected, disabled = false, onSelect }: AgentSwitchProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Agent"
      className="flex gap-1 rounded-md bg-neutral-800 p-1"
    >
      {agents.map((agent) => {
        const isActive = agent.id === selected;
        return (
          <button
            key={agent.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onSelect(agent.id)}
            className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              isActive
                ? 'bg-indigo-600 text-white'
                : 'text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100'
            }`}
          >
            {agent.name}
          </button>
        );
      })}
    </div>
  );
}
