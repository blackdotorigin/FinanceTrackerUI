const FALLBACK_CURRENCY_CODES = `
  AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND
  BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK
  DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD
  HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF
  KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP
  MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP
  PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLL SOS SRD
  SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU
  UZS VES VND VUV WST XAF XCD XDR XOF XPF XSU YER ZAR ZMW ZWL
`.trim().split(/\s+/);

type CurrencyValueIntl = typeof Intl & {
  supportedValuesOf?: (key: "currency") => string[];
};

const currencyCodes =
  (Intl as CurrencyValueIntl).supportedValuesOf?.("currency") ?? FALLBACK_CURRENCY_CODES;
const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
const currencySymbols = new Map(
  currencyCodes.map((code) => [
    code,
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "symbol",
    }).formatToParts(0).find((part) => part.type === "currency")?.value ?? code,
  ]),
);

export const CURRENCY_OPTIONS = currencyCodes
  .map((code) => ({
    code,
    name: currencyNames.of(code) ?? code,
    symbol: currencySymbols.get(code) ?? code,
  }))
  .sort((left, right) => left.name.localeCompare(right.name) || left.code.localeCompare(right.code));

export function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
    }).format(amount);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${currency} ${amount.toFixed(2)}`;
  }
}
