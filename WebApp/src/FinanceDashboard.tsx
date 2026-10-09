import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import AdminPanel from "./admin/AdminPanel";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080"
).replace(/\/+$/, "");
const PAGE_SIZE = 100;
let dashboardRefreshRequest: Promise<string> | null = null;

type User = {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  defaultCurrency?: string;
};

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
  createdAt?: string;
};

type Category = {
  id: string;
  name: string;
  type: TransactionType;
  icon?: string;
  subCategories?: { id: string; name: string }[];
};

type TransactionPage = {
  content: Transaction[];
  page?: { number?: number; size?: number; totalPages?: number; totalElements?: number };
};

type TransactionForm = {
  amount: string;
  type: TransactionType;
  transactionDate: string;
  categoryId: string;
  subCategoryId: string;
  description: string;
};

type Theme = "light" | "dark";

function getErrorMessage(status: number, action: string) {
  if (status === 401) return "Your session has expired. Please sign in again.";
  return `We couldn’t ${action} (server returned ${status}). Please try again.`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTransactionPage(value: unknown): TransactionPage {
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
      throw new Error("A transaction in the server response was not in the expected format.");
    }
    const parseReference = (reference: unknown) => {
      if (!isObject(reference) || typeof reference.id !== "string" || typeof reference.name !== "string") {
        return undefined;
      }
      return { id: reference.id, name: reference.name };
    };
    return {
      id: item.id,
      amount: item.amount,
      currency: item.currency,
      type: item.type,
      transactionDate: item.transactionDate,
      description: typeof item.description === "string" ? item.description : null,
      category: parseReference(item.category),
      subCategory: parseReference(item.subCategory),
    };
  });
  const metadata = isObject(value.page) ? value.page : undefined;
  return {
    content,
    page: metadata
      ? {
          totalPages:
            typeof metadata.totalPages === "number" ? metadata.totalPages : undefined,
          totalElements:
            typeof metadata.totalElements === "number" ? metadata.totalElements : undefined,
          number: typeof metadata.number === "number" ? metadata.number : undefined,
          size: typeof metadata.size === "number" ? metadata.size : undefined,
        }
      : undefined,
  };
}

function readJwtClaims(token: string): Record<string, unknown> | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isObject(claims) ? claims : undefined;
  } catch {
    return undefined;
  }
}

function hasAdminRole(claims: Record<string, unknown> | undefined) {
  if (!claims) return false;
  const values = [claims.role, claims.roles, claims.authorities].flatMap((claim) =>
    Array.isArray(claim) ? claim : [claim],
  );
  return values.some(
    (value) =>
      typeof value === "string" &&
      value.toUpperCase().replace(/^ROLE_/, "") === "ADMIN",
  );
}

function getTokenUserId(claims: Record<string, unknown> | undefined) {
  if (!claims) return undefined;
  for (const key of ["userId", "user_id", "id", "sub"]) {
    const value = claims[key];
    if (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ) {
      return value;
    }
  }
  return undefined;
}

function parseUser(value: unknown): User {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.username !== "string" ||
    typeof value.fullName !== "string"
  ) {
    throw new Error("The profile response was not in the expected format.");
  }
  return {
    id: value.id,
    username: value.username,
    fullName: value.fullName,
    email: typeof value.email === "string" ? value.email : undefined,
    defaultCurrency:
      typeof value.defaultCurrency === "string" ? value.defaultCurrency : undefined,
  };
}

function parseCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) {
    throw new Error("The categories response was not in the expected format.");
  }
  return value.map((item): Category => {
    if (
      !isObject(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      (item.type !== "INCOME" && item.type !== "EXPENSE")
    ) {
      throw new Error("A category in the server response was not in the expected format.");
    }
    const subCategories = Array.isArray(item.subCategories)
      ? item.subCategories.map((subcategory) => {
          if (
            !isObject(subcategory) ||
            typeof subcategory.id !== "string" ||
            typeof subcategory.name !== "string"
          ) {
            throw new Error("A subcategory in the server response was not in the expected format.");
          }
          return { id: subcategory.id, name: subcategory.name };
        })
      : [];
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      icon: typeof item.icon === "string" ? item.icon : undefined,
      subCategories,
    };
  });
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

function getTodayInputValue() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}

function useScrollZoom(loading: boolean, activeView: string) {
  useEffect(() => {
    if (loading) return;
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-scroll-zoom]"),
    );
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const center = window.innerHeight * 0.48;
        for (const element of elements) {
          const rect = element.getBoundingClientRect();
          const distance = Math.abs(rect.top + rect.height / 2 - center);
          const scale = Math.max(0.94, 1.025 - (distance / window.innerHeight) * 0.1);
          element.style.setProperty("--scroll-zoom", scale.toFixed(3));
        }
      });
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [activeView, loading]);
}

function Brand() {
  return (
    <a className="brand dashboard-brand" href="/" aria-label="FinanceFlow home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M7 22.5 13.2 16l4.3 4.1L25 11" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19.4 11H25v5.6" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>financeflow</span>
    </a>
  );
}

function Icon({ name }: { name: "plus" | "arrow" | "close" | "logout" | "wallet" | "income" | "expense" | "overview" | "transactions" | "reports" | "profile" | "admin" | "search" | "products" }) {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    wallet: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18M16 15h2" /><path d="M6 6V4h12v2" /></>,
    income: <><path d="M12 19V5m-6 6 6-6 6 6" /></>,
    expense: <><path d="M12 5v14m-6-6 6 6 6-6" /></>,
    overview: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    transactions: <><path d="M7 4h10l3 3v13H4V4h3Z" /><path d="M8 10h8M8 14h8M8 18h5" /></>,
    reports: <><path d="M4 19.5h16M6.5 16V10m5.5 6V5m5.5 11v-4" /><path d="M5 7.5 11 4l5 3 3-2" /></>,
    profile: <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.6-3.4 2.9-5.2 6.5-5.2s5.9 1.8 6.5 5.2" /></>,
    admin: <><path d="M12 3 20 6v5.2c0 4.6-3.1 7.8-8 9.8-4.9-2-8-5.2-8-9.8V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    products: <><rect x="3.5" y="4" width="7" height="7" rx="1.5" /><rect x="13.5" y="4" width="7" height="7" rx="1.5" /><rect x="3.5" y="14" width="7" height="6" rx="1.5" /><path d="M14 17h6m-3-3v6" /></>,
  };

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths[name] && <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</g>}
    </svg>
  );
}

export default function FinanceDashboard({
  accessToken,
  initialUsername,
  onAccessTokenChange,
  onLogout,
}: {
  accessToken: string;
  initialUsername: string;
  onAccessTokenChange: (token: string) => void;
  onLogout: () => void;
}) {
  const [theme, setTheme] = useState<Theme>(
    () => window.localStorage.getItem("financeflow-theme") === "dark" ? "dark" : "light",
  );
  const tokenRef = useRef(accessToken);
  const jwtClaims = useMemo(() => readJwtClaims(accessToken), [accessToken]);
  const isAdmin = hasAdminRole(jwtClaims);
  const adminUserId = getTokenUserId(jwtClaims);
  const [user, setUser] = useState<User | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFormError, setProfileFormError] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileCurrency, setProfileCurrency] = useState("");
  const transactionsStarted = useRef(false);
  const profileStarted = useRef(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState("");
  const [totalTransactions, setTotalTransactions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [transactionsLoaded, setTransactionsLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [productsMenuOpen, setProductsMenuOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeNav, setActiveNav] = useState<"overview" | "transactions" | "reports" | "profile" | "admin">("overview");
  const [form, setForm] = useState<TransactionForm>({
    amount: "",
    type: "EXPENSE",
    transactionDate: getTodayInputValue(),
    categoryId: "",
    subCategoryId: "",
    description: "",
  });
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    window.localStorage.setItem("financeflow-theme", theme);
  }, [theme]);

  useScrollZoom(loading, activeNav);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!profileOpen && !productsMenuOpen) return;
    const timeout = window.setTimeout(() => {
      setProfileOpen(false);
      setProductsMenuOpen(false);
    }, 2500);
    return () => window.clearTimeout(timeout);
  }, [profileOpen, productsMenuOpen]);

  useEffect(() => {
    if (!formOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) setFormOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [formOpen, submitting]);

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const send = (token: string) =>
        fetch(`${API_BASE_URL}${path}`, {
          ...init,
          credentials: "include",
          headers: {
            ...init.headers,
            Authorization: `Bearer ${token}`,
          },
        });

      const currentToken = tokenRef.current;
      let response = await send(currentToken);
      if (response.status === 401) {
        let refreshedToken = tokenRef.current === currentToken ? "" : tokenRef.current;
        if (!refreshedToken) {
          dashboardRefreshRequest ??= fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
            method: "POST",
            credentials: "include",
          }).then(async (refreshResponse) => {
            if (!refreshResponse.ok) {
              throw new Error(getErrorMessage(401, "load your account"));
            }
            const refreshed: unknown = await refreshResponse.json();
            if (
              !isObject(refreshed) ||
              typeof refreshed.accessToken !== "string" ||
              !refreshed.accessToken
            ) {
              throw new Error("The refreshed session response was not in the expected format.");
            }
            return refreshed.accessToken;
          }).finally(() => {
            dashboardRefreshRequest = null;
          });
          try {
            refreshedToken = await dashboardRefreshRequest;
          } catch (caught) {
            onLogout();
            throw caught;
          }
        }
        tokenRef.current = refreshedToken;
        onAccessTokenChange(refreshedToken);
        response = await send(refreshedToken);
        if (response.status === 401) {
          onLogout();
          throw new Error(getErrorMessage(401, "load your account"));
        }
      }
      return response;
    },
    [onAccessTokenChange, onLogout],
  );

  const loadTransactions = useCallback(async () => {
    const query = `?page=0&size=${PAGE_SIZE}&sortBy=DATE&direction=DESC`;
    const firstResponse = await apiFetch(`/api/v1/transactions${query}`);
    if (!firstResponse.ok) {
      throw new Error(getErrorMessage(firstResponse.status, "load your transactions"));
    }
    const firstPage = parseTransactionPage(await firstResponse.json());
    const pageCount = Math.max(1, firstPage.page?.totalPages ?? 1);
    const remaining: Transaction[][] = [];
    for (let start = 1; start < pageCount; start += 4) {
      const pages = await Promise.all(
        Array.from({ length: Math.min(4, pageCount - start) }, (_, index) => start + index).map(
          async (pageNumber) => {
            const response = await apiFetch(
              `/api/v1/transactions?page=${pageNumber}&size=${PAGE_SIZE}&sortBy=DATE&direction=DESC`,
            );
            if (!response.ok) {
              throw new Error(getErrorMessage(response.status, "load your transactions"));
            }
            return parseTransactionPage(await response.json()).content;
          },
        ),
      );
      remaining.push(...pages);
    }
    const allTransactions = [firstPage.content, ...remaining].flat();
    setTransactions(allTransactions);
    setTotalTransactions(firstPage.page?.totalElements ?? allTransactions.length);
  }, [apiFetch]);

  const refreshTransactions = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      await loadTransactions();
      setTransactionsLoaded(true);
    } catch (caught) {
      setLoadError(
        caught instanceof Error
          ? caught.message
          : "We couldn’t load your transactions. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [loadTransactions]);

  useEffect(() => {
    if (transactionsStarted.current) return;
    transactionsStarted.current = true;
    void refreshTransactions();
  }, [refreshTransactions]);

  const loadProfile = useCallback(async () => {
    if (profileStarted.current) return;
    profileStarted.current = true;
    setProfileLoading(true);
    setProfileError("");
    try {
      const response = await apiFetch("/api/v1/users/me");
      if (!response.ok) {
        throw new Error(getErrorMessage(response.status, "load your profile"));
      }
      const profile = parseUser(await response.json());
      setUser(profile);
      setProfileName(profile.fullName);
      setProfileCurrency(profile.defaultCurrency || "INR");
    } catch (caught) {
      profileStarted.current = false;
      setProfileError(
        caught instanceof Error
          ? caught.message
          : "We couldn’t load your profile. Please try again.",
      );
    } finally {
      setProfileLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const loadCategories = useCallback(async () => {
    if (categoriesLoaded || categoriesLoading) return;
    setCategoriesLoading(true);
    setCategoriesError("");
    try {
      const [incomeResponse, expenseResponse] = await Promise.all([
        apiFetch("/api/v1/categories?type=INCOME"),
        apiFetch("/api/v1/categories?type=EXPENSE"),
      ]);
      if (!incomeResponse.ok) {
        throw new Error(getErrorMessage(incomeResponse.status, "load income categories"));
      }
      if (!expenseResponse.ok) {
        throw new Error(getErrorMessage(expenseResponse.status, "load expense categories"));
      }
      const [incomeCategories, expenseCategories] = await Promise.all([
        incomeResponse.json().then(parseCategories),
        expenseResponse.json().then(parseCategories),
      ]);
      if (
        incomeCategories.some((category) => category.type !== "INCOME") ||
        expenseCategories.some((category) => category.type !== "EXPENSE")
      ) {
        throw new Error("The category response did not match the requested transaction type.");
      }
      setCategories([...incomeCategories, ...expenseCategories]);
      setCategoriesLoaded(true);
    } catch (caught) {
      setCategoriesError(
        caught instanceof Error
          ? caught.message
          : "We couldn’t load categories. Please try again.",
      );
    } finally {
      setCategoriesLoading(false);
    }
  }, [apiFetch, categoriesLoaded, categoriesLoading]);

  const currency = user?.defaultCurrency || transactions[0]?.currency || "INR";
  const totals = useMemo(() => {
    const currencyTransactions = transactions.filter((item) => item.currency === currency);
    return currencyTransactions.reduce(
      (result, transaction) => {
        if (transaction.type === "INCOME") result.income += transaction.amount;
        else result.expenses += transaction.amount;
        return result;
      },
      { income: 0, expenses: 0 },
    );
  }, [currency, transactions]);

  const visibleTransactions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return transactions.filter((transaction) => {
      const matchesCategory =
        categoryFilter === "all" || transaction.category?.id === categoryFilter;
      const matchesSearch =
        !normalizedSearch ||
        [transaction.description, transaction.category?.name, transaction.subCategory?.name]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalizedSearch));
      return matchesCategory && matchesSearch;
    });
  }, [categoryFilter, search, transactions]);

  const availableSubCategories =
    categories.find(
      (category) => category.id === form.categoryId && category.type === form.type,
    )?.subCategories ?? [];
  const transactionCategories = categories.filter((category) => category.type === form.type);

  function updateForm<K extends keyof TransactionForm>(key: K, value: TransactionForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeTransactionType(type: TransactionType) {
    setForm((current) => ({
      ...current,
      type,
      categoryId: "",
      subCategoryId: "",
    }));
  }

  function navigateTo(section: typeof activeNav) {
    setActiveNav(section);
    setProfileOpen(false);
    if (section === "profile") void loadProfile();
    if (section === "overview" || section === "transactions") {
      requestAnimationFrame(() => {
        document.getElementById(section === "overview" ? "overview" : "transactions")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function openTransactionForm() {
    setFormOpen(true);
    setFormError("");
    void loadCategories();
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileFormError("");
    const fullName = profileName.trim();
    const defaultCurrency = profileCurrency.trim().toUpperCase();
    if (!fullName || fullName.length > 150 || !/^[A-Z]{3}$/.test(defaultCurrency)) {
      setProfileFormError("Enter a name up to 150 characters and a valid 3-letter currency code.");
      return;
    }
    if (!user) {
      setProfileFormError("Your profile is not ready yet. Please try again.");
      return;
    }

    setProfileSaving(true);
    try {
      const response = await apiFetch(`/api/v1/users/${encodeURIComponent(user.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, defaultCurrency }),
      });
      if (!response.ok) {
        throw new Error(getErrorMessage(response.status, "save your profile"));
      }
      const updated = parseUser(await response.json());
      setUser(updated);
      setProfileName(updated.fullName);
      setProfileCurrency(updated.defaultCurrency || defaultCurrency);
      setProfileEditing(false);
      setNotice("Your profile has been updated.");
    } catch (caught) {
      setProfileFormError(
        caught instanceof Error
          ? caught.message
          : "We couldn’t save your profile. Please try again.",
      );
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleCreateTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setNotice("");

    const amount = Number(form.amount);
    const category = categories.find((item) => item.id === form.categoryId);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !category ||
      category.type !== form.type
    ) {
      setFormError("Enter an amount greater than zero and choose a category.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiFetch("/api/v1/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          currency,
          type: form.type,
          transactionDate: form.transactionDate,
          categoryId: form.categoryId,
          ...(form.subCategoryId ? { subCategoryId: form.subCategoryId } : {}),
          description: form.description.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(getErrorMessage(response.status, "save this transaction"));
      }
      await response.json();
      await loadTransactions();
      setForm({
        amount: "",
        type: "EXPENSE",
        transactionDate: getTodayInputValue(),
        categoryId: "",
        subCategoryId: "",
        description: "",
      });
      setFormOpen(false);
      setNotice("Transaction added. Your overview is up to date.");
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : "We couldn’t save this transaction. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        setLoadError(getErrorMessage(response.status, "sign out"));
        setProfileOpen(false);
        return;
      }
      onLogout();
    } catch {
      setLoadError("We couldn’t reach the server to sign out. Please try again.");
      setProfileOpen(false);
    }
  }

  if (loading) {
    return (
      <main className="dashboard-loading" role="status" aria-live="polite">
        <span className="loading-icon" />
        <p>Bringing your finances into focus…</p>
      </main>
    );
  }

  if (loadError && !transactionsLoaded) {
    return (
      <main className="dashboard-error">
        <Brand />
        <div className="dashboard-error-card">
          <p className="eyebrow">A little pause</p>
          <h1>Your overview couldn’t load.</h1>
          <p>{loadError}</p>
          <button className="dashboard-primary-button" onClick={() => void refreshTransactions()} type="button">
            Try again <Icon name="arrow" />
          </button>
          <button className="dashboard-text-button" onClick={onLogout} type="button">Back to sign in</button>
        </div>
      </main>
    );
  }

  return (
    <div className="dashboard-app" data-theme={theme}>
      <aside className={`dashboard-rail ${isAdmin ? "has-admin-nav" : ""}`} aria-label="Application">
        <Brand />
        <div className="rail-divider" />
        <p className="rail-section-label">YOUR SPACE</p>
        <nav className="rail-nav" aria-label="Main navigation">
          <button
            aria-label="Overview"
            aria-current={activeNav === "overview" ? "page" : undefined}
            className={`rail-nav-link ${activeNav === "overview" ? "is-active" : ""}`}
            onClick={() => navigateTo("overview")}
            type="button"
          >
            <Icon name="overview" /><span>Overview</span>
          </button>
          <button
            aria-label="Transactions"
            aria-current={activeNav === "transactions" ? "page" : undefined}
            className={`rail-nav-link ${activeNav === "transactions" ? "is-active" : ""}`}
            onClick={() => navigateTo("transactions")}
            type="button"
          >
            <Icon name="transactions" /><span>Transactions</span>
          </button>
          <button
            aria-label="Monthly reports"
            aria-current={activeNav === "reports" ? "page" : undefined}
            className={`rail-nav-link ${activeNav === "reports" ? "is-active" : ""}`}
            onClick={() => navigateTo("reports")}
            type="button"
          >
            <Icon name="reports" /><span>Monthly reports</span>
            <span className="nav-coming-soon">Soon</span>
          </button>
          <button
            aria-label="Profile"
            aria-current={activeNav === "profile" ? "page" : undefined}
            className={`rail-nav-link ${activeNav === "profile" ? "is-active" : ""}`}
            onClick={() => navigateTo("profile")}
            type="button"
          >
            <Icon name="profile" /><span>Profile</span>
          </button>
          {isAdmin && (
            <button
              aria-label="Admin panel"
              aria-current={activeNav === "admin" ? "page" : undefined}
              className={`rail-nav-link ${activeNav === "admin" ? "is-active" : ""}`}
              onClick={() => navigateTo("admin")}
              type="button"
            >
              <Icon name="admin" /><span>Admin panel</span>
            </button>
          )}
        </nav>
        <div className="rail-encouragement">
          <span className="rail-encouragement-icon"><Icon name="wallet" /></span>
          <strong>Small steps add up.</strong>
          <span>Every entry brings your money into clearer focus.</span>
        </div>
        <div className="rail-bottom">
          <span className="rail-status-dot" />
          <span>Everything in one place</span>
        </div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="dashboard-brand-cluster">
            <p className="dashboard-byline">Made with <span aria-label="love">♥</span> by Black Dot</p>
            <div className="products-dropdown-wrap">
              <button
                className="products-dropdown-trigger"
                aria-expanded={productsMenuOpen}
                aria-haspopup="menu"
                aria-label="Products menu"
                onClick={() => {
                  setProfileOpen(false);
                  setProductsMenuOpen((open) => !open);
                }}
                type="button"
              >
                Products
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {productsMenuOpen && (
                <div className="products-dropdown-menu" role="menu">
                  <p role="presentation">No products to show yet. Check back soon.</p>
                </div>
              )}
            </div>
          </div>
          <div className="profile-wrap">
            <button
              className="profile-button"
              aria-expanded={profileOpen}
              aria-haspopup="menu"
              aria-label={`Account menu for ${user?.fullName || initialUsername || "your account"}`}
              onClick={() => {
                setProductsMenuOpen(false);
                setProfileOpen((open) => !open);
              }}
              type="button"
            >
              <span className="profile-avatar">
                {(user?.fullName || user?.username || initialUsername || "A").slice(0, 1).toUpperCase()}
              </span>
              <span className="profile-name">{user?.fullName || initialUsername || "My account"}</span>
              <svg className="profile-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {profileOpen && (
              <div className="profile-menu" role="menu">
                <strong>{user?.fullName || initialUsername || "Your account"}</strong>
                <span>{user?.email || (user?.username ? `@${user.username}` : "Profile details")}</span>
                <button onClick={() => navigateTo("profile")} role="menuitem" type="button">
                  <Icon name="profile" /> View profile
                </button>
                <button
                  className="profile-theme-menu-item"
                  aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                  onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
                  role="menuitem"
                  type="button"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    {theme === "dark" ? (
                      <><circle cx="12" cy="12" r="3.7" /><path d="M12 2.5v2m0 15v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2.5 12h2m15 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
                    ) : (
                      <path d="M20.5 15.1A8.5 8.5 0 0 1 8.9 3.5 8.6 8.6 0 1 0 20.5 15.1Z" />
                    )}
                  </svg>
                  {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                </button>
                <button onClick={() => void handleLogout()} role="menuitem" type="button">
                  <Icon name="logout" /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className={`dashboard-content ${activeNav === "profile" ? "is-profile-page" : ""}`}>
          {activeNav === "admin" && isAdmin ? (
            <AdminPanel apiFetch={apiFetch} currentUserId={adminUserId} />
          ) : activeNav === "profile" ? (
            <section className="dashboard-subpage" aria-labelledby="profile-page-title">
              <div className="subpage-heading" data-scroll-zoom>
                <p className="eyebrow">Your account</p>
                <h1 id="profile-page-title">Profile & preferences</h1>
                <p>Manage the personal details and currency used in your account.</p>
              </div>
              {profileLoading ? (
                <div className="profile-loading-card" role="status">
                  <span className="loading-icon" />
                  <span>Loading your profile…</span>
                </div>
              ) : profileError ? (
                <div className="profile-loading-card profile-error-card" role="alert">
                  <p>{profileError}</p>
                  <button className="dashboard-primary-button" onClick={() => void loadProfile()} type="button">
                    Try again <Icon name="arrow" />
                  </button>
                </div>
              ) : user && (
              <article className="profile-details-card" data-scroll-zoom>
                <div className="profile-card-heading">
                  <span className="profile-card-avatar">
                    {(user.fullName || user.username || "A").slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <p className="eyebrow">Personal details</p>
                    <h2>{user.fullName || user.username}</h2>
                  </div>
                  {!profileEditing && (
                    <button
                      className="profile-edit-button"
                      onClick={() => {
                        setProfileName(user.fullName);
                        setProfileCurrency(user.defaultCurrency || "INR");
                        setProfileFormError("");
                        setProfileEditing(true);
                      }}
                      type="button"
                    >
                      Edit profile
                    </button>
                  )}
                </div>
                {profileEditing ? (
                  <form className="profile-edit-form" onSubmit={saveProfile}>
                    <label className="dashboard-field">
                      <span>Full name</span>
                      <input
                        autoComplete="name"
                        maxLength={150}
                        onChange={(event) => setProfileName(event.target.value)}
                        required
                        value={profileName}
                      />
                    </label>
                    <label className="dashboard-field">
                      <span>Default currency <small>3-letter code</small></span>
                      <input
                        autoCapitalize="characters"
                        maxLength={3}
                        onChange={(event) => setProfileCurrency(event.target.value.toUpperCase())}
                        placeholder="INR"
                        required
                        value={profileCurrency}
                      />
                    </label>
                    <p className="profile-edit-help">
                      Email and username can’t be changed from this screen.
                    </p>
                    {profileFormError && <p className="form-error" role="alert">{profileFormError}</p>}
                    <div className="profile-edit-actions">
                      <button
                        className="profile-cancel-button"
                        disabled={profileSaving}
                        onClick={() => {
                          setProfileEditing(false);
                          setProfileFormError("");
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button className="dashboard-primary-button" disabled={profileSaving} type="submit">
                        {profileSaving ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <dl className="profile-details-list">
                      <div><dt>Full name</dt><dd>{user.fullName || "Not provided"}</dd></div>
                      <div><dt>Username</dt><dd>@{user.username}</dd></div>
                      <div><dt>Email address</dt><dd>{user.email || "Not provided"}</dd></div>
                      <div><dt>Default currency</dt><dd>{currency}</dd></div>
                    </dl>
                    <p className="profile-readonly-note">
                      Update your name or default currency. Your login details stay unchanged.
                    </p>
                  </>
                )}
              </article>
              )}
            </section>
          ) : activeNav === "reports" ? (
            <section className="dashboard-subpage reports-page" aria-labelledby="reports-page-title">
              <div className="subpage-heading" data-scroll-zoom>
                <p className="eyebrow">A clearer view over time</p>
                <h1 id="reports-page-title">Monthly reports</h1>
                <p>Understand how your spending and income change from month to month.</p>
              </div>
              <article className="reports-coming-card" data-scroll-zoom>
                <span className="reports-illustration"><Icon name="reports" /></span>
                <span className="reports-status">COMING SOON</span>
                <h2>Your monthly story, at a glance.</h2>
                <p>
                  Monthly summaries and spending insights are on their way. For now,
                  you can explore every entry in your transactions.
                </p>
                <button className="dashboard-primary-button" onClick={() => navigateTo("transactions")} type="button">
                  Browse transactions <Icon name="arrow" />
                </button>
              </article>
            </section>
          ) : (
          <>
          <section className="dashboard-welcome" data-scroll-zoom id="overview">
            <div>
              <p className="eyebrow">Your money, made clearer</p>
              <h1>A little more in <span>balance.</span></h1>
              <p className="welcome-copy">
                All your transactions, thoughtfully brought together.
              </p>
            </div>
            <button
              className="dashboard-primary-button"
              onClick={openTransactionForm}
              type="button"
            >
              <Icon name="plus" /> Add transaction
            </button>
          </section>

          {loadError && <p className="dashboard-inline-error" role="alert">{loadError}</p>}
          {notice && (
            <div className="dashboard-toast" role="status" aria-live="polite">
              <span className="toast-check" aria-hidden="true">✓</span>
              <span className="toast-copy">
                <strong>Transaction added</strong>
                <span>Your overview is up to date.</span>
              </span>
              <span className="toast-progress" aria-hidden="true" />
            </div>
          )}

          <section className="dashboard-metrics" aria-label="Transaction summary" data-scroll-zoom>
            <article className="metric-card metric-balance">
              <span className="metric-icon"><Icon name="wallet" /></span>
              <p>Net movement <span>· {currency}</span></p>
              <strong>{formatMoney(totals.income - totals.expenses, currency)}</strong>
            </article>
            <article className="metric-card">
              <span className="metric-icon metric-income"><Icon name="income" /></span>
              <p>Total income <span>· {currency}</span></p>
              <strong>{formatMoney(totals.income, currency)}</strong>
            </article>
            <article className="metric-card">
              <span className="metric-icon metric-expense"><Icon name="expense" /></span>
              <p>Total expenses <span>· {currency}</span></p>
              <strong>{formatMoney(totals.expenses, currency)}</strong>
            </article>
          </section>

          <section className="transactions-section" data-scroll-zoom id="transactions">
            <div className="transactions-heading">
              <div>
                <p className="eyebrow">Your activity</p>
                <h2>Transactions <span>{totalTransactions}</span></h2>
              </div>
            </div>
            <div className="transaction-toolbar">
              <label className="transaction-search">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.7" />
                  <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
                <input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search transactions"
                  value={search}
                />
              </label>
              <select
                aria-label="Filter by category"
                onFocus={() => void loadCategories()}
                onChange={(event) => setCategoryFilter(event.target.value)}
                value={categoryFilter}
              >
                <option value="all">All categories</option>
                {categoriesLoading && <option disabled>Loading categories…</option>}
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
            {categoriesError && (
              <p className="category-load-error" role="alert">
                {categoriesError} <button onClick={() => void loadCategories()} type="button">Retry</button>
              </p>
            )}

            {visibleTransactions.length > 0 ? (
              <div className="transactions-table-wrap">
                <table className="transactions-table">
                  <thead>
                    <tr><th scope="col">Description</th><th scope="col">Category</th><th scope="col">Date</th><th scope="col">Amount</th></tr>
                  </thead>
                  <tbody>
                    {visibleTransactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td>
                          <div className="transaction-description">
                            <span className={`transaction-type-icon ${transaction.type === "INCOME" ? "is-income" : ""}`}>
                              <Icon name={transaction.type === "INCOME" ? "income" : "expense"} />
                            </span>
                            <span>
                              <strong>{transaction.description || transaction.category?.name || "Transaction"}</strong>
                              <small>{transaction.subCategory?.name || transaction.category?.name || "Uncategorized"}</small>
                            </span>
                          </div>
                        </td>
                        <td><span className="category-pill">{transaction.category?.name || "Other"}</span></td>
                        <td className="transaction-date">{formatDate(transaction.transactionDate)}</td>
                        <td className={`transaction-amount ${transaction.type === "INCOME" ? "is-income" : ""}`}>
                          {transaction.type === "INCOME" ? "+" : "−"}{formatMoney(transaction.amount, transaction.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-transactions">
                <span className="empty-wallet"><Icon name="wallet" /></span>
                <h3>{transactions.length === 0 ? "Your story starts here." : "No matches this time."}</h3>
                <p>
                  {transactions.length === 0
                    ? "Add your first transaction and start seeing the bigger picture."
                    : "Try another search or choose a different category."}
                </p>
                {transactions.length === 0 && (
                  <button className="dashboard-primary-button" onClick={openTransactionForm} type="button">
                    <Icon name="plus" /> Add transaction
                  </button>
                )}
              </div>
            )}
            <div className="transaction-footer">
              <span>Showing {visibleTransactions.length} of {totalTransactions} transactions</span>
              {transactions.some((transaction) => transaction.currency !== currency) && (
                <span>Summary totals include {currency} transactions only.</span>
              )}
            </div>
          </section>
          <footer className="dashboard-footer">A clearer view, one day at a time.</footer>
          </>
          )}
        </main>
      </div>

      {formOpen && (
        <div
          className="transaction-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) setFormOpen(false);
          }}
        >
          <section
            aria-labelledby="transaction-modal-title"
            aria-modal="true"
            className="transaction-modal"
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Keep the picture complete</p>
                <h2 id="transaction-modal-title">Add a transaction</h2>
              </div>
              <button
                aria-label="Close"
                className="modal-close"
                disabled={submitting}
                onClick={() => setFormOpen(false)}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
            <form className="transaction-form" onSubmit={handleCreateTransaction}>
              {categoriesLoading && (
                <p className="category-loading-note" role="status">Loading categories…</p>
              )}
              {categoriesError && (
                <p className="form-error" role="alert">
                  {categoriesError} <button onClick={() => void loadCategories()} type="button">Retry</button>
                </p>
              )}
              <div className="type-switch" role="group" aria-label="Transaction type">
                <button
                  aria-pressed={form.type === "EXPENSE"}
                  className={form.type === "EXPENSE" ? "selected" : ""}
                  onClick={() => changeTransactionType("EXPENSE")}
                  type="button"
                >
                  <Icon name="expense" /> Expense
                </button>
                <button
                  aria-pressed={form.type === "INCOME"}
                  className={form.type === "INCOME" ? "selected" : ""}
                  onClick={() => changeTransactionType("INCOME")}
                  type="button"
                >
                  <Icon name="income" /> Income
                </button>
              </div>
              <label className="dashboard-field">
                <span>Amount <small>{currency}</small></span>
                <input
                  min="0.01"
                  onChange={(event) => updateForm("amount", event.target.value)}
                  placeholder="0.00"
                  required
                  step="0.01"
                  type="number"
                  value={form.amount}
                />
              </label>
              <div className="form-grid">
                <label className="dashboard-field">
                  <span>Category</span>
                  <select
                    disabled={categoriesLoading || categoriesError !== ""}
                    onChange={(event) => {
                      updateForm("categoryId", event.target.value);
                      updateForm("subCategoryId", "");
                    }}
                    required
                    value={form.categoryId}
                  >
                    <option value="">
                      {categoriesLoading
                        ? "Loading categories…"
                        : categoriesError
                          ? "Categories unavailable"
                          : `Choose ${form.type === "INCOME" ? "income" : "expense"} category`}
                    </option>
                    {transactionCategories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label className="dashboard-field">
                  <span>Subcategory <small>Optional</small></span>
                  <select
                    disabled={availableSubCategories.length === 0}
                    onChange={(event) => updateForm("subCategoryId", event.target.value)}
                    value={form.subCategoryId}
                  >
                    <option value="">None</option>
                    {availableSubCategories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-grid">
                <label className="dashboard-field">
                  <span>Date</span>
                  <input
                    onChange={(event) => updateForm("transactionDate", event.target.value)}
                    required
                    type="date"
                    value={form.transactionDate}
                  />
                </label>
                <label className="dashboard-field">
                  <span>Description <small>Optional</small></span>
                  <input
                    maxLength={255}
                    onChange={(event) => updateForm("description", event.target.value)}
                    placeholder="What was this for?"
                    value={form.description}
                  />
                </label>
              </div>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              {categoriesLoaded && transactionCategories.length === 0 && (
                <p className="form-error" role="alert">
                  No {form.type.toLowerCase()} categories are available, so this transaction can’t be saved yet.
                </p>
              )}
              <button className="dashboard-primary-button modal-submit" disabled={submitting || categoriesLoading || categoriesError !== "" || (categoriesLoaded && transactionCategories.length === 0)} type="submit">
                {submitting ? "Saving transaction…" : "Save transaction"}
                {!submitting && <Icon name="arrow" />}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
