import { useEffect, useRef } from "react";
import "./transaction-details.css";

export type TransactionDetailsData = {
  id: string;
  amount: number;
  currency: string;
  type: "INCOME" | "EXPENSE";
  transactionDate: string;
  description?: string | null;
  category?: { id: string; name: string };
  subCategory?: { id: string; name: string };
  createdAt?: string;
};

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatCreatedAt(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export default function TransactionDetails({
  transaction,
  onClose,
  onEdit,
}: {
  transaction: TransactionDetailsData;
  onClose: () => void;
  onEdit: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, [onClose]);

  const isIncome = transaction.type === "INCOME";
  const description = transaction.description?.trim();

  return (
    <div
      className="transaction-details-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="transaction-details-title"
        aria-modal="true"
        className="transaction-details-dialog"
        role="dialog"
      >
        <div className="transaction-details-topline">
          <span className={`transaction-details-type ${isIncome ? "is-income" : ""}`}>
            <span aria-hidden="true">{isIncome ? "↙" : "↗"}</span>
            {isIncome ? "Income" : "Expense"}
          </span>
          <div className="transaction-details-actions">
            <button className="transaction-details-edit" onClick={onEdit} type="button">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m14 5 5 5M4 20l4.2-.8L19 8.4a2.1 2.1 0 0 0-3-3L5.2 16.2 4 20Z" />
              </svg>
              Edit
            </button>
            <button
              aria-label="Close transaction details"
              className="transaction-details-close"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <p className={`transaction-details-amount ${isIncome ? "is-income" : ""}`}>
          {isIncome ? "+" : "−"}{formatCurrency(transaction.amount, transaction.currency)}
        </p>
        <h2 id="transaction-details-title">
          {description || transaction.subCategory?.name || transaction.category?.name || "Transaction"}
        </h2>
        <p className="transaction-details-date">{formatDate(transaction.transactionDate)}</p>

        <dl className="transaction-details-list">
          <div>
            <dt>Category</dt>
            <dd>{transaction.category?.name || "Uncategorized"}</dd>
          </div>
          <div>
            <dt>Subcategory</dt>
            <dd>{transaction.subCategory?.name || "None"}</dd>
          </div>
          <div>
            <dt>Transaction type</dt>
            <dd>{isIncome ? "Income" : "Expense"}</dd>
          </div>
          <div>
            <dt>Transaction date</dt>
            <dd>{formatDate(transaction.transactionDate)}</dd>
          </div>
          {transaction.createdAt && (
            <div>
              <dt>Added on</dt>
              <dd>{formatCreatedAt(transaction.createdAt)}</dd>
            </div>
          )}
          <div className="transaction-details-id">
            <dt>Transaction ID</dt>
            <dd title={transaction.id}>{transaction.id}</dd>
          </div>
        </dl>
        <button
          className="transaction-details-done"
          onClick={onClose}
          type="button"
        >
          Done
        </button>
      </section>
    </div>
  );
}
