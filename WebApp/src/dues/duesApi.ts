export type DueField = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "textarea" | "boolean" | "integer-array";
  required: boolean;
  description: string;
  defaultValue: unknown;
  options: DueCategory[];
};

export type DueCategory = {
  id: string;
  code: string;
  value: string;
  label: string;
  description?: string;
  examples: string[];
  subcategories: DueSubcategory[];
};

export type DueSubcategory = {
  id: string;
  code: string;
  value: string;
  label: string;
};

export type DueTemplate = {
  fields: DueField[];
  categories: DueCategory[];
  frequencies: string[];
  statuses: string[];
};

export type DueRecord = {
  id: string;
  values: Record<string, unknown>;
};

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrap(value: unknown): unknown {
  return isObject(value) && "data" in value ? value.data : value;
}

function asList(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return undefined;
  for (const key of ["content", "items", "dues", "results"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return undefined;
}

function readSubcategories(value: unknown): DueSubcategory[] {
  const options = asList(value);
  if (!options) return [];
  return options.map((option, index) => {
    if (!isObject(option)) {
      throw new Error("A due subcategory was not in the expected format.");
    }
    const id = option.id;
    const code = option.code;
    const label = option.name ?? option.label;
    if (typeof id !== "string" || typeof code !== "string" || typeof label !== "string") {
      throw new Error(`Due subcategory ${index + 1} was missing its ID, code, or name.`);
    }
    return {
      id,
      code,
      value: id,
      label,
    };
  });
}

function readCategories(value: unknown): DueCategory[] {
  const categories = asList(value);
  if (!categories) return [];
  return categories.map((item, index) => {
    if (!isObject(item)) throw new Error("A due category was not in the expected format.");
    const { id, code } = item;
    const label = item.name ?? item.label;
    if (typeof id !== "string" || typeof code !== "string" || typeof label !== "string") {
      throw new Error(`Due category ${index + 1} was missing its ID, code, or name.`);
    }
    return {
      id,
      code,
      value: id,
      label,
      description: typeof item.description === "string" ? item.description : undefined,
      examples: [],
      subcategories: readSubcategories(item.subcategories),
    };
  });
}

function parseField(value: unknown): DueField {
  if (!isObject(value) || typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("A due field was not in the expected format.");
  }
  const rawType = String(value.type ?? "string").toLowerCase();
  const type: DueField["type"] =
    rawType.includes("date") ? "date" :
      rawType.includes("[]") || rawType.includes("array") ? "integer-array" :
        rawType.includes("decimal") || rawType.includes("number") || rawType.includes("integer") ? "number" :
        rawType.includes("enum") ? "select" :
          rawType.includes("boolean") ? "boolean" :
            rawType.includes("textarea") ? "textarea" : "text";
  return {
    key: value.name.trim(),
    label: value.label && typeof value.label === "string"
      ? value.label
      : value.name.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
    type,
    required: value.required === true,
    description: typeof value.description === "string" ? value.description : "",
    defaultValue: value.defaultValue ?? null,
    options: [],
  };
}

export function parseDueTemplate(input: unknown): DueTemplate {
  const value = unwrap(input);
  if (!isObject(value) || !Array.isArray(value.fields) || !Array.isArray(value.categories)) {
    throw new Error("The due template response was not in the expected format.");
  }
  const fields = value.fields.map(parseField);
  const fieldKeys = new Set<string>();
  for (const field of fields) {
    if (fieldKeys.has(field.key)) throw new Error("The due template contains duplicate field keys.");
    fieldKeys.add(field.key);
  }
  const categories = readCategories(value.categories);
  if (!categories.length) throw new Error("The due template did not include any categories.");
  const readEnumList = (items: unknown, name: string) => {
    if (!Array.isArray(items) || items.some((item) => typeof item !== "string")) {
      throw new Error(`The due template ${name} were not in the expected format.`);
    }
    return items as string[];
  };
  return {
    fields,
    categories,
    frequencies: readEnumList(value.frequencies, "frequencies"),
    statuses: readEnumList(value.statuses, "statuses"),
  };
}

function parseDue(value: unknown, index: number): DueRecord {
  if (!isObject(value)) throw new Error(`Due ${index + 1} was not in the expected format.`);
  const id = value.id ?? value.uuid ?? value.dueId ?? value.dueUuid ?? value.dueUUID;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error(`Due ${index + 1} did not include its ID.`);
  }
  const { id: _id, uuid: _uuid, dueId: _dueId, dueUuid: _dueUuid, dueUUID: _dueUUID, ...values } = value;
  return { id, values };
}

export function parseDues(input: unknown): DueRecord[] {
  const value = unwrap(input);
  const list = asList(value);
  if (!list) throw new Error("The dues response was not in the expected format.");
  return list.map(parseDue);
}

export async function fetchDueTemplate(apiFetch: ApiFetch): Promise<DueTemplate> {
  const response = await apiFetch("/api/v1/users/dues/template");
  if (!response.ok) throw new Error(`Couldn’t load due fields (server returned ${response.status}).`);
  return parseDueTemplate(await response.json());
}

export async function fetchDues(apiFetch: ApiFetch, userId: string): Promise<DueRecord[]> {
  const dues: DueRecord[] = [];
  let pageNumber = 0;
  let totalPages: number | undefined;
  do {
    const response = await apiFetch(
      `/api/v1/user/${encodeURIComponent(userId)}/dues?page=${pageNumber}&size=100`,
    );
    if (!response.ok) throw new Error(`Couldn’t load your dues (server returned ${response.status}).`);
    const responseBody: unknown = await response.json();
    dues.push(...parseDues(responseBody));
    const value = unwrap(responseBody);
    const page = isObject(value) && isObject(value.page) ? value.page : undefined;
    totalPages = page && typeof page.totalPages === "number" ? page.totalPages : undefined;
    pageNumber += 1;
    if (totalPages === undefined) break;
    if (pageNumber >= totalPages) {
      if (dues.length !== (page && typeof page.totalElements === "number" ? page.totalElements : dues.length)) {
        throw new Error("The due pages were incomplete. Please retry loading your dues.");
      }
      break;
    }
  } while (true);
  return dues;
}

export async function submitDuePaymentProof(
  apiFetch: ApiFetch,
  userId: string,
  dueId: string,
  file: File,
): Promise<{ status: string; submittedAt: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch(
    `/api/v1/user/${encodeURIComponent(userId)}/dues/${encodeURIComponent(dueId)}/payment-proof`,
    { method: "POST", body: formData },
  );
  if (!response.ok) {
    throw new Error(`Couldn’t submit payment proof (server returned ${response.status}).`);
  }
  const body: unknown = await response.json();
  const value = unwrap(body);
  if (!isObject(value) || value.status !== "PENDING_REVIEW" || typeof value.submittedAt !== "string") {
    throw new Error("The payment-proof response was not in the expected format.");
  }
  return { status: value.status, submittedAt: value.submittedAt };
}
