import { useState } from "react";
import { formatCurrency } from "../formatting/currency";

type AmountCalculatorProps = {
  initialValue: string;
  currency: string;
  onApply: (amount: string) => void;
  onCancel: () => void;
};

const KEYS = [
  ["7", "8", "9", "÷"],
  ["4", "5", "6", "×"],
  ["1", "2", "3", "−"],
  ["(", "0", ")", "+"],
  [".", "⌫", "AC", "="],
];

function evaluateExpression(expression: string) {
  const normalizedExpression = expression.replace(/−/g, "-");
  const tokens: string[] = [];
  const tokenPattern = /\s*(\d+(?:\.\d*)?|\.\d+|[()+\-*/×÷])/gy;
  let position = 0;

  while (position < normalizedExpression.length) {
    tokenPattern.lastIndex = position;
    const match = tokenPattern.exec(normalizedExpression);
    if (!match) throw new Error("Check the expression and try again.");
    tokens.push(match[1]);
    position = tokenPattern.lastIndex;
  }

  let cursor = 0;
  const parsePrimary = (): number => {
    const token = tokens[cursor++];
    if (token === "+" || token === "-") {
      const value = parsePrimary();
      return token === "-" ? -value : value;
    }
    if (token === "(") {
      const value = parseSum();
      if (tokens[cursor++] !== ")") throw new Error("Close the open parenthesis.");
      return value;
    }
    if (token === undefined || token === ")") throw new Error("Complete the expression.");
    return Number(token);
  };
  const parseProduct = (): number => {
    let value = parsePrimary();
    while (tokens[cursor] === "*" || tokens[cursor] === "/" || tokens[cursor] === "×" || tokens[cursor] === "÷") {
      const operator = tokens[cursor++];
      const next = parsePrimary();
      if ((operator === "/" || operator === "÷") && next === 0) {
        throw new Error("You can’t divide by zero.");
      }
      value = operator === "*" || operator === "×" ? value * next : value / next;
    }
    return value;
  };
  const parseSum = (): number => {
    let value = parseProduct();
    while (tokens[cursor] === "+" || tokens[cursor] === "-") {
      const operator = tokens[cursor++];
      const next = parseProduct();
      value = operator === "+" ? value + next : value - next;
    }
    return value;
  };

  if (tokens.length === 0) throw new Error("Enter a calculation first.");
  const value = parseSum();
  if (cursor !== tokens.length) throw new Error("Check the expression and try again.");
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) {
    throw new Error("That result is too large to use.");
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export default function AmountCalculator({
  initialValue,
  currency,
  onApply,
  onCancel,
}: AmountCalculatorProps) {
  const [expression, setExpression] = useState(initialValue);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState("");

  function pressKey(key: string) {
    setError("");
    if (key === "AC") {
      setExpression("");
      setResult(null);
      return;
    }
    if (key === "⌫") {
      setExpression((current) => current.slice(0, -1));
      setResult(null);
      return;
    }
    if (key === "=") {
      try {
        const value = evaluateExpression(expression);
        if (value <= 0) throw new Error("The amount must be greater than zero.");
        setResult(value);
      } catch (caught) {
        setResult(null);
        setError(caught instanceof Error ? caught.message : "Check the expression and try again.");
      }
      return;
    }

    const isOperator = ["+", "−", "×", "÷"].includes(key);
    setExpression((current) => {
      if (result !== null && isOperator) return `${result}${key}`;
      if (result !== null) return key === "." ? "0." : key;
      if (current.length >= 64) return current;
      if (key === ".") {
        const currentNumber = current.split(/[()+\-×÷]/).pop() ?? "";
        if (currentNumber.includes(".")) return current;
        return `${current}${currentNumber ? "" : "0"}.`;
      }
      return `${current}${key}`;
    });
    setResult(null);
  }

  return (
    <div
      className="amount-calculator-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        aria-label="Amount calculator"
        aria-modal="true"
        className="amount-calculator"
        role="dialog"
      >
        <div className="amount-calculator-heading">
          <div>
            <span className="amount-calculator-kicker"><i /> QUICK CALCULATION</span>
            <h2>Make the numbers add up</h2>
          </div>
          <button aria-label="Close calculator" className="amount-calculator-close" onClick={onCancel} type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div aria-live="polite" className={`amount-calculator-display${result !== null ? " has-result" : ""}`}>
          <span className="amount-calculator-expression">{expression || "0"}</span>
          {result !== null ? (
            <strong>{formatCurrency(result, currency)}</strong>
          ) : (
            <span className="amount-calculator-hint">Enter an amount and tap =</span>
          )}
          {error && <span className="amount-calculator-error" role="alert">{error}</span>}
        </div>
        <div aria-label="Calculator keypad" className="amount-calculator-keypad">
          {KEYS.flat().map((key) => (
            <button
              aria-label={key === "⌫" ? "Delete last character" : key === "AC" ? "Clear" : key === "=" ? "Calculate" : key}
              className={[
                key === "=" ? "is-equals" : "",
                ["+", "−", "×", "÷", "(", ")"].includes(key) ? "is-operator" : "",
                key === "AC" || key === "⌫" ? "is-utility" : "",
              ].filter(Boolean).join(" ")}
              key={key}
              onClick={() => pressKey(key)}
              type="button"
            >
              {key}
            </button>
          ))}
        </div>
        <div className="amount-calculator-actions">
          <button className="amount-calculator-cancel" onClick={onCancel} type="button">Cancel</button>
          <button
            className="amount-calculator-apply"
            disabled={result === null}
            onClick={() => {
              if (result !== null) onApply(result.toFixed(2));
            }}
            type="button"
          >
            Use this amount
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </button>
        </div>
      </section>
    </div>
  );
}
