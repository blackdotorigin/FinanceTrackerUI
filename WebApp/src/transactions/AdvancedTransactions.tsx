import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import "./advanced-transactions.css";

type TransactionType = "INCOME" | "EXPENSE";

type Transaction = {
  id: string;
  amount: number;
  currency: string;
  type: TransactionType;
  transactionDate: string;
  description?: string | null;
  category?: { id: string; name: string };
  subCategory?: { id: string; name: string };
};

type Category = {
  id: string;
  name: string;
  type: TransactionType;
  icon?: string;
};

type Props = {
  categories: Category[];
  categoriesError: string;
  categoriesLoading: boolean;
  currency: string;
  onRetryCategories: () => void;
  onSelectTransaction: (transaction: Transaction) => void;
  transactions: Transaction[];
};

const CATEGORY_COLORS = [
  ["#fff0e8", "#b8694f"],
  ["#edf2ff", "#6479b6"],
  ["#eaf6ed", "#5c8d66"],
  ["#fff4d9", "#a67b2f"],
  ["#f5edff", "#8765ad"],
  ["#e7f6f6", "#4c8585"],
  ["#ffedf2", "#ae6680"],
];

function categoryIconName(category: Category) {
  const value = `${category.name} ${category.icon ?? ""}`.toLocaleLowerCase();
  if (/food|grocery|restaurant|dining|meal|cafe/.test(value)) return "food";
  if (/transport|travel|fuel|vehicle|taxi|bus|train/.test(value)) return "transport";
  if (/shop|retail|clothing|fashion/.test(value)) return "shopping";
  if (/home|house|rent|housing|maintenance/.test(value)) return "home";
  if (/health|medical|pharmacy|doctor|fitness/.test(value)) return "health";
  if (/salary|payroll|work|business|income|payment/.test(value)) return "income";
  if (/subscription|stream|entertainment|movie|music/.test(value)) return "subscriptions";
  if (/utility|electric|water|bill|internet|phone/.test(value)) return "utilities";
  if (/education|course|book|school|tuition/.test(value)) return "education";
  if (/gift|donation|charity/.test(value)) return "gift";
  if (/pet|animal|vet/.test(value)) return "pets";
  if (/saving|investment|interest/.test(value)) return "savings";
  return "general";
}

function CategoryIcon({ category }: { category: Category }) {
  const iconName = categoryIconName(category);
  const paths = {
    food: <><path d="M7 3v7M4.5 3v4a2.5 2.5 0 0 0 5 0V3M7 9v12M16 3v18M16 3c2 2 3 4.5 3 7h-3" /></>,
    transport: <><path d="M5 16h14l-1-8a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2l-1 8Z" /><path d="M5 12h14M7 16l-1 3m12-3 1 3M8 19h.01M16 19h.01" /></>,
    shopping: <><path d="M5 8h14l1 12H4L5 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>,
    home: <><path d="m3 11 9-8 9 8M5.5 10v10h13V10M9.5 20v-6h5v6" /></>,
    health: <><path d="M10 3h4v6h6v4h-6v8h-4v-8H4V9h6V3Z" /></>,
    income: <><path d="M12 19V5m-6 6 6-6 6 6" /><path d="M5 21h14" /></>,
    subscriptions: <><rect x="4" y="5" width="16" height="14" rx="3" /><path d="m10 9 5 3-5 3V9Z" /></>,
    utilities: <><path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" /></>,
    education: <><path d="m3 9 9-5 9 5-9 5-9-5Z" /><path d="M7 12v5c3 2 7 2 10 0v-5M21 9v6" /></>,
    gift: <><path d="M3 10h18v11H3V10ZM2 6h20v4H2zM12 6v15" /><path d="M12 6H8a2 2 0 1 1 2-2c0 1 2 2 2 2Zm0 0h4a2 2 0 1 0-2-2c0 1-2 2-2 2Z" /></>,
    pets: <><path d="M12 12c-2.5 0-6 3.2-6 6a3 3 0 0 0 3 3c1.3 0 2-.8 3-.8s1.7.8 3 .8a3 3 0 0 0 3-3c0-2.8-3.5-6-6-6Z" /><ellipse cx="5" cy="8" rx="2" ry="3" /><ellipse cx="10" cy="5" rx="2" ry="3" /><ellipse cx="16" cy="5" rx="2" ry="3" /><ellipse cx="21" cy="8" rx="2" ry="3" /></>,
    savings: <><path d="M4 9h16v11H4zM7 9V6h10v3M8 14h8" /><path d="M12 3v3m-2-1h4" /></>,
    general: <><path d="M4 7h16v13H4zM7 7V4h10v3M8 12h8M8 16h5" /></>,
  }[iconName];

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">
        {paths}
      </g>
    </svg>
  );
}

function formatMoney(amount: number, currency: string) {
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
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export default function AdvancedTransactions({
  categories,
  categoriesError,
  categoriesLoading,
  currency,
  onRetryCategories,
  onSelectTransaction,
  transactions,
}: Props) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"ALL" | TransactionType>("ALL");
  const [categoryId, setCategoryId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filteredTransactions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return transactions.filter((transaction) => {
      if (transaction.currency !== currency) return false;
      if (type !== "ALL" && transaction.type !== type) return false;
      if (categoryId !== "all" && transaction.category?.id !== categoryId) return false;
      if (fromDate && transaction.transactionDate < fromDate) return false;
      if (toDate && transaction.transactionDate > toDate) return false;
      return !term || [
        transaction.description,
        transaction.category?.name,
        transaction.subCategory?.name,
      ].some((value) => value?.toLocaleLowerCase().includes(term));
    });
  }, [categoryId, currency, fromDate, search, toDate, transactions, type]);

  const expenseTotal = filteredTransactions
    .filter((transaction) => transaction.type === "EXPENSE")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const incomeTotal = filteredTransactions
    .filter((transaction) => transaction.type === "INCOME")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const categoryCounts = transactions.reduce<Record<string, number>>((counts, transaction) => {
    if (
      transaction.currency === currency &&
      (type === "ALL" || transaction.type === type) &&
      transaction.category?.id
    ) {
      counts[transaction.category.id] = (counts[transaction.category.id] ?? 0) + 1;
    }
    return counts;
  }, {});
  const visibleCategories = categories
    .filter((category) => (type === "ALL" || category.type === type) && (categoryCounts[category.id] ?? 0) > 0)
    .sort((first, second) =>
      (categoryCounts[second.id] ?? 0) - (categoryCounts[first.id] ?? 0)
      || categories.indexOf(first) - categories.indexOf(second)
    )
    .slice(0, type === "ALL" ? 3 : 6);

  function clearFilters() {
    setSearch("");
    setType("ALL");
    setCategoryId("all");
    setFromDate("");
    setToDate("");
  }

  return (
    <section className="advanced-transactions" aria-labelledby="advanced-transactions-title">
      <header className="advanced-transactions-heading">
        <div>
          <p className="eyebrow"><span className="advanced-heading-sparkle">✦</span> A little more clarity</p>
          <h1 id="advanced-transactions-title">Transaction search</h1>
          <p>Your spending, income, and everyday moments — all in one place.</p>
        </div>
        <span className="advanced-results-count"><strong>{filteredTransactions.length}</strong> matching transactions</span>
      </header>

      <div className="advanced-transaction-summary" aria-label="Filtered totals">
        <div className="is-spent">
          <span className="advanced-summary-icon" aria-hidden="true">↘</span>
          <span>Spent</span><strong>{formatMoney(expenseTotal, currency)}</strong>
        </div>
        <div className="is-income">
          <span className="advanced-summary-icon" aria-hidden="true">↗</span>
          <span>Income</span><strong>{formatMoney(incomeTotal, currency)}</strong>
        </div>
        <div className="is-net">
          <span className="advanced-summary-icon" aria-hidden="true">≈</span>
          <span>Net balance</span><strong>{formatMoney(incomeTotal - expenseTotal, currency)}</strong>
        </div>
      </div>

      <div className="advanced-filter-card">
        <div className="advanced-search-row">
          <label className="advanced-search-field">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.8" />
              <path d="m16 16 4.5 4.5" />
            </svg>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search a merchant, note, or category…"
              type="search"
              value={search}
            />
          </label>
          <div className="advanced-date-fields">
            <label>
              <span>From</span>
              <input aria-label="From date" onChange={(event) => setFromDate(event.target.value)} type="date" value={fromDate} />
            </label>
            <label>
              <span>To</span>
              <input aria-label="To date" onChange={(event) => setToDate(event.target.value)} type="date" value={toDate} />
            </label>
          </div>
        </div>
        <div className="advanced-type-filters" role="group" aria-label="Transaction type">
          {(["ALL", "EXPENSE", "INCOME"] as const).map((option) => (
            <button
              aria-pressed={type === option}
              className={type === option ? `is-active is-${option.toLowerCase()}` : ""}
              key={option}
              onClick={() => {
                setType(option);
                if (categoryId !== "all" && !categories.some((category) => category.id === categoryId && (option === "ALL" || category.type === option))) {
                  setCategoryId("all");
                }
              }}
              type="button"
            >
              {option === "ALL" ? "All activity" : option === "EXPENSE" ? "Expenses" : "Income"}
            </button>
          ))}
        </div>
        <div className="advanced-category-heading">
          <div>
            <span className="advanced-category-title">Categories</span>
            <small>{type === "ALL" ? "Your 3 most-used categories" : `Your ${Math.min(6, visibleCategories.length)} most-used ${type === "INCOME" ? "income" : "spending"} categories`}</small>
          </div>
          {(search || type !== "ALL" || categoryId !== "all" || fromDate || toDate) && (
            <button onClick={clearFilters} type="button">Clear filters</button>
          )}
        </div>
        <div className="advanced-category-filters">
          {visibleCategories.map((category) => {
            const [background, color] = CATEGORY_COLORS[categories.indexOf(category) % CATEGORY_COLORS.length];
            return (
              <button
                aria-pressed={categoryId === category.id}
                className={`advanced-category-chip${categoryId === category.id ? " is-active" : ""}`}
                style={{ "--category-tint": background, "--category-ink": color } as CSSProperties}
                key={category.id}
                onClick={() => setCategoryId(category.id)}
                type="button"
              >
                <span className="advanced-category-symbol" aria-hidden="true">
                  <CategoryIcon category={category} />
                </span>
                <span className="advanced-category-name">{category.name}</span>
                <small className="advanced-category-count">{categoryCounts[category.id] ?? 0} {(categoryCounts[category.id] ?? 0) === 1 ? "entry" : "entries"}</small>
              </button>
            );
          })}
          {visibleCategories.length === 0 && !categoriesLoading && !categoriesError && (
            <p className="advanced-no-used-categories">No used categories for this selection yet.</p>
          )}
        </div>
        {categoriesLoading && <p className="advanced-categories-status" role="status">Loading categories…</p>}
        {categoriesError && (
          <p className="advanced-categories-error" role="alert">
            {categoriesError} <button onClick={onRetryCategories} type="button">Retry</button>
          </p>
        )}
        {!categoriesLoading && !categoriesError && categories.length === 0 && (
          <p className="advanced-categories-status">No categories available yet.</p>
        )}
      </div>

      <div className="advanced-transaction-results">
        <div className="advanced-transaction-results-heading">
          <h2>Transactions</h2>
          <span>{filteredTransactions.length} {filteredTransactions.length === 1 ? "entry" : "entries"}</span>
        </div>
        {filteredTransactions.length ? (
          <div className="advanced-transaction-list">
            {filteredTransactions.map((transaction, index) => {
              const category = categories.find((item) => item.id === transaction.category?.id);
              const [background, color] = CATEGORY_COLORS[(category ? categories.indexOf(category) : index) % CATEGORY_COLORS.length];
              return (
                <button
                  aria-label={`${transaction.type === "INCOME" ? "Income" : "Expense"}: ${transaction.description || transaction.category?.name || "Transaction"}, ${formatMoney(transaction.amount, transaction.currency)}, ${formatDate(transaction.transactionDate)}. View details.`}
                  className="advanced-transaction-row"
                  key={transaction.id}
                  onClick={() => onSelectTransaction(transaction)}
                  type="button"
                >
                  <span className="advanced-transaction-icon" style={{ backgroundColor: background, color }}>
                    {category ? <CategoryIcon category={category} /> : transaction.type === "INCOME" ? "↗" : "↘"}
                  </span>
                  <span className="advanced-transaction-copy">
                    <strong>{transaction.description || transaction.category?.name || "Transaction"}</strong>
                    <small>{transaction.subCategory?.name || transaction.category?.name || "Uncategorized"}</small>
                  </span>
                  <span className="advanced-transaction-date">{formatDate(transaction.transactionDate)}</span>
                  <strong className={`advanced-transaction-amount is-${transaction.type.toLowerCase()}`}>
                    {transaction.type === "INCOME" ? "+" : "−"}{formatMoney(transaction.amount, transaction.currency)}
                  </strong>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="advanced-transactions-empty">
            <span aria-hidden="true">⌕</span>
            <strong>No matching transactions</strong>
            <p>Try a different search or clear some filters.</p>
            <button onClick={clearFilters} type="button">Clear filters</button>
          </div>
        )}
      </div>
    </section>
  );
}
