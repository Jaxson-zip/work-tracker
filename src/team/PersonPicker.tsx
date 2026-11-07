export interface PersonOption {
  id: string;
  label: string;
}

// 选人：人一眼看全，点一下就选中。写待办和交接共用。
export default function PersonPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: PersonOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="person-picker" role="group" aria-label={label}>
      <span className="person-picker-label">{label}</span>
      {options.map((option) => (
        <button key={option.id} type="button" className="chip" aria-pressed={option.id === value} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
