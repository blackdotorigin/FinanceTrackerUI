import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { TransactionType } from "../api/transactions";
import {
  escapeCsv,
  mapImportSheet,
  parseCsv,
  parseFirstWorksheet,
  type ImportRow,
  type ImportSheet,
} from "./transactionImport";

type Category = {
  id: string;
  name: string;
  type: TransactionType;
  subCategories?: { id: string; name: string }[];
};

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

type ImportResult = {
  importedCount: number;
  errors: { rowNumber: number; messages: string[] }[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseDate(value: string) {
  const input = value.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(input);
  const monthName = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(input)
    ?? /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(input);
  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else if (dayFirst) {
    [, day, month, year] = dayFirst.map(Number);
  } else if (monthName) {
    const isDayFirst = /^\d+$/.test(monthName[1]);
    const monthText = (isDayFirst ? monthName[2] : monthName[1]).toLowerCase();
    const monthNumber = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ].findIndex((name) => name.startsWith(monthText));
    if (monthNumber < 0 || monthText.length < 3) return "";
    if (isDayFirst) {
      day = Number(monthName[1]);
      month = monthNumber + 1;
      year = Number(monthName[3]);
    } else {
      month = monthNumber + 1;
      day = Number(monthName[2]);
      year = Number(monthName[3]);
    }
  } else {
    return "";
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : "";
}

function parseAmount(value: string) {
  const input = value.trim();
  if (!input) return undefined;
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+|\.\d+)(?:\.\d+)?$/.test(input)) {
    return Number.NaN;
  }
  const amount = Number(input.replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : Number.NaN;
}

function resolveCategory(value: string, categories: Category[]) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return { id: "", ambiguous: false };
  const matches = categories.filter((category) =>
    category.id.toLocaleLowerCase() === normalized ||
    category.name.toLocaleLowerCase() === normalized,
  );
  return {
    id: matches.length === 1 ? matches[0].id : "",
    ambiguous: matches.length > 1,
  };
}

function resolveSubcategory(value: string, category: Category | undefined) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized || !category) return { id: "", issue: "" };
  const matches = (category.subCategories ?? []).filter((subcategory) =>
    subcategory.id.toLocaleLowerCase() === normalized ||
    subcategory.name.toLocaleLowerCase() === normalized,
  );
  return {
    id: matches.length === 1 ? matches[0].id : "",
    issue: matches.length > 1
      ? "This subcategory name is ambiguous; choose the subcategory by ID."
      : matches.length === 0 ? "The subcategory did not match the selected category." : "",
  };
}

function csvCell(value: string) {
  return escapeCsv(value);
}

function categoryLabel(category: Category, categories: Category[]) {
  const duplicateName = categories.filter((item) =>
    item.name.toLocaleLowerCase() === category.name.toLocaleLowerCase(),
  ).length > 1;
  return duplicateName
    ? `${category.name} · ${category.type.toLowerCase()} · ${category.id}`
    : `${category.name} · ${category.type.toLowerCase()}`;
}

function subcategoryLabel(
  subcategory: { id: string; name: string },
  category: Category | undefined,
) {
  const duplicateName = (category?.subCategories ?? []).filter((item) =>
    item.name.toLocaleLowerCase() === subcategory.name.toLocaleLowerCase(),
  ).length > 1;
  return duplicateName ? `${subcategory.name} · ${subcategory.id}` : subcategory.name;
}

export default function TransactionImportDialog({
  apiFetch,
  categories,
  categoriesLoading,
  categoriesError,
  currency,
  onClose,
  onCategoriesRetry,
  onImported,
}: {
  apiFetch: ApiFetch;
  categories: Category[];
  categoriesLoading: boolean;
  categoriesError: string;
  currency: string;
  onClose: () => void;
  onCategoriesRetry: () => void;
  onImported: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [usesDebitCredit, setUsesDebitCredit] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [importError, setImportError] = useState("");
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkSubcategoryId, setBulkSubcategoryId] = useState("");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, submitting]);

  useEffect(() => {
    if (!categories.length) return;
    setRows((current) => current.map((row) => {
      if (row.categoryId || !row.categoryValue.trim()) return row;
      const match = resolveCategory(row.categoryValue, categories);
      const category = categories.find((item) => item.id === match.id);
      const subcategoryMatch = resolveSubcategory(row.subcategoryValue, category);
      return {
        ...row,
        categoryId: match.id,
        subCategoryId: subcategoryMatch.id,
        categoryIssue: match.ambiguous
          ? "This category name is ambiguous; choose the category by ID."
          : match.id ? "" : "The category did not match an active category name or ID.",
        subcategoryIssue: row.subcategoryValue.trim()
          ? category ? subcategoryMatch.issue : "Subcategory cannot be checked until the category is valid."
          : "",
      };
    }));
  }, [categories]);

  const rowErrors = useMemo(() => rows.map((row) => {
    const errors = [...row.serverErrors];
    const transactionDate = parseDate(row.date);
    if (!transactionDate) errors.push("Enter a supported transaction date.");
    if (!row.description.trim()) errors.push("Description is required.");
    if (row.description.length > 255) errors.push("Description must be 255 characters or fewer.");

    let amount: number | undefined;
    if (usesDebitCredit) {
      const debit = parseAmount(row.debit);
      const credit = parseAmount(row.credit);
      if (debit === undefined && credit === undefined) {
        errors.push("Enter a debit or credit amount.");
      } else if (
        (debit !== undefined && (!Number.isFinite(debit) || debit < 0)) ||
        (credit !== undefined && (!Number.isFinite(credit) || credit < 0))
      ) {
        errors.push("Debit and credit amounts must be valid non-negative numbers.");
      } else {
        const debitAmount = debit ?? 0;
        const creditAmount = credit ?? 0;
        if ((debitAmount > 0) === (creditAmount > 0)) {
          errors.push("Exactly one of debit and credit must be greater than zero.");
        } else {
          amount = debitAmount > 0 ? -debitAmount : creditAmount;
        }
      }
    } else {
      amount = parseAmount(row.amount);
      if (amount === undefined || !Number.isFinite(amount) || amount === 0) {
        errors.push("Enter a valid non-zero amount.");
      }
    }

    const category = categories.find((item) => item.id === row.categoryId);
    if (!category) errors.push(row.categoryIssue || "Select an active category.");
    if (!row.subCategoryId && row.subcategoryIssue) errors.push(row.subcategoryIssue);
    if (category && amount !== undefined) {
      if (usesDebitCredit) {
        const debitAmount = parseAmount(row.debit) ?? 0;
        const creditAmount = parseAmount(row.credit) ?? 0;
        if (debitAmount > 0 && category.type !== "EXPENSE") {
          errors.push("Debit entries must use an expense category.");
        }
        if (creditAmount > 0 && category.type !== "INCOME") {
          errors.push("Credit entries must use an income category.");
        }
      } else if (amount < 0 && category.type !== "EXPENSE") {
        errors.push("Negative amounts must use an expense category.");
      }
    }
    if (category && row.subCategoryId && !category.subCategories?.some((item) => item.id === row.subCategoryId)) {
      errors.push("Select a subcategory under the selected category.");
    }
    if (category && row.type.trim() && row.type.trim().toUpperCase() !== category.type) {
      errors.push("Transaction type must match the selected category.");
    }
    const transactionCurrency = (row.currency.trim() || currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(transactionCurrency)) errors.push("Currency must be a 3-letter code.");
    const paymentMode = (row.paymentMode.trim() || "BANK_ACCOUNT").toUpperCase();
    if (!["CASH", "CREDIT", "BANK_ACCOUNT"].includes(paymentMode)) {
      errors.push("Payment mode must be CASH, CREDIT, or BANK_ACCOUNT.");
    }
    return { errors: [...new Set(errors)], transactionDate, amount, category, transactionCurrency, paymentMode };
  }), [categories, currency, rows, usesDebitCredit]);

  const issueCount = rowErrors.reduce((count, row) => count + row.errors.length, 0);

  async function loadFile(selectedFile: File | undefined) {
    if (!selectedFile) return;
    setImportError("");
    setSuccessCount(null);
    setRows([]);
    setFile(null);
    if (selectedFile.size > 5 * 1024 * 1024) {
      setImportError("Choose a file no larger than 5 MB.");
      return;
    }
    const extension = selectedFile.name.split(".").pop()?.toLowerCase();
    if (extension !== "csv" && extension !== "xlsx") {
      setImportError("Choose a CSV or XLSX file.");
      return;
    }
    setFile(selectedFile);
    setParsing(true);
    try {
      let sheet: ImportSheet;
      if (extension === "csv") {
        const text = (await selectedFile.text()).replace(/^\uFEFF/, "");
        const [header, ...records] = parseCsv(text);
        if (!header) throw new Error("The CSV file is empty.");
        sheet = {
          headers: header,
          rows: records.map((cells, index) => ({ sourceRow: index + 2, cells })),
        };
      } else {
        sheet = await parseFirstWorksheet(selectedFile);
      }
      const mapped = mapImportSheet(sheet, extension === "xlsx");
      const mappedRows = mapped.rows.map((row) => {
        const match = resolveCategory(row.categoryValue, categories);
        const category = categories.find((item) => item.id === match.id);
        const subcategoryMatch = resolveSubcategory(row.subcategoryValue, category);
        return {
          ...row,
          categoryId: match.id,
          subCategoryId: subcategoryMatch.id,
          categoryIssue: row.categoryValue.trim()
            ? match.ambiguous
              ? "This category name is ambiguous; choose the category by ID."
              : match.id ? "" : "The category did not match an active category name or ID."
            : "",
          subcategoryIssue: row.subcategoryValue.trim()
            ? category ? subcategoryMatch.issue : "Subcategory cannot be checked until the category is valid."
            : "",
        };
      });
      setRows(mappedRows);
      setUsesDebitCredit(mapped.usesDebitCredit);
      if (!mappedRows.length) setImportError("The file does not contain any non-empty transaction rows.");
    } catch (caught) {
      setFile(null);
      setImportError(caught instanceof Error ? caught.message : "The file could not be read.");
    } finally {
      setParsing(false);
    }
  }

  function updateRow(index: number, updates: Partial<ImportRow>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index
      ? { ...row, ...updates, serverErrors: [] }
      : row));
  }

  function applyBulkAssignment() {
    if (!bulkCategoryId) return;
    setRows((current) => current.map((row) => ({
      ...row,
      categoryId: bulkCategoryId,
      subCategoryId: bulkSubcategoryId,
      categoryIssue: "",
      subcategoryIssue: "",
      serverErrors: [],
    })));
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportError("");
    if (!file || !rows.length || issueCount || categoriesLoading || categoriesError) return;
    setSubmitting(true);
    try {
      const normalizedRows = rows.map((row, index) => {
        const result = rowErrors[index];
        return [
          result.transactionDate,
          row.description.trim(),
          String(result.amount),
          result.transactionCurrency,
          result.category?.id ?? "",
          row.subCategoryId,
          result.paymentMode,
        ].map(csvCell).join(",");
      });
      const normalizedCsv = [
        "date,description,amount,currency,category,subcategory,paymentMode",
        ...normalizedRows,
      ].join("\r\n");
      const formData = new FormData();
      formData.append("file", new Blob([normalizedCsv], { type: "text/csv;charset=utf-8" }), "transactions.csv");
      const response = await apiFetch("/api/v1/transactions/import", {
        method: "POST",
        body: formData,
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const detail = isObject(result) && typeof result.detail === "string"
          ? result.detail
          : `Could not import transactions (server returned ${response.status}).`;
        throw new Error(detail);
      }
      if (
        !isObject(result) ||
        typeof result.importedCount !== "number" ||
        !Number.isInteger(result.importedCount) ||
        !Array.isArray(result.errors)
      ) {
        throw new Error("The import response was not in the expected format.");
      }
      const errors: ImportResult["errors"] = result.errors.map((error) => {
        if (
          !isObject(error) ||
          typeof error.rowNumber !== "number" ||
          !Number.isInteger(error.rowNumber) ||
          !Array.isArray(error.messages) ||
          !error.messages.every((message) => typeof message === "string")
        ) {
          throw new Error("A row error in the import response was not in the expected format.");
        }
        return { rowNumber: error.rowNumber, messages: error.messages };
      });
      if (errors.length) {
        const errorsBySourceRow = new Map<number, string[]>();
        for (const error of errors) {
          const sourceRow = rows[error.rowNumber - 2]?.sourceRow;
          if (sourceRow !== undefined) errorsBySourceRow.set(sourceRow, error.messages);
        }
        setRows((current) => current.map((row) => ({
          ...row,
          serverErrors: errorsBySourceRow.get(row.sourceRow) ?? [],
        })));
        if (errorsBySourceRow.size !== errors.length) {
          setImportError("The server returned a row error that could not be matched to the selected statement.");
        }
        return;
      }
      setSuccessCount(result.importedCount);
      onImported();
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : "Could not import transactions.");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedBulkCategory = categories.find((category) => category.id === bulkCategoryId);

  return (
    <div className="transaction-modal-backdrop import-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onClose();
    }}>
      <section aria-labelledby="import-dialog-title" aria-modal="true" className="transaction-modal import-dialog" role="dialog">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Bring your statement in</p>
            <h2 id="import-dialog-title">Import transactions</h2>
          </div>
          <button aria-label="Close import dialog" className="modal-close" disabled={submitting} onClick={onClose} type="button">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {successCount !== null ? (
          <div className="import-success" role="status">
            <span aria-hidden="true">✓</span>
            <h3>{successCount} {successCount === 1 ? "transaction" : "transactions"} imported</h3>
            <p>Your transactions have been added to your account.</p>
            <button className="dashboard-primary-button" onClick={onClose} type="button">Done</button>
          </div>
        ) : (
          <form className="import-form" onSubmit={(event) => void submitImport(event)}>
            <p className="import-intro">
              Choose a CSV or XLSX statement. XLSX files use the first worksheet. Files are limited to 5 MB and 1,000 transaction rows.
            </p>
            <div className="import-file-picker">
              <div>
                <span>{file ? file.name : "Select a CSV or XLSX statement"}</span>
                <small>{file ? `${(file.size / 1024).toFixed(0)} KB` : "CSV or XLSX · up to 5 MB"}</small>
              </div>
              <input
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                aria-label="Select a CSV or XLSX statement"
                onChange={(event) => {
                  void loadFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
                ref={fileInput}
                type="file"
              />
              <button onClick={() => fileInput.current?.click()} type="button">
                {file ? "Choose another" : "Browse files"}
              </button>
            </div>

            <div className="import-duplicate-warning" role="note">
              <strong>Before you continue</strong>
              <span>Importing the same statement again creates duplicate transactions. Statements are not deduplicated.</span>
            </div>

            {categoriesLoading && <p className="import-inline-status" role="status">Loading your categories…</p>}
            {categoriesError && (
              <div className="import-inline-error" role="alert">
                <span>{categoriesError}</span>
                <button onClick={onCategoriesRetry} type="button">Try again</button>
              </div>
            )}
            {parsing && <p className="import-inline-status" role="status">Reading your statement…</p>}
            {importError && <p className="import-inline-error" role="alert">{importError}</p>}

            {rows.length > 0 && !categoriesError && (
              <>
                <div className="import-review-heading">
                  <div>
                    <h3>Review categories</h3>
                    <p>Confirm each row before importing. Categories are never guessed from descriptions.</p>
                  </div>
                  <span>{rows.length} {rows.length === 1 ? "row" : "rows"}</span>
                </div>
                <div className="import-bulk-assign">
                  <label>
                    <span>Assign category to all rows</span>
                    <select
                      onChange={(event) => {
                        setBulkCategoryId(event.target.value);
                        setBulkSubcategoryId("");
                      }}
                      value={bulkCategoryId}
                    >
                      <option value="">Choose a category</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {categoryLabel(category, categories)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <span>Optional subcategory</span>
                    <select
                      disabled={!selectedBulkCategory}
                      onChange={(event) => setBulkSubcategoryId(event.target.value)}
                      value={bulkSubcategoryId}
                    >
                      <option value="">No subcategory</option>
                      {(selectedBulkCategory?.subCategories ?? []).map((subcategory) => (
                        <option key={subcategory.id} value={subcategory.id}>{subcategoryLabel(subcategory, selectedBulkCategory)}</option>
                      ))}
                    </select>
                  </label>
                  <button disabled={!bulkCategoryId} onClick={applyBulkAssignment} type="button">Apply to all</button>
                </div>
                <div className="import-review-table-wrap">
                  <table className="import-review-table">
                    <thead>
                      <tr>
                        <th scope="col">Row</th>
                        <th scope="col">Date &amp; description</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Category</th>
                        <th scope="col">Subcategory</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => {
                        const check = rowErrors[index];
                        return (
                          <tr key={`${row.sourceRow}-${index}`}>
                            <td data-label="Row">{row.sourceRow}</td>
                            <td className="import-row-description" data-label="Date & description">
                              <div className="import-row-edit-fields">
                                <input
                                  aria-label={`Date for row ${row.sourceRow}`}
                                  onChange={(event) => updateRow(index, { date: event.target.value })}
                                  placeholder="Date (e.g. 2026-10-17)"
                                  value={row.date}
                                />
                                <input
                                  aria-label={`Description for row ${row.sourceRow}`}
                                  maxLength={255}
                                  onChange={(event) => updateRow(index, { description: event.target.value })}
                                  placeholder="Description"
                                  value={row.description}
                                />
                              </div>
                            </td>
                            <td data-label="Amount">
                              <div className="import-row-edit-fields">
                                {usesDebitCredit ? (
                                  <>
                                    <input
                                      aria-label={`Debit for row ${row.sourceRow}`}
                                      inputMode="decimal"
                                      onChange={(event) => updateRow(index, { debit: event.target.value })}
                                      placeholder="Debit"
                                      value={row.debit}
                                    />
                                    <input
                                      aria-label={`Credit for row ${row.sourceRow}`}
                                      inputMode="decimal"
                                      onChange={(event) => updateRow(index, { credit: event.target.value })}
                                      placeholder="Credit"
                                      value={row.credit}
                                    />
                                  </>
                                ) : (
                                  <input
                                    aria-label={`Amount for row ${row.sourceRow}`}
                                    inputMode="decimal"
                                    onChange={(event) => updateRow(index, { amount: event.target.value })}
                                    placeholder="Amount"
                                    value={row.amount}
                                  />
                                )}
                                <input
                                  aria-label={`Currency for row ${row.sourceRow}`}
                                  onChange={(event) => updateRow(index, { currency: event.target.value })}
                                  placeholder={currency}
                                  value={row.currency}
                                />
                              </div>
                            </td>
                            <td data-label="Category">
                              <select
                                aria-label={`Category for row ${row.sourceRow}`}
                                className={check.errors.length ? "has-error" : ""}
                                onChange={(event) => {
                                  const category = categories.find((item) => item.id === event.target.value);
                                  const subcategoryMatch = resolveSubcategory(row.subcategoryValue, category);
                                  updateRow(index, {
                                    categoryId: event.target.value,
                                    subCategoryId: subcategoryMatch.id,
                                    categoryIssue: "",
                                    subcategoryIssue: row.subcategoryValue.trim()
                                      ? category ? subcategoryMatch.issue : "Subcategory cannot be checked until the category is valid."
                                      : "",
                                  });
                                }}
                                value={row.categoryId}
                              >
                                <option value="">Choose category</option>
                                {categories.map((category) => (
                                  <option key={category.id} value={category.id}>{categoryLabel(category, categories)}</option>
                                ))}
                              </select>
                              {check.errors.length > 0 && (
                                <ul className="import-row-errors">
                                  {check.errors.map((error) => <li key={error}>{error}</li>)}
                                </ul>
                              )}
                            </td>
                            <td data-label="Subcategory">
                              <select
                                aria-label={`Subcategory for row ${row.sourceRow}`}
                                disabled={!check.category}
                                onChange={(event) => updateRow(index, {
                                  subCategoryId: event.target.value,
                                  subcategoryIssue: "",
                                })}
                                value={row.subCategoryId}
                              >
                                <option value="">None</option>
                                {(check.category?.subCategories ?? []).map((subcategory) => (
                                  <option key={subcategory.id} value={subcategory.id}>{subcategoryLabel(subcategory, check.category)}</option>
                                ))}
                              </select>
                              <div className="import-row-edit-fields import-row-extra-fields">
                                <select
                                  aria-label={`Type for row ${row.sourceRow}`}
                                  onChange={(event) => updateRow(index, { type: event.target.value })}
                                  value={row.type.trim().toUpperCase()}
                                >
                                  <option value="">Use category type</option>
                                  <option value="INCOME">Income</option>
                                  <option value="EXPENSE">Expense</option>
                                </select>
                                <select
                                  aria-label={`Payment mode for row ${row.sourceRow}`}
                                  onChange={(event) => updateRow(index, { paymentMode: event.target.value })}
                                  value={row.paymentMode.trim().toUpperCase() || "BANK_ACCOUNT"}
                                >
                                  <option value="BANK_ACCOUNT">Bank account</option>
                                  <option value="CASH">Cash</option>
                                  <option value="CREDIT">Credit</option>
                                </select>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {issueCount > 0 && (
                  <p className="import-validation-summary" role="status">
                    Fix {issueCount} {issueCount === 1 ? "issue" : "issues"} before retrying. The server saves no transactions when validation fails.
                  </p>
                )}
              </>
            )}
            <div className="import-actions">
              <button className="profile-cancel-button" disabled={submitting} onClick={onClose} type="button">Cancel</button>
              <button
                className="dashboard-primary-button"
                disabled={!rows.length || issueCount > 0 || categoriesLoading || Boolean(categoriesError) || parsing || submitting}
                type="submit"
              >
                {submitting ? "Importing…" : "Import transactions"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
