interface ToggleCardProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}

/** Card selecionavel para opcoes booleanas — assinatura visual do formulario. */
export function ToggleCard({ id, checked, onChange, label, description, disabled }: ToggleCardProps) {
  return (
    <label className={disabled ? "toggle-card toggle-card--disabled" : "toggle-card"} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div>
        <b>{label}</b>
        <span>{description}</span>
      </div>
    </label>
  );
}
