"use client";
import { useId, useState } from "react";
import { formatMoneyInput, parseMoneyInput } from "./money";
import styles from "../inventory/inventory.module.css";

export default function MoneyField({ label, value, currency, onChange, error, onBlur }: {
  label: string; value: string; currency: string; onChange: (value: string) => void; error?: string; onBlur?: () => void;
}) {
  const id = useId(), [touched, setTouched] = useState(false);
  const parsed = parseMoneyInput(value, currency);
  const message = error || (touched && parsed === null ? "Informe um valor válido, como 1.250,00." : "");
  return <label htmlFor={id}>{label}
    <span className={styles.moneyField}><span className={styles.moneyPrefix} aria-hidden="true">{currency === "BRL" ? "R$" : currency}</span>
      <input id={id} required inputMode="decimal" value={value} placeholder="0,00" aria-label={`${label} (${currency})`}
        aria-invalid={!!message} aria-describedby={message ? `${id}-error` : undefined}
        onChange={event => onChange(event.target.value)} onBlur={() => {
          setTouched(true); if (parsed !== null) onChange(formatMoneyInput(parsed)); onBlur?.();
        }} />
    </span>
    {message && <small className={styles.fieldError} id={`${id}-error`} role="alert">{message}</small>}
  </label>;
}
