const personas = [
  ["Alex Morgan", "Compliance"],
  ["Sofia Patel", "Creative"],
  ["Maya Chen", "Creative"],
  ["Jordan Lee", "Creative"],
] as const;

export function PersonaSwitcher({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  return (
    <div className="persona-switcher">
      <label>
        <span>Viewing as</span>
        <select
          aria-label="Viewing as"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {personas.map(([name, role]) => (
            <option key={name} value={name}>
              {name} · {role}
            </option>
          ))}
        </select>
      </label>
      <small>Demo personas · no account sign-in</small>
    </div>
  );
}
