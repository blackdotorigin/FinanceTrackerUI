import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import QRCode from "qrcode";
import { formatCurrency } from "../formatting/currency";
import PremiumLoader from "../PremiumLoader";
import { readDeviceContacts } from "./contacts";
import { useMinimumLoading } from "../hooks/useMinimumLoading";
import type { DeviceContact } from "./contacts";
import { openUpiPayment } from "./upiPayments";
import type { UpiPaymentStatus } from "./upiPayments";
import {
  fetchDueTemplate,
  fetchDues,
  submitDuePaymentProof,
} from "./duesApi";
import type { DueCategory, DueField, DueRecord, DueSubcategory, DueTemplate } from "./duesApi";
import "./dues.css";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type ModalBounds = Pick<DOMRect, "left" | "top" | "width" | "height">;
type Props = {
  apiFetch: ApiFetch;
  userId: string;
  currency: string;
  onOverlayOpenChange?: (isOpen: boolean) => void;
  onLoadingChange: (isLoading: boolean) => void;
};

function getText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (isObject(value)) {
    for (const key of ["value", "name", "label", "id"]) {
      if (typeof value[key] === "string" || typeof value[key] === "number") {
        return String(value[key]);
      }
    }
  }
  return "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDateValue(due: DueRecord, fields: DueField[]) {
  const field = fields.find((item) => item.type === "date" || /due.?date|date/i.test(item.key));
  return field ? getText(due.values[field.key]) : "";
}

function formatDueDate(value: string) {
  if (!value) return "Date not set";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function daysFromToday(value: string) {
  if (!value) return Number.POSITIVE_INFINITY;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

function deadlineTone(value: string) {
  const days = daysFromToday(value);
  if (!Number.isFinite(days)) return "none";
  if (days <= 7) return "red";
  if (days <= 30) return "yellow";
  return "purple";
}

function categoryFor(due: DueRecord, template: DueTemplate): DueCategory | undefined {
  const category = due.values.category;
  const id = isObject(category) ? getText(category.id) : getText(due.values.categoryId ?? category);
  const code = isObject(category) ? getText(category.code) : "";
  return template.categories.find((item) => item.id === id || item.code === code);
}

function subcategoryFor(due: DueRecord, category?: DueCategory): DueSubcategory | undefined {
  const subcategory = due.values.subCategory;
  const id = isObject(subcategory) ? getText(subcategory.id) : getText(due.values.subCategoryId ?? subcategory);
  const code = isObject(subcategory) ? getText(subcategory.code) : "";
  return category?.subcategories.find((item) => item.id === id || item.code === code);
}

function dueIdentity(due: DueRecord, fields: DueField[]) {
  const date = getDateValue(due, fields);
  if (!date) return { label: "No date", tone: "undated" };
  const day = new Date(`${date.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (Number.isNaN(day.getTime())) return { label: formatDueDate(date), tone: "upcoming" };
  const delta = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (delta < 0) return { label: `${formatDueDate(date)} · overdue`, tone: "overdue" };
  if (delta === 0) return { label: "Due today", tone: "today" };
  if (delta <= 7) return { label: `Due ${formatDueDate(date)}`, tone: "soon" };
  return { label: formatDueDate(date), tone: "upcoming" };
}

function categoryGlyph(value: string) {
  if (/SUBSCRIPTIONS|NETFLIX|SPOTIFY|YOUTUBE/.test(value)) return "play";
  if (/LENDING|PERSON|FAMILY/.test(value)) return "people";
  if (/LOAN|EMI/.test(value)) return "loan";
  if (/INVESTMENT|CHIT/.test(value)) return "growth";
  if (/HOUSEHOLD|RENT|GAS|WATER|ELECTRICITY|INTERNET/.test(value)) return "home";
  if (/TRANSPORT|METRO/.test(value)) return "travel";
  return "calendar";
}

function categoryTone(category?: DueCategory) {
  const value = `${category?.code ?? ""} ${category?.label ?? ""}`.toUpperCase();
  if (/SUBSCRIPTION|STREAM|ENTERTAINMENT/.test(value)) return "subscription";
  if (/LEND|FRIEND|FAMILY|PERSONAL/.test(value)) return "people";
  if (/HOUSE|UTILITY|BILL|RENT/.test(value)) return "home";
  if (/LOAN|EMI|DEBT|CREDIT/.test(value)) return "loan";
  if (/INVEST|CHIT|SIP|SAVING/.test(value)) return "growth";
  if (/TRAVEL|TRANSPORT/.test(value)) return "travel";
  return "other";
}

function categoryLabel(category: DueCategory | undefined, subcategory?: DueSubcategory) {
  return subcategory?.label ?? category?.label ?? "Due reminder";
}

function BrandMark({ category, subcategory, brandHint = "" }: { category?: DueCategory; subcategory?: DueSubcategory; brandHint?: string }) {
  const code = `${brandHint} ${subcategory?.code ?? ""} ${subcategory?.label ?? ""} ${category?.code ?? ""}`.toUpperCase();
  const glyph = categoryGlyph(code);
  const brandClass = /NETFLIX/.test(code) ? " is-netflix" : /SPOTIFY/.test(code) ? " is-spotify" : /YOUTUBE|YT PREMIUM/.test(code) ? " is-youtube" : "";
  const shapes = {
    play: <><rect x="4" y="4" width="16" height="16" rx="5" /><path d="m10 8 6 4-6 4V8Z" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.4-3 2.2-4.5 5.5-4.5s5.1 1.5 5.5 4.5M16 5.5a2.7 2.7 0 0 1 0 5.2m1 3c2.2.5 3.4 1.9 3.7 4.3" /></>,
    loan: <><path d="M5 7.5h14M7 4.5h10M7 7.5v12h10v-12M9.5 11h5m-5 3.5h5" /></>,
    growth: <><path d="M4 19h16M6 16l4-4 3 2 5-6" /><path d="M14 8h4v4" /></>,
    home: <><path d="m3.5 11 8.5-7 8.5 7M5.5 9.5V20h13V9.5M9 20v-6h6v6" /></>,
    travel: <><path d="m3 14 18-5-7 12-2-6-9-1Z" /><path d="m12 15 4-4" /></>,
    calendar: <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 10h16m4 5h.01" /></>,
  };
  const mark = /SPOTIFY/.test(code)
    ? <><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="M6.3 9.2c3.9-1.2 8.1-.8 11.4 1.1M7.1 12.1c3.2-.9 6.6-.5 9.3 1M7.8 14.8c2.4-.6 5-.3 7.1.8" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></>
    : /YOUTUBE|YT PREMIUM/.test(code)
      ? <><rect x="2.5" y="5" width="19" height="14" rx="4" fill="currentColor" stroke="none" /><path d="m10 8.5 5.5 3.5-5.5 3.5v-7Z" fill="#fff" stroke="none" /></>
      : /NETFLIX/.test(code)
        ? <><path d="M5 3.5h4.2l5.6 10.9V3.5H19V20h-4.2L9.2 9.1V20H5V3.5Z" fill="currentColor" stroke="none" /></>
        : shapes[glyph];
  return (
    <span className={`due-brand-mark is-${categoryTone(category)}${brandClass}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{mark}</g>
      </svg>
    </span>
  );
}

function frequencyLabel(due: DueRecord) {
  const frequency = getText(due.values.frequency);
  if (!frequency || frequency === "ONCE") return "One time";
  const interval = Number(due.values.frequencyInterval) || 1;
  const labels: Record<string, string> = {
    DAILY: "day",
    WEEKLY: "week",
    MONTHLY: "month",
    QUARTERLY: "quarter",
    YEARLY: "year",
  };
  const unit = labels[frequency] ?? frequency.toLowerCase();
  return `Every ${interval === 1 ? "" : `${interval} `}${unit}${interval === 1 ? "" : "s"}`;
}

type DueForm = {
  title: string;
  description: string;
  categoryId: string;
  subCategoryId: string;
  amount: string;
  dueDate: string;
  frequency: string;
  frequencyInterval: string;
  reminderDaysBefore: string[];
  payeeName: string;
  payeeUpiId: string;
  payeePhoneNumber: string;
  reference: string;
  autoPay: boolean;
  status: string;
};

function makeForm(template: DueTemplate, currency: string, due?: DueRecord): DueForm {
  const value = (key: keyof DueForm, fallback: string) =>
    due ? getText(due.values[key]) || fallback : fallback;
  const reminders = due?.values.reminderDaysBefore;
  const templateValue = (key: string, fallback: string) => {
    const defaultValue = template.fields.find((field) => field.key === key)?.defaultValue;
    return defaultValue === null || defaultValue === undefined ? fallback : String(defaultValue);
  };
  let defaultReminders = ["1", "3", "7"];
  const reminderDefault = template.fields.find((field) => field.key === "reminderDaysBefore")?.defaultValue;
  if (Array.isArray(reminderDefault)) {
    defaultReminders = reminderDefault.map(String);
  } else if (typeof reminderDefault === "string") {
    try {
      const parsed: unknown = JSON.parse(reminderDefault);
      if (Array.isArray(parsed)) defaultReminders = parsed.map(String);
    } catch {
      defaultReminders = ["1", "3", "7"];
    }
  }
  return {
    title: value("title", ""),
    description: value("description", ""),
    categoryId: getText(due?.values.categoryId) || (isObject(due?.values.category) ? getText(due.values.category.id) : "") || template.categories[0]?.id || "",
    subCategoryId: getText(due?.values.subCategoryId) || (isObject(due?.values.subCategory) ? getText(due.values.subCategory.id) : ""),
    amount: value("amount", ""),
    dueDate: value("dueDate", new Date().toISOString().slice(0, 10)).slice(0, 10),
    frequency: value("frequency", templateValue("frequency", template.frequencies.includes("ONCE") ? "ONCE" : template.frequencies[0] ?? "")),
    frequencyInterval: value("frequencyInterval", templateValue("frequencyInterval", "1")),
    reminderDaysBefore: Array.isArray(reminders)
      ? reminders.map(String)
      : defaultReminders,
    payeeName: value("payeeName", ""),
    payeeUpiId: value("payeeUpiId", ""),
    payeePhoneNumber: value("payeePhoneNumber", ""),
    reference: value("reference", ""),
    autoPay: due ? due.values.autoPay === true : false,
    status: value("status", templateValue("status", template.statuses.includes("ACTIVE") ? "ACTIVE" : template.statuses[0] ?? "")),
  };
}

function parseError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function upiPaymentUnavailableReason(due: DueRecord, currency: string) {
  const payeeUpiId = getText(due.values.payeeUpiId).trim();
  const payeePhoneNumber = normalizePhoneNumber(getText(due.values.payeePhoneNumber));
  const amount = getText(due.values.amount).trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(payeeUpiId) && !isValidPhoneNumber(payeePhoneNumber)) {
    return "Add a valid UPI ID or contact phone number to this reminder before paying.";
  }
  if ((getText(due.values.currency) || currency).trim().toUpperCase() !== "INR") {
    return "UPI payments are available only for reminders in INR.";
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return "UPI requires a positive amount with no more than two decimal places.";
  }
  return "";
}

function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/[^\d+]/g, "");
  return normalized.startsWith("+")
    ? `+${normalized.slice(1).replace(/\+/g, "")}`
    : normalized.replace(/\+/g, "");
}

function isValidPhoneNumber(value: string) {
  return /^\+?\d{8,15}$/.test(value);
}

function upiPaymentUri(due: DueRecord, currency: string) {
  const payeeUpiId = getText(due.values.payeeUpiId).trim();
  const payeeAddress = /^[^@\s]+@[^@\s]+$/.test(payeeUpiId)
    ? payeeUpiId
    : normalizePhoneNumber(getText(due.values.payeePhoneNumber));
  const amount = Number(due.values.amount);
  const currencyCode = (getText(due.values.currency) || currency).trim().toUpperCase();
  if (!payeeAddress || !Number.isFinite(amount) || amount <= 0 || currencyCode !== "INR") return "";
  const params = new URLSearchParams({
    pa: payeeAddress,
    pn: getText(due.values.payeeName) || payeeAddress,
    am: amount.toFixed(2),
    cu: "INR",
    tn: getText(due.values.title) || "FinanceFlow due",
  });
  return `upi://pay?${params.toString()}`;
}

function isCompletedDue(due: DueRecord) {
  return getText(due.values.status).toUpperCase() === "COMPLETED";
}

function dueUpdatePayload(due: DueRecord, currency: string, status: string) {
  const category = due.values.category;
  const subcategory = due.values.subCategory;
  const payeePhoneNumber = getText(due.values.payeePhoneNumber);
  return {
    title: getText(due.values.title),
    description: getText(due.values.description) || null,
    categoryId: getText(due.values.categoryId) || (isObject(category) ? getText(category.id) : ""),
    subCategoryId: getText(due.values.subCategoryId) || (isObject(subcategory) ? getText(subcategory.id) : "") || null,
    amount: Number(due.values.amount),
    currency: (getText(due.values.currency) || currency).trim().toUpperCase(),
    dueDate: getText(due.values.dueDate).slice(0, 10),
    frequency: getText(due.values.frequency),
    frequencyInterval: Number(due.values.frequencyInterval) || 1,
    reminderDaysBefore: Array.isArray(due.values.reminderDaysBefore)
      ? due.values.reminderDaysBefore.map(Number)
      : [],
    payeeName: getText(due.values.payeeName) || null,
    payeeUpiId: getText(due.values.payeeUpiId) || null,
    ...(payeePhoneNumber ? { payeePhoneNumber } : {}),
    reference: getText(due.values.reference) || null,
    autoPay: due.values.autoPay === true,
    status,
  };
}

function upiPaymentStatusMessage(status: UpiPaymentStatus) {
  switch (status) {
    case "SUCCESS":
      return "The payment app reported that the payment succeeded.";
    case "FAILURE":
      return "The payment app reported that the payment failed.";
    case "RECIPIENT_NOT_FOUND":
      return "The selected UPI app could not find this recipient.";
    case "PENDING":
      return "The payment app reported that the payment is still pending.";
    case "CANCELLED":
      return "The payment was cancelled.";
    case "UNKNOWN":
      return "The payment app did not return a final payment status.";
  }
}

function DetailIcon({ name }: { name: "spark" | "plus" | "calendar" | "edit" | "trash" | "contact" | "clock" | "arrow" }) {
  const paths = {
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M8 3v4m8-4v4M4 10h16" /></>,
    edit: <><path d="m4 16.5-.8 4.3 4.3-.8L19.8 7.7a2.1 2.1 0 0 0-3-3L4 16.5Z" /><path d="m14.5 7 3 3" /></>,
    trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
    contact: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.4-3.1 2.2-4.8 5.5-4.8s5.1 1.7 5.5 4.8M16 8h4m-4 4h4m-4 4h4m-4 4h4" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</g></svg>;
}

export default function DuesPage({
  apiFetch,
  userId,
  currency,
  onOverlayOpenChange,
  onLoadingChange,
}: Props) {
  const [template, setTemplate] = useState<DueTemplate | null>(null);
  const [dues, setDues] = useState<DueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTransitionBounds, setEditTransitionBounds] = useState<ModalBounds | null>(null);
  const dueFormModalRef = useRef<HTMLElement | null>(null);
  const [values, setValues] = useState<DueForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [contactsEnabled, setContactsEnabled] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [selectedDue, setSelectedDue] = useState<DueRecord | null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<{ dueId: string; status: UpiPaymentStatus } | null>(null);
  const [paymentLaunching, setPaymentLaunching] = useState(false);
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentProofPreview, setPaymentProofPreview] = useState("");
  const [paymentProofUploading, setPaymentProofUploading] = useState(false);
  const [paymentProofError, setPaymentProofError] = useState("");
  const [paymentQrDataUrl, setPaymentQrDataUrl] = useState("");
  const [paymentQrError, setPaymentQrError] = useState("");
  const [clearingDueId, setClearingDueId] = useState<string | null>(null);
  const [clearDueError, setClearDueError] = useState("");
  const [deleteConfirmDue, setDeleteConfirmDue] = useState<DueRecord | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
  const showLoading = useMinimumLoading(loading);

  useLayoutEffect(() => {
    if (!formOpen || !editingId || !editTransitionBounds) return;
    const modal = dueFormModalRef.current;
    if (!modal || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const targetBounds = modal.getBoundingClientRect();
    if (targetBounds.width === 0 || targetBounds.height === 0) return;
    const translateX = editTransitionBounds.left + editTransitionBounds.width / 2
      - targetBounds.left - targetBounds.width / 2;
    const translateY = editTransitionBounds.top + editTransitionBounds.height / 2
      - targetBounds.top - targetBounds.height / 2;
    const animation = modal.animate(
      [
        {
          transform: `translate(${translateX}px, ${translateY}px) scale(${editTransitionBounds.width / targetBounds.width}, ${editTransitionBounds.height / targetBounds.height})`,
        },
        { transform: "translate(0, 0) scale(1, 1)" },
      ],
      { duration: 280, easing: "cubic-bezier(.2, .75, .25, 1)" },
    );
    return () => animation.cancel();
  }, [editTransitionBounds, editingId, formOpen]);

  const loadData = useCallback(async (showLoading = true) => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(showLoading);
    setError("");
    try {
      const [loadedTemplate, loadedDues] = await Promise.all([
        fetchDueTemplate(apiFetch),
        fetchDues(apiFetch, userId),
      ]);
      setTemplate(loadedTemplate);
      setDues(loadedDues);
    } catch (caught) {
      setError(parseError(caught, "We couldn’t load your dues. Please retry."));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, userId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    onOverlayOpenChange?.(formOpen || selectedDue !== null || deleteConfirmDue !== null);
  }, [deleteConfirmDue, formOpen, onOverlayOpenChange, selectedDue]);

  useEffect(() => {
    onLoadingChange(showLoading);
  }, [onLoadingChange, showLoading]);

  useEffect(() => () => onLoadingChange(false), [onLoadingChange]);

  const selectedPaymentUri = selectedDue ? upiPaymentUri(selectedDue, currency) : "";

  useEffect(() => {
    let active = true;
    setPaymentQrDataUrl("");
    setPaymentQrError("");
    if (!selectedPaymentUri) return () => { active = false; };
    void QRCode.toDataURL(selectedPaymentUri, { errorCorrectionLevel: "M", margin: 2, width: 280 })
      .then((dataUrl) => {
        if (active) setPaymentQrDataUrl(dataUrl);
      })
      .catch((caught: unknown) => {
        if (active) setPaymentQrError(parseError(caught, "Couldn’t generate a UPI QR code."));
      });
    return () => { active = false; };
  }, [selectedPaymentUri]);

  useEffect(() => {
    setPaymentProofFile(null);
    setPaymentProofError("");
  }, [selectedDue?.id]);

  useEffect(() => {
    if (!paymentProofFile) {
      setPaymentProofPreview("");
      return;
    }
    const previewUrl = URL.createObjectURL(paymentProofFile);
    setPaymentProofPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [paymentProofFile]);

  const categoryDues = useMemo(() => dues.filter((due) => {
      if (activeCategory === "all") return true;
      return template !== null && categoryFor(due, template)?.id === activeCategory;
    }), [activeCategory, dues, template]);

  const sortedDues = useMemo(() => categoryDues.slice().sort((left, right) => {
      const leftDate = getDateValue(left, template?.fields ?? []);
      const rightDate = getDateValue(right, template?.fields ?? []);
      const leftDelta = daysFromToday(leftDate);
      const rightDelta = daysFromToday(rightDate);
      const leftOverdue = leftDelta < 0;
      const rightOverdue = rightDelta < 0;
      if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
      if (leftOverdue && rightOverdue) return rightDelta - leftDelta || left.id.localeCompare(right.id);
      return leftDelta - rightDelta || left.id.localeCompare(right.id);
    }), [categoryDues, template]);
  const visibleDues = useMemo(() => sortedDues.filter((due) => !isCompletedDue(due)), [sortedDues]);
  const completedDues = useMemo(() => sortedDues.filter(isCompletedDue), [sortedDues]);

  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    if (!query) return contacts.slice(0, 12);
    return contacts.filter((contact) =>
      `${contact.name} ${contact.phoneNumber}`.toLowerCase().includes(query),
    ).slice(0, 12);
  }, [contactSearch, contacts]);

  function openForm(due?: DueRecord, bounds: DOMRect | null = null) {
    if (!template) return;
    setEditingId(due?.id ?? null);
    setEditTransitionBounds(bounds ? {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    } : null);
    setValues(makeForm(template, currency, due));
    setAdvancedOptionsOpen(Boolean(due && (
      due.values.frequency !== "ONCE" ||
      due.values.description ||
      due.values.payeeName ||
      due.values.payeeUpiId ||
      due.values.reference ||
      due.values.autoPay ||
      due.values.status !== "ACTIVE"
    )));
    setFormError("");
    setContactsError("");
    setContactSearch("");
    setSelectedContactId("");
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditTransitionBounds(null);
  }

  function updateField<K extends keyof DueForm>(key: K, value: DueForm[K]) {
    setValues((current) => current ? { ...current, [key]: value } : current);
  }

  async function saveDue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!template || !userId || !values) {
      setFormError("Your account is not ready to save a due. Please try again.");
      return;
    }
    setSaving(true);
    setFormError("");
    const frequencyInterval = values.frequency === "ONCE" ? 1 : Number(values.frequencyInterval);
    if (!Number.isInteger(frequencyInterval) || frequencyInterval < 1 || frequencyInterval > 120) {
      setFormError("Repeat interval must be a whole number from 1 to 120.");
      setSaving(false);
      return;
    }
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter an amount greater than zero.");
      setSaving(false);
      return;
    }
    if (!values.title.trim() || values.title.length > 120) {
      setFormError("Add a title up to 120 characters.");
      setSaving(false);
      return;
    }
    const [wholeAmount = "", fractionAmount = ""] = values.amount.split(".");
    if (wholeAmount.replace(/^0+/, "").length > 15 || fractionAmount.length > 4) {
      setFormError("Amount can have up to 15 digits before the decimal and 4 after it.");
      setSaving(false);
      return;
    }
    if (!template.frequencies.includes(values.frequency) || !template.statuses.includes(values.status)) {
      setFormError("Choose a valid frequency and status.");
      setSaving(false);
      return;
    }
    const payload = {
      title: values.title.trim(),
      description: values.description.trim() || null,
      categoryId: values.categoryId,
      subCategoryId: values.subCategoryId || null,
      amount,
      currency: currency.trim().toUpperCase(),
      dueDate: values.dueDate,
      frequency: values.frequency,
      frequencyInterval,
      reminderDaysBefore: values.reminderDaysBefore.map(Number),
      payeeName: values.payeeName.trim() || null,
      payeeUpiId: values.payeeUpiId.trim() || null,
      ...(normalizePhoneNumber(values.payeePhoneNumber) || getText(
        dues.find((due) => due.id === editingId)?.values.payeePhoneNumber,
      )
        ? { payeePhoneNumber: normalizePhoneNumber(values.payeePhoneNumber) || null }
        : {}),
      reference: values.reference.trim() || null,
      autoPay: values.autoPay,
      status: values.status,
    };
    try {
      const categoryValue = template.categories.find((category) => category.id === payload.categoryId);
      if (!categoryValue) throw new Error("Choose a valid due category.");
      if (payload.subCategoryId && !categoryValue.subcategories.some((subcategory) => subcategory.id === payload.subCategoryId)) {
        throw new Error("Choose a subcategory from the selected category.");
      }
      if (!/^[A-Z]{3}$/.test(payload.currency)) throw new Error("Enter a valid 3-letter currency code.");
      if (payload.reminderDaysBefore.length > 30 || payload.reminderDaysBefore.some(
        (day) => !Number.isInteger(day) || day < 0 || day > 365,
      )) {
        throw new Error("Reminder days must be whole numbers between 0 and 365.");
      }
      const response = await apiFetch(
        `/api/v1/user/${encodeURIComponent(userId)}/dues${editingId ? `/${encodeURIComponent(editingId)}` : ""}`,
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(`Couldn’t ${editingId ? "update" : "save"} this due (server returned ${response.status}).`);
      }
      await loadData(false);
      setFormOpen(false);
      setEditTransitionBounds(null);
      setSelectedDue(null);
    } catch (caught) {
      setFormError(parseError(caught, "We couldn’t save this due. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  function requestDelete(due: DueRecord) {
    setDeleteError("");
    setDeleteConfirmDue(due);
  }

  async function deleteDue() {
    const due = deleteConfirmDue;
    if (!userId || !due) return;
    setDeletingId(due.id);
    setDeleteError("");
    try {
      const response = await apiFetch(
        `/api/v1/user/${encodeURIComponent(userId)}/dues/${encodeURIComponent(due.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(`Couldn’t delete this due (server returned ${response.status}).`);
      setDues((current) => current.filter((item) => item.id !== due.id));
      if (selectedDue?.id === due.id) setSelectedDue(null);
      setDeleteConfirmDue(null);
    } catch (caught) {
      setDeleteError(parseError(caught, "We couldn’t delete this due. Please try again."));
    } finally {
      setDeletingId(null);
    }
  }

  async function markDueCompleted(due: DueRecord) {
    if (!userId || !template) return false;
    if (!template.statuses.includes("COMPLETED")) {
      setClearDueError("Your due API does not allow the COMPLETED status yet.");
      return false;
    }
    setClearingDueId(due.id);
    setClearDueError("");
    try {
      const response = await apiFetch(
        `/api/v1/user/${encodeURIComponent(userId)}/dues/${encodeURIComponent(due.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dueUpdatePayload(due, currency, "COMPLETED")),
        },
      );
      if (!response.ok) {
        throw new Error(`Couldn’t clear this due (server returned ${response.status}).`);
      }
      const completedDue = { ...due, values: { ...due.values, status: "COMPLETED" } };
      setDues((current) => current.map((item) => item.id === due.id ? completedDue : item));
      setSelectedDue((current) => current?.id === due.id ? completedDue : current);
      await loadData(false);
      return true;
    } catch (caught) {
      setClearDueError(parseError(caught, "We couldn’t clear this due. Please try again."));
      return false;
    } finally {
      setClearingDueId(null);
    }
  }

  async function uploadPaymentProof(due: DueRecord) {
    if (!paymentProofFile) {
      setPaymentProofError("Choose a payment screenshot first.");
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(paymentProofFile.type) || paymentProofFile.size > 10 * 1024 * 1024) {
      setPaymentProofError("Choose a PNG, JPEG, or WebP image up to 10 MB.");
      return;
    }
    setPaymentProofUploading(true);
    setPaymentProofError("");
    try {
      const proof = await submitDuePaymentProof(apiFetch, userId, due.id, paymentProofFile);
      const updatedDue = {
        ...due,
        values: {
          ...due.values,
          paymentProofStatus: proof.status,
          paymentProofSubmittedAt: proof.submittedAt,
        },
      };
      setDues((current) => current.map((item) => item.id === due.id ? updatedDue : item));
      setSelectedDue(updatedDue);
      setPaymentProofFile(null);
    } catch (caught) {
      setPaymentProofError(parseError(caught, "We couldn’t submit this screenshot. You can retry later."));
    } finally {
      setPaymentProofUploading(false);
    }
  }

  async function enableContacts() {
    setContactsLoading(true);
    setContactsError("");
    try {
      const loadedContacts = await readDeviceContacts();
      setContacts(loadedContacts);
      setContactsEnabled(true);
    } catch (caught) {
      setContactsError(parseError(caught, "We couldn’t access your contacts."));
    } finally {
      setContactsLoading(false);
    }
  }

  function useContact(contact: DeviceContact) {
    if (!template || !values) return;
    setSelectedContactId(contact.id);
    updateField("payeeName", contact.name);
    updateField("payeePhoneNumber", contact.phoneNumber);
  }

  async function payDue(due: DueRecord) {
    setPaymentError("");
    setClearDueError("");
    setPaymentStatus(null);
    const unavailableReason = upiPaymentUnavailableReason(due, currency);
    if (unavailableReason) {
      setPaymentError(unavailableReason);
      return;
    }
    setPaymentLaunching(true);
    try {
      const result = await openUpiPayment({
        payeeUpiId: getText(due.values.payeeUpiId).trim() || undefined,
        payeePhoneNumber: normalizePhoneNumber(getText(due.values.payeePhoneNumber)) || undefined,
        payeeName: getText(due.values.payeeName).trim(),
        amount: Number(due.values.amount).toFixed(2),
        note: getText(due.values.title).trim() || "FinanceFlow due",
      });
      setPaymentStatus({ dueId: due.id, status: result.status });
    } catch (caught) {
      setPaymentError(parseError(caught, "Couldn’t open a UPI payment app."));
    } finally {
      setPaymentLaunching(false);
    }
  }

  const dueCountLabel = `${visibleDues.length} active · ${completedDues.length} cleared`;

  return (
    <section className="dashboard-subpage dues-page" aria-labelledby="dues-title">
      <header className="dues-heading">
        <div>
          <p className="dues-eyebrow"><DetailIcon name="spark" /> Your money, remembered</p>
          <h1 id="dues-title">Due dates, handled.</h1>
          <p>All the little things you don’t want to forget, right where you need them.</p>
        </div>
        <div className="dues-heading-actions">
          <span className="dues-count-pill">{dueCountLabel}</span>
          <button className="dues-add-button" onClick={() => openForm()} disabled={!template} type="button">
            <DetailIcon name="plus" /> Add reminder
          </button>
        </div>
      </header>

      {error && (
        <div className="dues-error" role="alert">
          <span>{error}</span>
          <button onClick={() => void loadData()} type="button">Try again</button>
        </div>
      )}

      {showLoading ? (
        <div className="dues-loading">
          <PremiumLoader label="Gathering your reminders…" />
        </div>
      ) : (
        <>
          {template && template.categories.length > 0 && (
            <div className="dues-filter-dock">
              <div className="dues-filter-label">
                <strong>Quick filters</strong>
                <span>Pick a category</span>
              </div>
              <div className="dues-categories" role="tablist" aria-label="Filter dues by category">
                <button
                  aria-selected={activeCategory === "all"}
                  className={activeCategory === "all" ? "is-active" : ""}
                  onClick={() => setActiveCategory("all")}
                  role="tab"
                  type="button"
                >Everything <span>{categoryDues.length}</span></button>
                {template.categories.map((category) => (
                  <button
                    aria-selected={activeCategory === category.id}
                    className={activeCategory === category.id ? "is-active" : ""}
                    key={category.id}
                    onClick={() => setActiveCategory(category.id)}
                    role="tab"
                    type="button"
                  >
                    {category.label}
                    <span>{categoryDues.filter((due) => categoryFor(due, template)?.id === category.id).length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="dues-list-heading">
            <div>
              <p className="dues-list-eyebrow"><DetailIcon name="clock" /> Your reminders</p>
              <h2>{visibleDues.length ? "Coming up, in order." : "A little space to start."}</h2>
            </div>
            {visibleDues.length > 0 && <span>{visibleDues.length} shown · soonest first</span>}
          </div>

          {visibleDues.length ? (
            <div className="dues-grid">
              {visibleDues.map((due, index) => {
                const dateInfo = dueIdentity(due, template?.fields ?? []);
                const category = template ? categoryFor(due, template) : undefined;
                const subcategory = category ? subcategoryFor(due, category) : undefined;
                const amount = Number(due.values.amount);
                const payee = getText(due.values.payeeName);
                const title = getText(due.values.title) || categoryLabel(category, subcategoryFor(due, category));
                const currencyCode = currency;
                return (
                  <article
                    className={`due-card due-card-${dateInfo.tone} due-card-tone-${categoryTone(category)}${index === 0 ? " is-next-up" : ""}`}
                    key={due.id}
                    >
                    <div className="due-card-glint" />
                    <div className="due-card-top">
                      <BrandMark category={category} subcategory={subcategory} brandHint={`${title} ${payee}`} />
                      <span className="due-category-chip">{categoryLabel(category, subcategory)}</span>
                      {index === 0 && <span className="due-next-badge">NEXT UP</span>}
                      <div className="due-card-actions">
                        <button
                          aria-label={`Edit ${title}`}
                          onClick={(event) => openForm(
                            due,
                            event.currentTarget.closest(".due-card")?.getBoundingClientRect() ?? null,
                          )}
                          type="button"
                        ><DetailIcon name="edit" /></button>
                        <button aria-label={`Delete ${title}`} disabled={deletingId === due.id} onClick={() => requestDelete(due)} type="button"><DetailIcon name="trash" /></button>
                      </div>
                    </div>
                    <button
                      className="due-card-open"
                      onClick={() => setSelectedDue(due)}
                      type="button"
                    >
                      <span className="due-card-title-row">
                        <strong>{title}</strong>
                        <span className={`due-date-line is-${dateInfo.tone}`}>
                          {getDateValue(due, template?.fields ?? []) && (
                            <span
                              aria-label={`Deadline ${deadlineTone(getDateValue(due, template?.fields ?? []))}`}
                              className={`due-deadline-dot is-${deadlineTone(getDateValue(due, template?.fields ?? []))}`}
                              title={`${deadlineTone(getDateValue(due, template?.fields ?? []))} deadline`}
                            />
                          )}
                          <DetailIcon name="calendar" /><span>{dateInfo.label}</span>
                        </span>
                      </span>
                      <span className="due-card-summary">
                        {Number.isFinite(amount) && amount > 0 && <strong>{formatCurrency(amount, currencyCode)}</strong>}
                        {payee && <span>with {payee}</span>}
                        <span>{frequencyLabel(due)}</span>
                      </span>
                      {getText(due.values.description) && (
                        <span className="due-card-description">{getText(due.values.description)}</span>
                      )}
                      <span className="due-card-more">View reminder <DetailIcon name="arrow" /></span>
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="dues-empty">
              <span className="dues-empty-icon"><DetailIcon name="calendar" /></span>
              <h2>{completedDues.length ? "All caught up here." : dues.length ? "Nothing in this category yet." : "A little more peace of mind starts here."}</h2>
              <p>{completedDues.length ? "Your cleared reminders are listed below." : dues.length ? "Choose another category or add a reminder here." : "Add a subscription, a loan repayment, or money you’re waiting to get back."}</p>
              <button className="dues-add-button" disabled={!template} onClick={() => openForm()} type="button">
                <DetailIcon name="plus" /> Add your first due
              </button>
            </div>
          )}

          {completedDues.length > 0 && (
            <section className="dues-completed-section" aria-labelledby="dues-completed-title">
              <div className="dues-list-heading">
                <div>
                  <p className="dues-list-eyebrow"><DetailIcon name="calendar" /> Closed reminders</p>
                  <h2 id="dues-completed-title">Cleared dues</h2>
                </div>
                <span>{completedDues.length} cleared</span>
              </div>
              <div className="dues-completed-list">
                {completedDues.map((due) => {
                  const title = getText(due.values.title) || "Due reminder";
                  const amount = Number(due.values.amount);
                  return (
                    <button
                      className="dues-completed-item"
                      key={due.id}
                      onClick={() => setSelectedDue(due)}
                      type="button"
                    >
                      <span>
                        <strong>{title}</strong>
                        <small>{getText(due.values.payeeName) || formatDueDate(getText(due.values.dueDate))}</small>
                      </span>
                      <span className="dues-completed-amount">
                        {Number.isFinite(amount) && amount > 0 ? formatCurrency(amount, currency) : ""}
                        <small>COMPLETED</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {((selectedDue && template && !formOpen) || (formOpen && template && values)) && (
        <div className="dues-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            if (formOpen) closeForm();
            else setSelectedDue(null);
          }
        }}>
        {selectedDue && template && !formOpen && (
          <section className="dues-modal dues-detail-modal" aria-labelledby="due-detail-title" aria-modal="true" role="dialog">
            <div className="dues-modal-heading">
              <div className="due-detail-title-wrap">
                <BrandMark
                  category={categoryFor(selectedDue, template)}
                  subcategory={subcategoryFor(selectedDue, categoryFor(selectedDue, template))}
                  brandHint={`${getText(selectedDue.values.title)} ${getText(selectedDue.values.payeeName)}`}
                />
                <div>
                  <span className="dues-modal-kicker">{categoryLabel(categoryFor(selectedDue, template), subcategoryFor(selectedDue, categoryFor(selectedDue, template)))}</span>
                  <h2 id="due-detail-title">{getText(selectedDue.values.title) || "Due reminder"}</h2>
                </div>
              </div>
              <button aria-label="Close" onClick={() => setSelectedDue(null)} type="button">×</button>
            </div>
            <div className={`due-detail-date is-${dueIdentity(selectedDue, template.fields).tone}`}>
              {getDateValue(selectedDue, template.fields) && (
                <span
                  aria-label={`Deadline ${deadlineTone(getDateValue(selectedDue, template.fields))}`}
                  className={`due-deadline-dot is-${deadlineTone(getDateValue(selectedDue, template.fields))}`}
                  title={`${deadlineTone(getDateValue(selectedDue, template.fields))} deadline`}
                />
              )}
              <DetailIcon name="calendar" />
              <span>{dueIdentity(selectedDue, template.fields).label}</span>
              <strong>{frequencyLabel(selectedDue)}</strong>
            </div>
            <div className="due-detail-grid">
              <div><span>Amount</span><strong>{formatCurrency(Number(selectedDue.values.amount) || 0, currency)}</strong></div>
              <div><span>Payee</span><strong>{getText(selectedDue.values.payeeName) || "Not specified"}</strong></div>
              {getText(selectedDue.values.payeePhoneNumber) && <div><span>Phone number</span><strong>{getText(selectedDue.values.payeePhoneNumber)}</strong></div>}
              {getText(selectedDue.values.description) && <div className="is-wide"><span>Note</span><strong>{getText(selectedDue.values.description)}</strong></div>}
              {getText(selectedDue.values.reference) && <div><span>Reference</span><strong>{getText(selectedDue.values.reference)}</strong></div>}
              <div><span>Remind me</span><strong>
                {Array.isArray(selectedDue.values.reminderDaysBefore) && selectedDue.values.reminderDaysBefore.length
                  ? selectedDue.values.reminderDaysBefore.map((day) => `${day}d before`).join(", ")
                  : "No reminders"}
              </strong></div>
              <div><span>Payment</span><strong>{selectedDue.values.autoPay === true ? "Auto-pay" : "Manual"}</strong></div>
              <div><span>Status</span><strong>{getText(selectedDue.values.status) || "ACTIVE"}</strong></div>
            </div>
            {!isCompletedDue(selectedDue) && (
              <div className="dues-payment-action">
                {Capacitor.getPlatform() === "android" && (
                  <>
                    <button
                      className="dues-submit-button"
                      disabled={paymentLaunching || Boolean(upiPaymentUnavailableReason(selectedDue, currency))}
                      onClick={() => void payDue(selectedDue)}
                      type="button"
                    >{paymentLaunching ? "Opening payment app…" : "Pay with UPI"}</button>
                    {getText(selectedDue.values.payeePhoneNumber) && !getText(selectedDue.values.payeeUpiId) && (
                      <span>The selected UPI app will try to resolve this phone number.</span>
                    )}
                  </>
                )}
                {Capacitor.getPlatform() !== "android" && selectedPaymentUri && (
                  <section className="dues-payment-qr" aria-label="UPI payment QR code">
                    <strong>Scan to pay with UPI</strong>
                    {paymentQrDataUrl
                      ? <img alt="UPI payment QR code" height="220" src={paymentQrDataUrl} width="220" />
                      : <span>{paymentQrError || "Preparing your QR code…"}</span>}
                    <small>Check the recipient and amount in your UPI app before approving.</small>
                    <a className="dues-open-upi-link" href={selectedPaymentUri}>Open UPI app on this device</a>
                  </section>
                )}
                {paymentError && <p className="dues-form-error" role="alert">{paymentError}</p>}
                {paymentStatus?.dueId === selectedDue.id && (
                  <p className="dues-payment-result" role="status">
                    {upiPaymentStatusMessage(paymentStatus.status)}
                  </p>
                )}
                {!paymentError && upiPaymentUnavailableReason(selectedDue, currency) && (
                  <p className="dues-payment-hint">{upiPaymentUnavailableReason(selectedDue, currency)}</p>
                )}
                {getText(selectedDue.values.paymentProofStatus) === "PENDING_REVIEW" ? (
                  <p className="dues-payment-result" role="status">
                    Payment screenshot submitted for review
                    {getText(selectedDue.values.paymentProofSubmittedAt)
                      ? ` · ${formatDueDate(getText(selectedDue.values.paymentProofSubmittedAt))}`
                      : ""}
                  </p>
                ) : (
                  <div className="dues-payment-proof">
                    <label className="dues-field">
                      <span>Payment screenshot <small>optional</small></span>
                      <input
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => {
                          setPaymentProofFile(event.target.files?.[0] ?? null);
                          setPaymentProofError("");
                        }}
                        type="file"
                      />
                    </label>
                    {paymentProofPreview && (
                      <img
                        alt="Selected payment screenshot preview"
                        className="dues-payment-proof-preview"
                        src={paymentProofPreview}
                      />
                    )}
                    <small>Screenshot proof is not payment verification. It stays pending until reviewed; it never clears the due automatically.</small>
                    <button
                      className="dues-mark-complete-button"
                      disabled={!paymentProofFile || paymentProofUploading}
                      onClick={() => void uploadPaymentProof(selectedDue)}
                      type="button"
                    >{paymentProofUploading ? "Submitting screenshot…" : "Submit screenshot for review"}</button>
                    {paymentProofFile && (
                      <button
                        className="dues-proof-retry-later"
                        disabled={paymentProofUploading}
                        onClick={() => setPaymentProofFile(null)}
                        type="button"
                      >Retry later</button>
                    )}
                    {paymentProofError && <p className="dues-form-error" role="alert">{paymentProofError}</p>}
                  </div>
                )}
                <button
                  className="dues-mark-complete-button"
                  disabled={clearingDueId === selectedDue.id}
                  onClick={() => void markDueCompleted(selectedDue)}
                  type="button"
                >{clearingDueId === selectedDue.id ? "Clearing…" : "Mark cleared after recipient confirms"}</button>
                {clearDueError && <p className="dues-form-error" role="alert">{clearDueError}</p>}
              </div>
            )}
            <div className="dues-form-actions">
              <button className="dues-cancel-button" onClick={() => requestDelete(selectedDue)} type="button">Delete</button>
              <button
                className="dues-submit-button"
                onClick={() => {
                  const due = selectedDue;
                  setSelectedDue(null);
                  openForm(due);
                }}
                type="button"
              ><DetailIcon name="edit" /> Edit reminder</button>
            </div>
          </section>
        )}

        {formOpen && template && values && (
          <section
            className={`dues-modal${editTransitionBounds ? " is-morphing" : ""}`}
            aria-labelledby="due-form-title"
            aria-modal="true"
            ref={dueFormModalRef}
            role="dialog"
          >
            <div className="dues-modal-heading">
              <div><span className="dues-modal-kicker">A thoughtful reminder</span><h2 id="due-form-title">{editingId ? "Update a due" : "Add a due"}</h2></div>
              <button aria-label="Close" disabled={saving} onClick={closeForm} type="button">×</button>
            </div>
            <p className="dues-modal-intro">A few details are all it takes. You can add more options when you need them.</p>
            <form className="dues-form" onSubmit={(event) => void saveDue(event)}>
              <label className="dues-field">
                <span>What’s it for?<i aria-hidden="true"> *</i></span>
                <input
                  autoFocus
                  autoComplete="off"
                  maxLength={120}
                  onChange={(event) => updateField("title", event.target.value)}
                  placeholder="Netflix, rent, money from Maya…"
                  required
                  value={values.title}
                />
              </label>
              <label className="dues-field">
                <span>Category<i aria-hidden="true"> *</i></span>
                <select
                  onChange={(event) => {
                    updateField("categoryId", event.target.value);
                    updateField("subCategoryId", "");
                  }}
                  required
                  value={values.categoryId}
                >
                  {template.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                </select>
                {template.categories.find((category) => category.id === values.categoryId)?.description && (
                  <small className="dues-field-hint">{template.categories.find((category) => category.id === values.categoryId)?.description}</small>
                )}
              </label>
              {(template.categories.find((category) => category.id === values.categoryId)?.subcategories.length ?? 0) > 0 && (
                <label className="dues-field">
                  <span>Type <small>optional</small></span>
                  <select onChange={(event) => updateField("subCategoryId", event.target.value)} value={values.subCategoryId}>
                    <option value="">Choose a type</option>
                    {template.categories.find((category) => category.id === values.categoryId)?.subcategories.map((subcategory) => (
                      <option key={subcategory.id} value={subcategory.id}>{subcategory.label}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="dues-field">
                <span>Amount<i aria-hidden="true"> *</i></span>
                <span className="dues-amount-input">
                  <input
                    inputMode="decimal"
                    max="999999999999999"
                    min="0.0001"
                    onChange={(event) => updateField("amount", event.target.value)}
                    placeholder="0.00"
                    required
                    step="0.0001"
                    type="number"
                    value={values.amount}
                  />
                  <span className="dues-currency-label" aria-label={`Currency: ${currency}`}>{currency}</span>
                </span>
              </label>
              <label className="dues-field">
                <span>Next due date<i aria-hidden="true"> *</i></span>
                <input onChange={(event) => updateField("dueDate", event.target.value)} required type="date" value={values.dueDate} />
              </label>

              <button
                aria-expanded={advancedOptionsOpen}
                className="dues-advanced-toggle"
                onClick={() => setAdvancedOptionsOpen((open) => !open)}
                type="button"
              >
                <span>{advancedOptionsOpen ? "Hide extra options" : "More options"}</span>
                <span>{advancedOptionsOpen ? "−" : "+"}</span>
              </button>

              {advancedOptionsOpen && (
                <div className="dues-advanced-fields">
                  <label className="dues-field is-wide">
                    <span>Note <small>optional</small></span>
                    <textarea
                      maxLength={1000}
                      onChange={(event) => updateField("description", event.target.value)}
                      placeholder="Add a little context"
                      rows={2}
                      value={values.description}
                    />
                  </label>
                  <label className="dues-field">
                    <span>Person or company <small>optional</small></span>
                    <input
                      maxLength={120}
                      onChange={(event) => updateField("payeeName", event.target.value)}
                      placeholder="Who is this due with?"
                      value={values.payeeName}
                    />
                  </label>
                  {(
                    <>
                      <label className="dues-field">
                        <span>Recipient UPI ID <small>recommended for QR payments</small></span>
                        <input
                          autoCapitalize="none"
                          autoComplete="off"
                          inputMode="email"
                          maxLength={255}
                          onChange={(event) => updateField("payeeUpiId", event.target.value)}
                          placeholder="recipient@bank"
                          value={values.payeeUpiId}
                        />
                      </label>
                      <label className="dues-field">
                        <span>Recipient phone number <small>optional</small></span>
                        <input
                          autoComplete="tel"
                          inputMode="tel"
                          maxLength={32}
                          onChange={(event) => updateField("payeePhoneNumber", event.target.value)}
                          placeholder="+91 98765 43210"
                          type="tel"
                          value={values.payeePhoneNumber}
                        />
                      </label>
                    </>
                  )}
                  <label className="dues-field">
                    <span>Reference <small>optional</small></span>
                    <input
                      maxLength={100}
                      onChange={(event) => updateField("reference", event.target.value)}
                      placeholder="Account or agreement"
                      value={values.reference}
                    />
                  </label>
                  <label className="dues-field">
                    <span>Repeat</span>
                    <select onChange={(event) => updateField("frequency", event.target.value)} value={values.frequency}>
                      {template.frequencies.map((frequency) => <option key={frequency} value={frequency}>{frequency === "ONCE" ? "One time" : frequency[0] + frequency.slice(1).toLowerCase()}</option>)}
                    </select>
                  </label>
                  {values.frequency !== "ONCE" && (
                    <label className="dues-field">
                      <span>Every</span>
                      <span className="dues-interval-input">
                        <input
                          max={120}
                          min={1}
                          onChange={(event) => updateField("frequencyInterval", event.target.value)}
                          required
                          type="number"
                          value={values.frequencyInterval}
                        />
                        <span>{values.frequency.toLowerCase()}</span>
                      </span>
                    </label>
                  )}
                  <fieldset className="dues-reminder-options">
                    <legend>Remind me before</legend>
                    <div>
                      {[1, 3, 7, 14].map((day) => (
                        <label key={day}>
                          <input
                            checked={values.reminderDaysBefore.includes(String(day))}
                            onChange={(event) => updateField(
                              "reminderDaysBefore",
                              event.target.checked
                                ? [...values.reminderDaysBefore, String(day)].sort((left, right) => Number(left) - Number(right))
                                : values.reminderDaysBefore.filter((item) => item !== String(day)),
                            )}
                            type="checkbox"
                          />
                          {day} day{day === 1 ? "" : "s"}
                        </label>
                      ))}
                      <label>
                        <input
                          checked={values.reminderDaysBefore.includes("0")}
                          onChange={(event) => updateField(
                            "reminderDaysBefore",
                            event.target.checked
                              ? ["0", ...values.reminderDaysBefore]
                              : values.reminderDaysBefore.filter((item) => item !== "0"),
                          )}
                          type="checkbox"
                        />
                        On the day
                      </label>
                    </div>
                  </fieldset>
                  <label className="dues-toggle-field">
                    <input checked={values.autoPay} onChange={(event) => updateField("autoPay", event.target.checked)} type="checkbox" />
                    <span><strong>Mark as auto-pay</strong><small>This only labels the due; it never makes a payment.</small></span>
                  </label>
                  <label className="dues-field">
                    <span>Status</span>
                    <select onChange={(event) => updateField("status", event.target.value)} value={values.status}>
                      {template.statuses.map((status) => <option key={status} value={status}>{status[0] + status.slice(1).toLowerCase()}</option>)}
                    </select>
                  </label>
                </div>
              )}

              {advancedOptionsOpen && Capacitor.isNativePlatform() && (
                <div className="dues-contact-panel">
                  {!contactsEnabled ? (
                    <>
                      <div className="dues-contact-copy"><DetailIcon name="contact" /><span><strong>Fill from your contacts</strong><small>Only enabled when you choose. The selected name and number are saved with this reminder.</small></span></div>
                      <button className="dues-contact-enable" disabled={contactsLoading} onClick={() => void enableContacts()} type="button">
                        {contactsLoading ? "Requesting access…" : "Allow contact access"}
                      </button>
                    </>
                  ) : (
                    <>
                      <label className="dues-contact-search">
                        <span>Choose a contact</span>
                        <input onChange={(event) => setContactSearch(event.target.value)} placeholder="Search name or number" value={contactSearch} />
                      </label>
                      <div className="dues-contact-list">
                        {filteredContacts.map((contact) => (
                          <button
                            aria-pressed={selectedContactId === contact.id}
                            className={selectedContactId === contact.id ? "is-selected" : ""}
                            key={`${contact.id}-${contact.phoneNumber}`}
                            onClick={() => useContact(contact)}
                            type="button"
                          >
                            <span>{contact.name.slice(0, 1).toUpperCase()}</span><strong>{contact.name}<small>{contact.phoneNumber}</small></strong>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {contactsError && <p role="alert">{contactsError}</p>}
                </div>
              )}
              {formError && <p className="dues-form-error" role="alert">{formError}</p>}
              <div className="dues-form-actions">
                <button className="dues-cancel-button" disabled={saving} onClick={closeForm} type="button">Cancel</button>
                <button className="dues-submit-button" disabled={saving} type="submit">{saving ? "Saving…" : editingId ? "Save changes" : "Save reminder"}</button>
              </div>
            </form>
          </section>
        )}
        </div>
      )}

      {deleteConfirmDue && (
        <div
          className="dues-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && deletingId !== deleteConfirmDue.id) {
              setDeleteConfirmDue(null);
              setDeleteError("");
            }
          }}
        >
          <section
            aria-describedby="due-delete-description"
            aria-labelledby="due-delete-title"
            aria-modal="true"
            className="dues-modal dues-delete-modal"
            role="alertdialog"
          >
            <div className="dues-modal-heading">
              <div>
                <span className="dues-modal-kicker">Remove reminder</span>
                <h2 id="due-delete-title">Delete this reminder?</h2>
              </div>
              <button
                aria-label="Close"
                disabled={deletingId === deleteConfirmDue.id}
                onClick={() => {
                  setDeleteConfirmDue(null);
                  setDeleteError("");
                }}
                type="button"
              >×</button>
            </div>
            <p className="dues-modal-intro" id="due-delete-description">
              <strong>{getText(deleteConfirmDue.values.title) || "This reminder"}</strong> will be permanently removed. This action can’t be undone.
            </p>
            {deleteError && <p className="dues-form-error" role="alert">{deleteError}</p>}
            <div className="dues-form-actions">
              <button
                className="dues-cancel-button"
                disabled={deletingId === deleteConfirmDue.id}
                onClick={() => {
                  setDeleteConfirmDue(null);
                  setDeleteError("");
                }}
                type="button"
              >Keep reminder</button>
              <button
                className="dues-delete-confirm"
                disabled={deletingId === deleteConfirmDue.id}
                onClick={() => void deleteDue()}
                type="button"
              >
                {deletingId === deleteConfirmDue.id ? "Deleting…" : "Delete reminder"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
