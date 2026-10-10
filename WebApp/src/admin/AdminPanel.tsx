import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./admin.css";

type User = {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  defaultCurrency?: string;
};

type Transaction = {
  id: string;
  amount: number;
  currency: string;
  type: "INCOME" | "EXPENSE";
  transactionDate: string;
  description?: string | null;
  category?: { id: string; name: string };
  subCategory?: { id: string; name: string };
};

type TransactionPage = {
  content: Transaction[];
  page?: { number?: number; totalPages?: number; totalElements?: number };
};

type SortField = "DATE" | "AMOUNT" | "CREATED";
type SortDirection = "ASC" | "DESC";
type UserRole = "USER" | "ADMIN";
type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

const PAGE_SIZE = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUser(value: unknown): User {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.username !== "string" ||
    typeof value.fullName !== "string"
  ) {
    throw new Error("The user response was not in the expected format.");
  }
  return {
    id: value.id,
    username: value.username,
    fullName: value.fullName,
    email: typeof value.email === "string" ? value.email : undefined,
    defaultCurrency: typeof value.defaultCurrency === "string" ? value.defaultCurrency : undefined,
  };
}

function parseTransactions(value: unknown): TransactionPage {
  if (!isObject(value) || !Array.isArray(value.content)) {
    throw new Error("The transactions response was not in the expected format.");
  }
  const content = value.content.map((item): Transaction => {
    if (
      !isObject(item) ||
      typeof item.id !== "string" ||
      typeof item.amount !== "number" ||
      !Number.isFinite(item.amount) ||
      typeof item.currency !== "string" ||
      (item.type !== "INCOME" && item.type !== "EXPENSE") ||
      typeof item.transactionDate !== "string"
    ) {
      throw new Error("A transaction in the response was not in the expected format.");
    }
    const reference = (candidate: unknown) =>
      isObject(candidate) && typeof candidate.id === "string" && typeof candidate.name === "string"
        ? { id: candidate.id, name: candidate.name }
        : undefined;
    return {
      id: item.id,
      amount: item.amount,
      currency: item.currency,
      type: item.type,
      transactionDate: item.transactionDate,
      description: typeof item.description === "string" ? item.description : null,
      category: reference(item.category),
      subCategory: reference(item.subCategory),
    };
  });
  const page = isObject(value.page) ? value.page : undefined;
  return {
    content,
    page: page
      ? {
          number: typeof page.number === "number" ? page.number : undefined,
          totalPages: typeof page.totalPages === "number" ? page.totalPages : undefined,
          totalElements: typeof page.totalElements === "number" ? page.totalElements : undefined,
        }
      : undefined,
  };
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthStart() {
  return `${today().slice(0, 7)}-01`;
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function statusError(status: number, action: string) {
  if (status === 401) return "Your session has expired. Please sign in again.";
  return `We couldn’t ${action} (server returned ${status}). Please try again.`;
}

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function CalendarDatePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const selected = parseDate(value);
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const pickerRef = useRef<HTMLDivElement>(null);
  const todayValue = dateValue(new Date());
  const selectedDate = parseDate(value);
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);
  const formattedDate = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(selectedDate);
  const days = useMemo(() => {
    const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const calendarStart = new Date(firstDay);
    calendarStart.setDate(firstDay.getDate() - offset);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(calendarStart);
      day.setDate(calendarStart.getDate() + index);
      return day;
    });
  }, [visibleMonth]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function moveMonth(amount: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  function chooseDate(date: Date) {
    onChange(dateValue(date));
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setOpen(false);
  }

  return (
    <div className="admin-wizard-date-field" ref={pickerRef}>
      <span className="admin-wizard-date-label">{label}</span>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label}: ${formattedDate}`}
        className="admin-wizard-date-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
          <path d="M7.5 3v4M16.5 3v4M3.5 10h17" />
        </svg>
        <span>{formattedDate}</span>
        <svg className="admin-date-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          aria-label={`Choose ${label.toLowerCase()} date`}
          className="admin-calendar-popover"
          role="dialog"
        >
          <div className="admin-calendar-heading">
            <button aria-label="Previous month" onClick={() => moveMonth(-1)} type="button">‹</button>
            <strong>{monthLabel}</strong>
            <button aria-label="Next month" onClick={() => moveMonth(1)} type="button">›</button>
          </div>
          <div aria-hidden="true" className="admin-calendar-grid admin-calendar-weekdays">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="admin-calendar-grid admin-calendar-days">
            {days.map((date) => {
              const dateString = dateValue(date);
              const outsideMonth = date.getMonth() !== visibleMonth.getMonth();
              const selected = dateString === value;
              const isToday = dateString === todayValue;
              return (
                <button
                  aria-label={new Intl.DateTimeFormat(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  }).format(date)}
                  aria-pressed={selected}
                  className={[
                    outsideMonth ? "is-outside-month" : "",
                    selected ? "is-selected" : "",
                    isToday ? "is-today" : "",
                  ].filter(Boolean).join(" ")}
                  key={dateString}
                  onClick={() => chooseDate(date)}
                  type="button"
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="admin-calendar-footer">
            <button onClick={() => chooseDate(new Date())} type="button">Today</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPanel({
  apiFetch,
  currentUserId,
}: {
  apiFetch: ApiFetch;
  currentUserId?: string;
}) {
  const [userId, setUserId] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<"account" | "edit" | "transactions">("account");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deactivationConfirmOpen, setDeactivationConfirmOpen] = useState(false);
  const deactivationDialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fullName, setFullName] = useState("");
  const [currency, setCurrency] = useState("");
  const [role, setRole] = useState<UserRole | "">("");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [sortBy, setSortBy] = useState<SortField>("DATE");
  const [direction, setDirection] = useState<SortDirection>("DESC");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsLoaded, setTransactionsLoaded] = useState(false);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState("");
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const dialog = deactivationDialogRef.current;
    if (!dialog) return;
    if (deactivationConfirmOpen && !dialog.open) dialog.showModal();
    if (!deactivationConfirmOpen && dialog.open) dialog.close();
  }, [deactivationConfirmOpen]);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = userId.trim();
    setError("");
    setNotice("");
    setTransactions([]);
    setTransactionsLoaded(false);
    setTransactionsError("");
    if (!UUID_PATTERN.test(id)) {
      setError("Enter a valid user UUID.");
      return;
    }
    setLoading(true);
    setUser(null);
    try {
      const response = await apiFetch(`/api/v1/users/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error(statusError(response.status, "find this user"));
      const result = parseUser(await response.json());
      setUser(result);
      setFullName(result.fullName);
      setCurrency(result.defaultCurrency || "");
      setFrom(monthStart());
      setTo(today());
      setPage(0);
      setRole("");
      setView("account");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn’t find this user.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTransactions(pageNumber = 0) {
    if (!user) return;
    if (!from || !to || from > to) {
      setTransactionsError("Choose a valid date range.");
      return;
    }
    setTransactionsLoading(true);
    setTransactionsLoaded(false);
    setTransactionsError("");
    try {
      const query = new URLSearchParams({
        from,
        to,
        page: String(pageNumber),
        size: String(PAGE_SIZE),
        sortBy,
        direction,
      });
      const response = await apiFetch(
        `/api/v1/admin/users/${encodeURIComponent(user.id)}/transactions?${query}`,
      );
      if (!response.ok) throw new Error(statusError(response.status, "load this user’s transactions"));
      const result = parseTransactions(await response.json());
      setTransactions(result.content);
      setPage(result.page?.number ?? pageNumber);
      setPageCount(result.page?.totalPages ?? 0);
      setTotal(result.page?.totalElements ?? result.content.length);
      setTransactionsLoaded(true);
    } catch (caught) {
      setTransactionsError(
        caught instanceof Error ? caught.message : "We couldn’t load this user’s transactions.",
      );
    } finally {
      setTransactionsLoading(false);
    }
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const name = fullName.trim();
    const defaultCurrency = currency.trim().toUpperCase();
    if (!name || name.length > 150 || !/^[A-Z]{3}$/.test(defaultCurrency)) {
      setError("Enter a name up to 150 characters and a valid 3-letter currency code.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/users/${encodeURIComponent(user.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name, defaultCurrency }),
      });
      if (!response.ok) throw new Error(statusError(response.status, "update this user"));
      setUser(parseUser(await response.json()));
      setView("account");
      setNotice("Account details updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn’t update this user.");
    } finally {
      setSaving(false);
    }
  }

  async function updateRole() {
    if (!user || !role || user.id === currentUserId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(
        `/api/v1/admin/users/${encodeURIComponent(user.id)}/role?role=${role}`,
        { method: "PATCH" },
      );
      if (!response.ok) throw new Error(statusError(response.status, "change this user’s role"));
      setUser(parseUser(await response.json()));
      setNotice("Role update request accepted. The API response does not include the saved role.");
      setRole("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn’t change this user’s role.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateUser() {
    if (!user || user.id === currentUserId) return;
    setDeactivationConfirmOpen(false);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(statusError(response.status, "deactivate this user"));
      setUser(null);
      setTransactions([]);
      setTransactionsLoaded(false);
      setNotice("The account has been deactivated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn’t deactivate this account.");
    } finally {
      setSaving(false);
    }
  }

  const isSelf = !!user && user.id === currentUserId;

  return (
    <section className="admin-wizard" aria-labelledby="admin-page-title">
      <header className="admin-wizard-hero">
        <span className="admin-wizard-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 3 20 6v5c0 4.5-3.1 7.7-8 9.8C7.1 18.7 4 15.5 4 11V6l8-3Z" /><path d="m9 12 2 2 4-4" /></svg>
        </span>
        <div>
          <p>FINANCEFLOW · CONTROL ROOM</p>
          <h1 id="admin-page-title">Admin panel</h1>
          <span>Account access, thoughtfully organized.</span>
        </div>
        <span className="admin-wizard-badge">ADMIN</span>
      </header>

      <div className="admin-wizard-steps" aria-label="Admin workflow">
        <span className={!user ? "is-current" : "is-complete"}><i>1</i> Find a user</span>
        <b />
        <span className={user ? "is-current" : ""}><i>2</i> Choose an action</span>
      </div>

      <form className="admin-wizard-search" onSubmit={lookup}>
        <label htmlFor="admin-user-id">User ID</label>
        <div>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>
          <input
            autoComplete="off"
            id="admin-user-id"
            onChange={(event) => setUserId(event.target.value)}
            placeholder="Paste the user UUID"
            spellCheck={false}
            value={userId}
          />
          {user && (
            <button type="button" onClick={() => { setUser(null); setView("account"); setError(""); setNotice(""); }}>
              Change
            </button>
          )}
        </div>
        {!user && (
          <button className="admin-wizard-primary" disabled={loading} type="submit">
            {loading ? "Finding user…" : "Continue"}
            {!loading && <span aria-hidden="true">→</span>}
          </button>
        )}
      </form>

      {error && <p className="admin-wizard-message is-error" role="alert">{error}</p>}
      {notice && <p className="admin-wizard-message is-success" role="status">{notice}</p>}

      {user && (
        <div className="admin-wizard-content">
          <article className="admin-wizard-user">
            <span className="admin-wizard-avatar">{(user.fullName || user.username || "U").slice(0, 1).toUpperCase()}</span>
            <div className="admin-wizard-identity">
              <span>ACCOUNT FOUND</span>
              <h2>{user.fullName || user.username}</h2>
              <p>{user.email || `@${user.username}`}</p>
            </div>
            <span className="admin-wizard-active"><i /> Active</span>
            <div className="admin-wizard-meta">
              <span><small>USERNAME</small>@{user.username}</span>
              <span><small>CURRENCY</small>{user.defaultCurrency || "Not set"}</span>
              <span className="admin-wizard-uuid"><small>USER ID</small>{user.id}</span>
            </div>
          </article>

          <nav className="admin-wizard-actions" aria-label="User actions">
            <button className={view === "edit" ? "is-selected" : ""} onClick={() => { setView("edit"); setError(""); setNotice(""); }} type="button">
              <span className="admin-action-icon">✎</span>
              <span><strong>Edit account</strong><small>Update profile and access</small></span>
              <b aria-hidden="true">→</b>
            </button>
            <button className={view === "transactions" ? "is-selected" : ""} onClick={() => { setView("transactions"); setError(""); setNotice(""); if (!transactionsLoaded) void loadTransactions(0); }} type="button">
              <span className="admin-action-icon">↗</span>
              <span><strong>View transactions</strong><small>Review account activity</small></span>
              <b aria-hidden="true">→</b>
            </button>
          </nav>

          {view === "edit" && (
            <section className="admin-wizard-panel">
              <div className="admin-panel-heading"><span>01 / ACCOUNT</span><h3>Edit user details</h3><p>Manage account information and access controls.</p></div>
              <form className="admin-wizard-edit" onSubmit={saveUser}>
                <label>Full name<input maxLength={150} onChange={(event) => setFullName(event.target.value)} required value={fullName} /></label>
                <label>Default currency<input maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} required value={currency} /></label>
                <div className="admin-wizard-edit-footer">
                  <p>Email and username can’t be changed.</p>
                  <button className="admin-wizard-primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save details"}</button>
                </div>
              </form>
              <div className="admin-wizard-access">
                <div><span>ACCESS ROLE</span><p>The API doesn’t return the current role.</p></div>
                <div className="admin-wizard-role">
                  <select aria-label="New user role" onChange={(event) => setRole(event.target.value as UserRole | "")} value={role}>
                    <option value="">Select role</option><option value="USER">USER</option><option value="ADMIN">ADMIN</option>
                  </select>
                  <button className="admin-wizard-secondary" disabled={!role || saving || isSelf} onClick={() => void updateRole()} type="button">{saving ? "Applying…" : "Apply role"}</button>
                </div>
                {isSelf && <small className="admin-wizard-hint">You can’t change or deactivate your own account.</small>}
              </div>
              <p className="admin-wizard-token-note">Role changes take effect after the user receives a new access token.</p>
              <button className="admin-wizard-danger" disabled={saving || isSelf} onClick={() => setDeactivationConfirmOpen(true)} type="button">Deactivate this account</button>
            </section>
          )}

          {view === "transactions" && (
            <section className="admin-wizard-panel">
              <div className="admin-panel-heading"><span>02 / ACTIVITY</span><h3>Transactions <em>{transactionsLoaded ? total : "—"}</em></h3><p>Choose a date range and sort to explore this account.</p></div>
              <form className="admin-wizard-filters" onSubmit={(event) => { event.preventDefault(); void loadTransactions(0); }}>
                <CalendarDatePicker label="From" onChange={setFrom} value={from} />
                <CalendarDatePicker label="To" onChange={setTo} value={to} />
                <label>Sort by<select onChange={(event) => setSortBy(event.target.value as SortField)} value={sortBy}><option value="DATE">Date</option><option value="AMOUNT">Amount</option><option value="CREATED">Created</option></select></label>
                <label>Direction<select onChange={(event) => setDirection(event.target.value as SortDirection)} value={direction}><option value="DESC">Newest first</option><option value="ASC">Oldest first</option></select></label>
                <button className="admin-wizard-primary" disabled={transactionsLoading} type="submit">{transactionsLoading ? "Loading…" : "Update results"}</button>
              </form>
              {transactionsError && <p className="admin-wizard-message is-error" role="alert">{transactionsError}</p>}
              {transactionsLoading ? (
                <div className="admin-wizard-loading" role="status">Loading transactions…</div>
              ) : transactionsLoaded && transactions.length > 0 ? (
                <>
                  <div className="admin-wizard-table-wrap"><table className="admin-wizard-table">
                    <thead><tr><th>Description</th><th>Category</th><th>Date</th><th>Amount</th></tr></thead>
                    <tbody>{transactions.map((item) => <tr key={item.id}>
                      <td><strong>{item.description || item.category?.name || "Transaction"}</strong><small>{item.subCategory?.name || item.category?.name || "Uncategorized"}</small></td>
                      <td>{item.category?.name || "Other"}</td><td>{formatDate(item.transactionDate)}</td>
                      <td className={item.type === "INCOME" ? "is-income" : ""}>{item.type === "INCOME" ? "+" : "−"}{formatMoney(item.amount, item.currency)}</td>
                    </tr>)}</tbody>
                  </table></div>
                  <div className="admin-wizard-pagination"><span>Page {page + 1} of {Math.max(pageCount, 1)} · {total} records</span>
                    <div><button disabled={page <= 0 || transactionsLoading} onClick={() => void loadTransactions(page - 1)} type="button">Previous</button>
                    <button disabled={page + 1 >= pageCount || transactionsLoading} onClick={() => void loadTransactions(page + 1)} type="button">Next</button></div>
                  </div>
                </>
              ) : transactionsLoaded ? (
                <div className="admin-wizard-empty"><strong>No transactions here yet</strong><span>Try changing the selected date range.</span></div>
              ) : null}
            </section>
          )}
        </div>
      )}
      <dialog
        aria-describedby={user ? "admin-deactivation-description" : undefined}
        aria-labelledby="admin-deactivation-title"
        className="admin-deactivation-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setDeactivationConfirmOpen(false);
        }}
        ref={deactivationDialogRef}
      >
        <span className="admin-deactivation-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 3 21 19H3L12 3Z" />
            <path d="M12 9v4m0 3h.01" />
          </svg>
        </span>
        <p className="admin-deactivation-eyebrow">ACCOUNT ACCESS</p>
        <h2 id="admin-deactivation-title">Deactivate this account?</h2>
        {user && (
          <p className="admin-deactivation-description" id="admin-deactivation-description">
            <strong>{user.fullName || user.username}</strong> (@{user.username}) will lose access to FinanceFlow. You can’t undo this action here.
          </p>
        )}
        <div className="admin-deactivation-actions">
          <button
            autoFocus
            className="admin-deactivation-cancel"
            onClick={() => setDeactivationConfirmOpen(false)}
            type="button"
          >
            Keep account
          </button>
          <button
            className="admin-deactivation-confirm"
            disabled={saving}
            onClick={() => void deactivateUser()}
            type="button"
          >
            Deactivate account
          </button>
        </div>
      </dialog>
    </section>
  );
}
