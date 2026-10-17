import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { fetchTransactions } from "../api/transactions";
import type { Transaction } from "../api/transactions";
import { formatCurrency as formatMoney } from "../formatting/currency";
import PremiumLoader from "../PremiumLoader";
import { useMinimumLoading } from "../hooks/useMinimumLoading";
import "./transaction-graph.css";

type GraphRange = "week" | "month" | "year";
type GraphType = "EXPENSE" | "INCOME";

type GraphPoint = {
  key: string;
  label: string;
  dateLabel: string;
  amount: number;
  transactions: Transaction[];
};

type Props = {
  currency: string;
  apiFetch: (path: string) => Promise<Response>;
  onLoadingChange: (isLoading: boolean) => void;
  showLoadingIndicator?: boolean;
};

const GRAPH = {
  left: 30,
  right: 970,
  top: 20,
  bottom: 270,
};

const EMPTY_TRANSACTIONS: Transaction[] = [];

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function periodStart(date: string, range: GraphRange) {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (range === "year") return `${value.getUTCFullYear()}-01-01`;
  if (range === "month") {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  const mondayOffset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - mondayOffset);
  return value.toISOString().slice(0, 10);
}

function periodBounds(date: string, range: GraphRange) {
  const start = periodStart(date, range);
  if (range === "year") {
    return { start, end: `${start.slice(0, 4)}-12-31` };
  }
  if (range === "month") {
    const value = new Date(`${start}T00:00:00.000Z`);
    value.setUTCMonth(value.getUTCMonth() + 1, 0);
    return { start, end: value.toISOString().slice(0, 10) };
  }
  return { start, end: shiftDate(start, 6) };
}

function shiftPeriod(date: string, range: GraphRange, amount: number) {
  if (range === "week") return shiftDate(date, amount * 7);
  const value = new Date(`${date}T00:00:00.000Z`);
  if (range === "month") value.setUTCMonth(value.getUTCMonth() + amount);
  else value.setUTCFullYear(value.getUTCFullYear() + amount);
  return periodStart(value.toISOString().slice(0, 10), range);
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00.000Z`));
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatPeriodLabel(date: string, range: GraphRange) {
  const { start, end } = periodBounds(date, range);
  if (range === "year") return start.slice(0, 4);
  if (range === "month") return formatDate(start, { month: "long", year: "numeric" });
  return `${formatDate(start, { month: "short", day: "numeric" })} – ${formatDate(end, { month: "short", day: "numeric", year: "numeric" })}`;
}

function makeCurve(points: { x: number; y: number }[]) {
  if (points.length < 2) return "";
  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const control = (point.x - previous.x) * .38;
    return `${path} C ${previous.x + control} ${previous.y}, ${point.x - control} ${point.y}, ${point.x} ${point.y}`;
  }, "");
}

export default function TransactionGraph({
  currency,
  apiFetch,
  onLoadingChange,
  showLoadingIndicator = true,
}: Props) {
  const [range, setRange] = useState<GraphRange>("month");
  const [selectedDate, setSelectedDate] = useState(() => periodStart(today(), "month"));
  const [type, setType] = useState<GraphType>("EXPENSE");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const [loadedData, setLoadedData] = useState<{
    key: string;
    range: GraphRange;
    date: string;
    transactions: Transaction[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [animationKey, setAnimationKey] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const requestDate = periodStart(selectedDate, range);
  const requestKey = `${range}:${requestDate}`;
  const currentDate = today();
  const currentPeriodStart = periodStart(currentDate, range);
  const canViewNextPeriod = requestDate < currentPeriodStart;
  const currentError = error?.key === requestKey ? error.message : "";
  const isLoading = loading || (loadedData?.key !== requestKey && !currentError);
  const showLoading = useMinimumLoading(isLoading);
  const graphRange = loadedData?.key !== requestKey && loadedData ? loadedData.range : range;
  const graphDate = loadedData?.key !== requestKey && loadedData ? loadedData.date : requestDate;
  const transactions = loadedData?.transactions ?? EMPTY_TRANSACTIONS;

  useEffect(() => {
    onLoadingChange(showLoading);
  }, [onLoadingChange, showLoading]);

  useEffect(() => () => onLoadingChange(false), [onLoadingChange]);

  useEffect(() => {
    let isCurrentRequest = true;
    setLoading(true);
    setError((current) => current?.key === requestKey ? null : current);

    const { start, end } = periodBounds(requestDate, range);
    void fetchTransactions(
      apiFetch,
      { from: start, to: end },
      (status) => `Couldn’t load the ${formatPeriodLabel(requestDate, range)} graph (server returned ${status}).`,
    )
      .then((result) => {
        if (isCurrentRequest) setLoadedData({ key: requestKey, range, date: requestDate, transactions: result });
      })
      .catch((caught: unknown) => {
        if (!isCurrentRequest) return;
        setError({
          key: requestKey,
          message: caught instanceof Error ? caught.message : `Couldn’t load the ${formatPeriodLabel(requestDate, range)} graph.`,
        });
      })
      .finally(() => {
        if (isCurrentRequest) setLoading(false);
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [apiFetch, range, requestDate, requestKey]);

  const points = useMemo(() => {
    const { start, end } = periodBounds(graphDate, graphRange);
    const byPeriod = new Map<string, GraphPoint>();

    if (graphRange === "year") {
      for (let index = 0; index < 12; index += 1) {
        const key = `${start.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`;
        byPeriod.set(key, {
          key,
          label: formatDate(`${key}-01`, { month: "short" }),
          dateLabel: formatDate(`${key}-01`, { month: "long", year: "numeric" }),
          amount: 0,
          transactions: [],
        });
      }
    } else {
      for (let date = start; date <= end; date = shiftDate(date, 1)) {
        byPeriod.set(date, {
          key: date,
          label: graphRange === "week"
            ? formatDate(date, { weekday: "short" })
            : formatDate(date, { day: "numeric" }),
          dateLabel: formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
          amount: 0,
          transactions: [],
        });
      }
    }

    transactions.forEach((transaction) => {
      if (transaction.type !== type) return;
      const key = graphRange === "year" ? transaction.transactionDate.slice(0, 7) : transaction.transactionDate;
      const point = byPeriod.get(key);
      if (!point) return;
      point.amount += transaction.amount;
      point.transactions.push(transaction);
    });

    return Array.from(byPeriod.values());
  }, [graphDate, graphRange, transactions, type]);

  useLayoutEffect(() => {
    if (
      isLoading ||
      currentError ||
      points.length < 2 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setIsAnimating(false);
      return;
    }

    setAnimationKey((key) => key + 1);
    setIsAnimating(true);
    const timeout = window.setTimeout(() => setIsAnimating(false), 420);
    return () => window.clearTimeout(timeout);
  }, [currentError, isLoading, points]);

  const chartPoints = points;
  const selectedPointIndex = pinnedIndex ?? activeIndex;
  const activePointIndex = Math.min(selectedPointIndex ?? chartPoints.length - 1, chartPoints.length - 1);
  const activePoint = points[activePointIndex];
  const showHoverCard = !isLoading && !currentError && !isAnimating &&
    selectedPointIndex !== null && activePoint !== undefined;
  const maxAmount = Math.max(1, ...points.map((point) => point.amount));
  const xAt = (index: number) => chartPoints.length < 2
    ? (GRAPH.left + GRAPH.right) / 2
    : GRAPH.left + index / (chartPoints.length - 1) * (GRAPH.right - GRAPH.left);
  const yAt = (ratio: number) => GRAPH.bottom - ratio * (GRAPH.bottom - GRAPH.top);
  const curvePoints = chartPoints.map((point, index) => ({
    x: xAt(index),
    y: yAt(point.amount / maxAmount),
  }));
  const linePath = makeCurve(curvePoints);
  const areaPath = chartPoints.length
    ? `${linePath} L ${GRAPH.right} ${GRAPH.bottom} L ${GRAPH.left} ${GRAPH.bottom} Z`
    : "";
  const tickIndexes = graphRange === "week"
    ? chartPoints.map((_, index) => index)
    : graphRange === "month"
      ? [...new Set([0, Math.round((chartPoints.length - 1) / 4), Math.round((chartPoints.length - 1) / 2), Math.round((chartPoints.length - 1) * 3 / 4), chartPoints.length - 1])]
      : chartPoints.map((_, index) => index).filter((index) => index % 2 === 0);

  function getPointIndexFromPointer(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const graphX = (event.clientX - bounds.left) / bounds.width * 1000;
    const ratio = Math.min(1, Math.max(0, (graphX - GRAPH.left) / (GRAPH.right - GRAPH.left)));
    return Math.round(ratio * (chartPoints.length - 1));
  }

  function updateActivePoint(event: PointerEvent<SVGSVGElement>) {
    if (pinnedIndex !== null) return;
    if (isLoading || currentError || isAnimating || chartPoints.length < 2) return;
    const nextIndex = getPointIndexFromPointer(event);
    setActiveIndex((current) => current === nextIndex ? current : nextIndex);
  }

  function pinPoint(event: PointerEvent<SVGSVGElement>) {
    if (isLoading || currentError || isAnimating || chartPoints.length < 2) return;
    const nextIndex = getPointIndexFromPointer(event);
    setPinnedIndex(nextIndex);
    setActiveIndex(nextIndex);
  }

  return (
    <section className={`transaction-graph is-${type.toLowerCase()}${isAnimating ? " is-animating" : ""}`} aria-label={`${type === "EXPENSE" ? "Spending" : "Income"} graph`}>
      <div className="transaction-graph-heading">
        <div>
          <p className="eyebrow">Your cash flow</p>
          <h2>{type === "EXPENSE" ? "Spending" : "Income"} over time</h2>
          <p>{type === "EXPENSE" ? "Follow your expenses day by day." : "See when money comes in."}</p>
        </div>
        <div className="transaction-graph-controls">
          <div className="transaction-graph-type" role="group" aria-label="Graph transaction type">
            <button
              aria-pressed={type === "EXPENSE"}
              className={type === "EXPENSE" ? "is-active" : ""}
              onClick={() => { setType("EXPENSE"); setActiveIndex(null); setPinnedIndex(null); }}
              type="button"
            >Spending</button>
            <button
              aria-pressed={type === "INCOME"}
              className={type === "INCOME" ? "is-active" : ""}
              onClick={() => { setType("INCOME"); setActiveIndex(null); setPinnedIndex(null); }}
              type="button"
            >Income</button>
          </div>
          <div className="transaction-graph-ranges" role="group" aria-label="Graph time range">
            {(["week", "month", "year"] as const).map((option) => (
              <button
                aria-pressed={range === option}
                className={range === option ? "is-active" : ""}
                key={option}
                onClick={() => { setRange(option); setActiveIndex(null); setPinnedIndex(null); }}
                type="button"
              >
                {option[0].toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="transaction-graph-data-note">
        Chart totals use all transactions returned for this period.
        <span> Hover over the graph to inspect each point.</span>
      </p>

      <div className="transaction-graph-period" aria-label={`${range[0].toUpperCase()}${range.slice(1)} selector`}>
        <button
          aria-label={`Previous ${range}`}
          onClick={() => {
            setSelectedDate(shiftPeriod(requestDate, range, -1));
            setActiveIndex(null);
            setPinnedIndex(null);
          }}
          type="button"
        >‹</button>
        <strong aria-live="polite">{formatPeriodLabel(requestDate, range)}</strong>
        <button
          aria-label={`Next ${range}`}
          disabled={!canViewNextPeriod}
          onClick={() => {
            setSelectedDate(shiftPeriod(requestDate, range, 1));
            setActiveIndex(null);
            setPinnedIndex(null);
          }}
          type="button"
        >›</button>
      </div>

      <div className={`transaction-graph-chart-wrap${isLoading ? " is-updating" : ""}`}>
        <div className="transaction-graph-grid" aria-hidden="true">
          <span /><span /><span />
        </div>
        <svg
          aria-label={`${type === "EXPENSE" ? "Spending" : "Income"} trend. Hover across the graph or focus and use arrow keys to inspect the values.`}
          className="transaction-graph-chart"
          onBlur={() => {
            if (pinnedIndex === null) setActiveIndex(null);
          }}
          onFocus={() => setActiveIndex((current) => pinnedIndex ?? current ?? points.length - 1)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setPinnedIndex(null);
              setActiveIndex(null);
              return;
            }
            setPinnedIndex(null);
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(chartPoints.length - 1, (current ?? chartPoints.length - 1) + 1));
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, (current ?? chartPoints.length - 1) - 1));
            } else if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(chartPoints.length - 1);
            }
          }}
          onPointerDown={pinPoint}
          onPointerLeave={() => {
            if (pinnedIndex === null) setActiveIndex(null);
          }}
          onPointerMove={updateActivePoint}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          tabIndex={isLoading || currentError || isAnimating ? -1 : 0}
          viewBox="0 0 1000 320"
          aria-busy={isLoading || isAnimating}
        >
          <defs>
            <linearGradient id="graph-area-expense" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#e5a18c" stopOpacity=".32" />
              <stop offset="100%" stopColor="#e5a18c" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="graph-area-income" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#92c3a0" stopOpacity=".34" />
              <stop offset="100%" stopColor="#92c3a0" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path key={`area-${animationKey}`} className="transaction-graph-area" d={areaPath} />
          <path
            key={`line-${animationKey}`}
            className="transaction-graph-line"
            d={linePath}
            pathLength={1}
          />
          {tickIndexes.map((index) => (
            <text className="transaction-graph-tick" key={chartPoints[index]?.key} textAnchor="middle" x={xAt(index)} y="305">
              {chartPoints[index]?.label}
            </text>
          ))}
          {selectedPointIndex !== null && activePoint && !isLoading && !currentError && !isAnimating && (
            <>
              <line className="transaction-graph-cursor" x1={xAt(activePointIndex)} x2={xAt(activePointIndex)} y1={GRAPH.top} y2={GRAPH.bottom} />
              <circle className="transaction-graph-pointer-halo" cx={xAt(activePointIndex)} cy={yAt(activePoint.amount / maxAmount)} r="9" />
              <circle className="transaction-graph-pointer" cx={xAt(activePointIndex)} cy={yAt(activePoint.amount / maxAmount)} r="4" />
            </>
          )}
        </svg>
        {isLoading && showLoadingIndicator && (
          <div className="transaction-graph-loading">
            <PremiumLoader compact label="Updating graph…" />
          </div>
        )}
        {currentError && (
          <div className="transaction-graph-loading is-error" role="alert">
            <span>{currentError}</span>
          </div>
        )}
        <aside aria-live="polite" className="transaction-graph-details">
          {showHoverCard && activePoint ? (
            <>
              <div className="transaction-graph-details-heading">
                <div>
                  <span className="transaction-graph-details-date">{activePoint.dateLabel}</span>
                  <small className="transaction-graph-details-caption">
                    {type === "EXPENSE" ? "Spent" : "Received"} · {activePoint.transactions.length} {activePoint.transactions.length === 1 ? "transaction" : "transactions"}
                  </small>
                </div>
                <strong className="transaction-graph-details-total">{formatMoney(activePoint.amount, currency)}</strong>
              </div>
              {activePoint.transactions.length > 0 ? (
                <ul>
                  {[...activePoint.transactions]
                    .sort((first, second) => second.amount - first.amount)
                    .slice(0, 3)
                    .map((transaction) => (
                    <li className="transaction-graph-details-row" key={transaction.id}>
                      <span>
                        <strong>{transaction.description || transaction.category?.name || (type === "EXPENSE" ? "Expense" : "Income")}</strong>
                        <small>{transaction.subCategory?.name || transaction.category?.name || (type === "EXPENSE" ? "Expense" : "Income")}</small>
                      </span>
                      <b>{formatMoney(transaction.amount, currency)}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="transaction-graph-details-empty">
                  No {type === "EXPENSE" ? "spending" : "income"} recorded for this date.
                </p>
              )}
            </>
          ) : (
            <p className="transaction-graph-details-placeholder">
              Hover over a point to explore that day’s activity.
            </p>
          )}
        </aside>
      </div>
      {!isLoading && !currentError && transactions.length === 0 && (
        <p className="transaction-graph-status">No transactions returned for this {range}.</p>
      )}
    </section>
  );
}
