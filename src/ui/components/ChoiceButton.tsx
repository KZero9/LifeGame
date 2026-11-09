import type { Choice } from '../viewModel';

export function ChoiceButton({ choice, onPick, primary }: { choice: Choice; onPick: (c: Choice) => void; primary?: boolean }) {
  return (
    <button
      className={`choice${primary && choice.enabled ? ' primary' : ''}`}
      disabled={!choice.enabled}
      title={choice.enabled ? choice.detail : choice.reason}
      onClick={() => onPick(choice)}
    >
      <span>{choice.label}</span>
      {choice.detail && <span className="detail">{choice.detail}</span>}
      {!choice.enabled && choice.reason && <span className="why">{choice.reason}</span>}
    </button>
  );
}
