import { useEffect, useRef } from "react";
import { formatCurrency } from "../formatting/currency";
import "./transaction-details.css";

export type TransactionDetailsData = {
  id: string;
  amount: number;
  currency: string;
  type: "INCOME" | "EXPENSE";
  paymentMode?: "CASH" | "CREDIT" | "BANK_ACCOUNT";
  transactionDate: string;
  description?: string | null;
  category?: { id: string; name: string };
  subCategory?: { id: string; name: string };
  createdAt?: string;
};

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

export default function TransactionDetails({
  transaction,
  currency,
  onClose,
  onEdit,
}: {
  transaction: TransactionDetailsData;
  currency: string;
  onClose: () => void;
  onEdit: (bounds: DOMRect | null) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

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
        ref={dialogRef}
        role="dialog"
      >
        <div className="transaction-details-topline">
          <span className={`transaction-details-type ${isIncome ? "is-income" : ""}`}>
            <span aria-hidden="true">{isIncome ? "↙" : "↗"}</span>
            {isIncome ? "Income" : "Expense"}
          </span>
          <div className="transaction-details-actions">
            <button
              className="transaction-details-edit"
              onClick={() => onEdit(dialogRef.current?.getBoundingClientRect() ?? null)}
              type="button"
            >
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
          {isIncome ? "+" : "−"}{formatCurrency(transaction.amount, currency)}
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
            <dt>Payment method</dt>
            <dd>
              {transaction.paymentMode === "BANK_ACCOUNT"
                ? "Bank account"
                : transaction.paymentMode
                  ? transaction.paymentMode[0] + transaction.paymentMode.slice(1).toLowerCase()
                  : "Not specified"}
            </dd>
          </div>
          {transaction.subCategory && (
            <div>
              <dt>Subcategory</dt>
              <dd>{transaction.subCategory.name}</dd>
            </div>
          )}
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
