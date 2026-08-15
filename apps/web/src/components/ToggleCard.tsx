interface ToggleCardProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}

/** Card selecionavel para opcoes booleanas — assinatura visual do formulario. */
export function ToggleCard({ id, checked, onChange, label, description }: ToggleCardProps) {
  return (
    <label className="toggle-card" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div>
        <b>{label}</b>
        <span>{description}</span>
      </div>
    </label>
  );
}
