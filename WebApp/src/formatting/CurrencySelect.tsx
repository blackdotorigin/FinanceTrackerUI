import { CURRENCY_OPTIONS } from "./currency";

type Props = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  "aria-label": string;
  id?: string;
  name?: string;
};

export default function CurrencySelect({
  value,
  onChange,
  required,
  id,
  name,
  "aria-label": ariaLabel,
}: Props) {
  const selectedCode = value.trim().toUpperCase();
  const hasSelectedCurrency = CURRENCY_OPTIONS.some((currency) => currency.code === selectedCode);

  return (
    <select
      aria-label={ariaLabel}
      id={id}
      name={name}
      onChange={(event) => onChange(event.target.value)}
      required={required}
      value={hasSelectedCurrency ? selectedCode : ""}
    >
      {!selectedCode && <option value="" disabled>Select a currency</option>}
      {!hasSelectedCurrency && selectedCode && (
        <option value={selectedCode}>{selectedCode} — Unsupported currency</option>
      )}
      {CURRENCY_OPTIONS.map(({ code, name, symbol }) => (
        <option key={code} value={code}>
          {code} — {name} ({symbol})
        </option>
      ))}
    </select>
  );
}
