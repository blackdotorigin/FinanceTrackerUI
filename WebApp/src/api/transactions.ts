export type TransactionType = "INCOME" | "EXPENSE";
export type PaymentMode = "CASH" | "CREDIT" | "BANK_ACCOUNT";

export type Transaction = {
  id: string;
  amount: number;
  currency: string;
  type: TransactionType;
  paymentMode?: PaymentMode;
  transactionDate: string;
  description?: string | null;
  category?: { id: string; name: string };
  subCategory?: { id: string; name: string };
  createdAt?: string;
};

export type TransactionFilters = {
  type?: TransactionType;
  paymentMode?: PaymentMode;
  from?: string;
  to?: string;
  categoryId?: string;
  subCategoryId?: string;
};

type TransactionPage = {
  content: Transaction[];
  page?: { totalPages?: number; totalElements?: number };
};

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseTransactionPage(value: unknown): TransactionPage {
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
    const paymentMode = item.paymentMode === "CASH" || item.paymentMode === "CREDIT" || item.paymentMode === "BANK_ACCOUNT"
      ? item.paymentMode
      : undefined;
    return {
      id: item.id,
      amount: item.amount,
      currency: item.currency,
      type: item.type,
      paymentMode,
      transactionDate: item.transactionDate,
      description: typeof item.description === "string" ? item.description : null,
      category: parseReference(item.category),
      subCategory: parseReference(item.subCategory),
      createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
    };
  });
  const metadata = isObject(value.page) ? value.page : undefined;
  return {
    content,
    page: metadata
      ? {
          totalPages: typeof metadata.totalPages === "number" ? metadata.totalPages : undefined,
          totalElements: typeof metadata.totalElements === "number" ? metadata.totalElements : undefined,
        }
      : undefined,
  };
}

function buildQuery(filters: TransactionFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.paymentMode) params.set("paymentMode", filters.paymentMode);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.subCategoryId) params.set("subCategoryId", filters.subCategoryId);
  params.set("page", String(page));
  params.set("size", "100");
  params.set("sortBy", "DATE");
  params.set("direction", "DESC");
  return params.toString();
}

export async function fetchTransactions(
  apiFetch: ApiFetch,
  filters: TransactionFilters = {},
  getErrorMessage: (status: number) => string,
) {
  const seenIds = new Set<string>();
  const transactions: Transaction[] = [];
  const loadPage = async (pageNumber: number) => {
    const response = await apiFetch(`/api/v1/transactions?${buildQuery(filters, pageNumber)}`);
    if (!response.ok) throw new Error(getErrorMessage(response.status));
    return parseTransactionPage(await response.json());
  };
  const firstPage = await loadPage(0);
  const totalPages = firstPage.page?.totalPages;
  const totalElements = firstPage.page?.totalElements;
  const appendPage = (page: TransactionPage) => {
    for (const transaction of page.content) {
      if (seenIds.has(transaction.id)) {
        throw new Error("The transactions response repeated a page. Please retry loading your transactions.");
      }
      seenIds.add(transaction.id);
      transactions.push(transaction);
    }
  };
  appendPage(firstPage);

  if (totalPages !== undefined) {
    for (let start = 1; start < totalPages; start += 4) {
      const pages = await Promise.all(
        Array.from({ length: Math.min(4, totalPages - start) }, (_, index) => start + index)
          .map(loadPage),
      );
      pages.forEach(appendPage);
    }
  } else {
    let pageNumber = 1;
    let page = firstPage;
    while (page.content.length === 100) {
      page = await loadPage(pageNumber);
      appendPage(page);
      pageNumber += 1;
    }
  }

  if (totalElements !== undefined && transactions.length !== totalElements) {
    throw new Error("The transaction pages were incomplete. Please retry loading your transactions.");
  }
  return transactions;
}
