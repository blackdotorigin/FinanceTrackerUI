import React, { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { API_BASE_URL } from "./api/apiBaseUrl";
import CurrencySelect from "./formatting/CurrencySelect";
import FinanceDashboard from "./FinanceDashboard";
import PremiumLoader from "./PremiumLoader";
import { useAutoHideScrollbars } from "./hooks/useAutoHideScrollbars";
import { useMinimumLoading } from "./hooks/useMinimumLoading";

let oauthRefreshRequest: Promise<unknown> | null = null;
let sessionRestoreRequest: Promise<string | null> | null = null;
const WELCOME_DURATION_MS = 6000;
const WELCOME_DURATION_SECONDS = Math.ceil(WELCOME_DURATION_MS / 1000);
const MOBILE_OAUTH_CALLBACK = "com.blackdotorigin.financeflow://auth/callback";

function createUrlSafeRandomString(): string {
  let binary = "";
  window.crypto.getRandomValues(new Uint8Array(32)).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createPkceChallenge(verifier: string): Promise<string> {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  new Uint8Array(digest).forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function BrandMark() {
  return (
    <a className="brand" href="/" aria-label="FinanceFlow home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <g transform="translate(3.2 3.2) scale(.8)">
            <path
              d="M7 22.5 13.2 16l4.3 4.1L25 11"
              stroke="currentColor"
              strokeWidth="2.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M19.4 11H25v5.6"
              stroke="currentColor"
              strokeWidth="2.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      </span>
      <span>financeflow</span>
    </a>
  );
}

function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 2.8 14.2 9.8 21.2 12l-7 2.2-2.2 7-2.2-7-7-2.2 7-2.2L12 2.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function LuxuryWelcomeScreen({ secondsRemaining }: { secondsRemaining: number }) {
  return (
    <main className="page-shell premium-intro-shell">
      <div className="premium-intro" aria-label="Welcome screen">
        <div className="intro-glass">
          <section className="intro-welcome-panel" aria-label="Black Dot welcome">
            <div className="intro-brand-lockup" aria-label="FinanceFlow brand mark">
              <BrandMark />
            </div>
            <div className="intro-copy">
              <span className="intro-micro">Product of</span>
              <h1 className="intro-title" aria-label="Black Dot We Believe Quality">
                <span className="intro-line reveal-main">Black Dot</span>
                <span className="intro-line reveal-sub">We Believe Quality</span>
              </h1>
              <p className="intro-message">
                <span>The present becomes the past.</span>
                <span>The future depends on what we do today.</span>
                <span>Be mindful of the moments you create.</span>
              </p>
            </div>
          </section>
          <aside className="intro-transition-panel" aria-label={`Opening sign in in ${secondsRemaining} seconds`}>
            <p className="intro-transition-eyebrow">A clearer way forward</p>
            <p className="intro-transition-title">Your finances,<br />in flow.</p>
            <div className="intro-countdown" role="timer" aria-live="off">
              <span className="intro-countdown-label">Sign in opens in</span>
              <span className="intro-countdown-value" key={secondsRemaining}>{secondsRemaining}</span>
              <span className="intro-countdown-unit">{secondsRemaining === 1 ? "second" : "seconds"}</span>
              <progress
                className="intro-countdown-progress"
                value={WELCOME_DURATION_SECONDS - secondsRemaining}
                max={WELCOME_DURATION_SECONDS}
                aria-label={`${WELCOME_DURATION_SECONDS - secondsRemaining} of ${WELCOME_DURATION_SECONDS} seconds elapsed`}
              />
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function PasswordIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.4 4.4 9 7-.2 1-.9 2.2-2 3.3M6.2 6.3C3.9 7.8 2.4 10.3 2 12c.6 2.6 3.8 7 10 7 1.1 0 2.1-.2 3-.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function createPreviewCurve() {
  const points = Array.from({ length: 7 }, (_, index) => ({
    x: index * 60,
    y: 24 + Math.round(Math.random() * 52),
  }));
  const segments = points.slice(0, -1).map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[index + 1];
    const afterNext = points[Math.min(points.length - 1, index + 2)];
    const controlOne = {
      x: point.x + (next.x - previous.x) / 6,
      y: point.y + (next.y - previous.y) / 6,
    };
    const controlTwo = {
      x: next.x - (afterNext.x - point.x) / 6,
      y: next.y - (afterNext.y - point.y) / 6,
    };
    return `C${controlOne.x} ${controlOne.y} ${controlTwo.x} ${controlTwo.y} ${next.x} ${next.y}`;
  });
  const line = `M${points[0].x} ${points[0].y}${segments.join("")}`;
  return { line, start: points[0] };
}

function createPreviewAmounts() {
  const balanceCents = 450_000 + Math.floor(Math.random() * 2_050_000);
  const spendingCents = 45_000 + Math.floor(Math.random() * 255_000);
  const largestCategoryCents = Math.floor(spendingCents * (0.24 + Math.random() * 0.24));
  const formatAmount = (cents: number) => ({
    dollars: Math.floor(cents / 100).toLocaleString("en-US"),
    cents: String(cents % 100).padStart(2, "0"),
  });
  return {
    balance: formatAmount(balanceCents),
    spending: formatAmount(spendingCents),
    largestCategory: formatAmount(largestCategoryCents),
  };
}

function MoneyIllustration() {
  const [previewMode, setPreviewMode] = useState<"balance" | "spending">("balance");
  const [previewAmounts] = useState(createPreviewAmounts);
  const [chartCurves] = useState(() => ({
    balance: createPreviewCurve(),
    spending: createPreviewCurve(),
  }));

  function tiltCard(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    if (event.target instanceof Element && event.target.closest("button")) {
      event.currentTarget.style.transform = "";
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    event.currentTarget.style.transform =
      `perspective(900px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg) scale3d(1.015, 1.015, 1.015)`;
  }

  function resetCardTilt(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.transform = "";
  }

  return (
    <section className="visual-panel" aria-label="Interactive finance preview">
      <div className="visual-orbit orbit-one" />
      <div className="visual-orbit orbit-two" />
      <Sparkle className="sparkle sparkle-one" />
      <Sparkle className="sparkle sparkle-two" />
      <div className="visual-copy">
        <span className="eyebrow">A little more clarity</span>
        <h2>Your money,<br />in a better place.</h2>
        <p>Simple snapshots. Thoughtful progress. A calmer way to keep track.</p>
      </div>

      <div className="overview-card-float">
        <div
          className={`overview-card is-${previewMode}`}
          onPointerLeave={resetCardTilt}
          onPointerMove={tiltCard}
        >
          <div className="overview-heading">
            <div>
              <span className="card-label">{previewMode === "balance" ? "Total balance" : "Spent this month"}</span>
              <strong>
                ${previewMode === "balance" ? previewAmounts.balance.dollars : previewAmounts.spending.dollars}
                <span>.{previewMode === "balance" ? previewAmounts.balance.cents : previewAmounts.spending.cents}</span>
              </strong>
            </div>
            <span className="balance-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 17 9 12l3.5 3.5L20 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15 8h5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          <div className="preview-switch" role="group" aria-label="Preview chart">
            <button
              aria-pressed={previewMode === "balance"}
              className={previewMode === "balance" ? "is-active" : ""}
              onClick={() => setPreviewMode("balance")}
              type="button"
            >
              Balance
            </button>
            <button
              aria-pressed={previewMode === "spending"}
              className={previewMode === "spending" ? "is-active" : ""}
              onClick={() => setPreviewMode("spending")}
              type="button"
            >
              Spending
            </button>
          </div>
          <div className="chart" aria-hidden="true">
            <div className="chart-gridline gridline-one" />
            <div className="chart-gridline gridline-two" />
            <div className="chart-gridline gridline-three" />
            <svg viewBox="0 0 360 98" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#a8d7b5" stopOpacity=".35" />
                  <stop offset="1" stopColor="#a8d7b5" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="chart-fill-spending" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#e6a18b" stopOpacity=".36" />
                  <stop offset="1" stopColor="#e6a18b" stopOpacity="0" />
                </linearGradient>
              </defs>
              {(() => {
                const curve = chartCurves[previewMode];
                const area = `${curve.line}L360 98L0 98Z`;
                return (
                  <>
                    <path
                      className={`preview-chart-area is-${previewMode}`}
                      d={area}
                      fill={`url(#chart-fill${previewMode === "spending" ? "-spending" : ""})`}
                    />
                    <path
                      className={`preview-chart-line is-${previewMode}`}
                      d={curve.line}
                      fill="none"
                      strokeWidth="2.5"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      className="chart-static-pointer"
                      cx={curve.start.x}
                      cy={curve.start.y}
                      r="4"
                    />
                    <g className="chart-motion-pointer">
                      <circle className="chart-pointer-halo" r="8" />
                      <circle className="chart-pointer-core" r="3.2" />
                      <animateMotion
                        key={previewMode}
                        calcMode="linear"
                        dur="6s"
                        keyPoints="0;1;1;0;0"
                        keyTimes="0;.44;.5;.94;1"
                        repeatCount="indefinite"
                      >
                        <mpath href={`#preview-curve-${previewMode}`} />
                      </animateMotion>
                    </g>
                    <path
                      id={`preview-curve-${previewMode}`}
                      d={curve.line}
                      fill="none"
                      stroke="none"
                    />
                  </>
                );
              })()}
            </svg>
          </div>
          <div className="chart-labels">
            <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
          </div>
          <div className="spending-row">
            <span className="spending-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 7h16v12H4zM4 7l2-3h12l2 3M16 13h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <circle cx="16" cy="13" r=".8" fill="currentColor" />
              </svg>
            </span>
            <span className="spending-name">{previewMode === "balance" ? "Everyday spending" : "Largest category"}</span>
            <span className="spending-amount">
              ${previewMode === "balance"
                ? previewAmounts.spending.dollars
                : previewAmounts.largestCategory.dollars}
              .{previewMode === "balance"
                ? previewAmounts.spending.cents
                : previewAmounts.largestCategory.cents}
            </span>
          </div>
        </div>
      </div>

      <span className="visual-caption">A clearer view, one day at a time.</span>
    </section>
  );
}

export default function App() {
  useAutoHideScrollbars();

  const [isOAuthCallback, setIsOAuthCallback] = useState(
    window.location.pathname === "/auth/callback",
  );
  const [isMobileOAuthCallback, setIsMobileOAuthCallback] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [showPassword, setShowPassword] = useState(false);
  const [showWelcome, setShowWelcome] = useState(!isOAuthCallback);
  const [welcomeSecondsRemaining, setWelcomeSecondsRemaining] = useState(WELCOME_DURATION_SECONDS);
  const [isSubmitting, setIsSubmitting] = useState(isOAuthCallback);
  const showOAuthFinishing = useMinimumLoading(isOAuthCallback && isSubmitting);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [isRestoringSession, setIsRestoringSession] = useState(!isOAuthCallback);
  const showRestoringSession = useMinimumLoading(isRestoringSession);
  const mobileOAuthState = useRef("");
  const mobileOAuthVerifier = useRef("");
  const handledMobileOAuthUrls = useRef(new Set<string>());
  const clearSession = useCallback(() => setAccessToken(""), []);

  useEffect(() => {
    if (isOAuthCallback) return;

    let isCurrent = true;
    const restoreSession = async () => {
      try {
        sessionRestoreRequest ??= fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
          method: "POST",
          credentials: "include",
        }).then(async (response) => {
          if (response.status === 401) return null;
          if (!response.ok) throw new Error("Could not restore the session.");

          const result: unknown = await response.json();
          if (
            !result ||
            typeof result !== "object" ||
            !("accessToken" in result) ||
            typeof result.accessToken !== "string" ||
            !result.accessToken
          ) {
            throw new Error("The restored session response was invalid.");
          }
          return result.accessToken;
        }).finally(() => {
          sessionRestoreRequest = null;
        });

        const restoredToken = await sessionRestoreRequest;
        if (isCurrent && restoredToken) setAccessToken(restoredToken);
      } catch {
        if (isCurrent) {
          setNotice("We couldn’t restore your saved sign-in. Please check your connection and sign in again.");
        }
      } finally {
        if (isCurrent) setIsRestoringSession(false);
      }
    };

    void restoreSession();
    return () => {
      isCurrent = false;
    };
  }, [isOAuthCallback]);

  const handleMobileOAuthCallback = useCallback(async (callbackUrl: string) => {
    let url: URL;
    try {
      url = new URL(callbackUrl);
    } catch {
      return;
    }

    if (
      url.protocol !== "com.blackdotorigin.financeflow:" ||
      url.hostname !== "auth" ||
      url.pathname !== "/callback" ||
      handledMobileOAuthUrls.current.has(url.href)
    ) {
      return;
    }
    handledMobileOAuthUrls.current.add(url.href);

    setShowWelcome(false);
    setIsOAuthCallback(true);
    setIsMobileOAuthCallback(true);
    setIsSubmitting(true);
    setError("");

    const authorizationCode = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const providerError = url.searchParams.get("error");
    const expectedState = mobileOAuthState.current;
    const codeVerifier = mobileOAuthVerifier.current;
    mobileOAuthState.current = "";
    mobileOAuthVerifier.current = "";

    if (!returnedState || returnedState !== expectedState || !codeVerifier) {
      setError("We couldn’t verify the mobile sign-in response. Please try again.");
      setIsSubmitting(false);
      return;
    }
    if (providerError) {
      setError("Provider sign-in was cancelled or couldn’t be completed. Please try again.");
      setIsSubmitting(false);
      return;
    }
    if (!authorizationCode) {
      setError("We couldn’t finish mobile sign-in. Please try again.");
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/mobile/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          code: authorizationCode,
          codeVerifier,
          state: returnedState,
        }),
      });
      if (!response.ok) throw new Error("Mobile sign-in exchange failed.");

      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        !("accessToken" in result) ||
        typeof result.accessToken !== "string" ||
        !result.accessToken
      ) {
        throw new Error("Mobile sign-in response was invalid.");
      }
      setAccessToken(result.accessToken);
    } catch {
      setError("We couldn’t finish mobile sign-in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let isCurrent = true;
    let appUrlListener: { remove: () => Promise<void> } | undefined;
    void CapacitorApp.addListener("appUrlOpen", ({ url }) => {
      void handleMobileOAuthCallback(url);
    }).then((listener) => {
      if (!isCurrent) {
        void listener.remove();
        return;
      }
      appUrlListener = listener;
    }).catch(() => {
      if (isCurrent) setError("Mobile sign-in links couldn’t be enabled. Please restart the app.");
    });

    void CapacitorApp.getLaunchUrl().then((launch) => {
      if (isCurrent && launch?.url) void handleMobileOAuthCallback(launch.url);
    }).catch(() => {
      if (isCurrent) setError("The app couldn’t read its sign-in link. Please try again.");
    });

    return () => {
      isCurrent = false;
      if (appUrlListener) void appUrlListener.remove();
    };
  }, [handleMobileOAuthCallback]);

  useEffect(() => {
    if (accessToken || isOAuthCallback || isMobileOAuthCallback) return;

    const welcomeStartedAt = window.performance.now();
    const welcomeTimer = window.setTimeout(() => {
      setWelcomeSecondsRemaining(0);
      setShowWelcome(false);
    }, WELCOME_DURATION_MS);
    const countdownTimer = window.setInterval(() => {
      const elapsed = window.performance.now() - welcomeStartedAt;
      const remaining = Math.max(0, Math.ceil((WELCOME_DURATION_MS - elapsed) / 1000));
      setWelcomeSecondsRemaining((current) => current === remaining ? current : remaining);
    }, 250);
    const audioTimer = window.setTimeout(() => {
      const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioCtor) return;

      const audioContext = new AudioCtor();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(180, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(330, audioContext.currentTime + 0.26);

      gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.03);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.7);

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.72);
      oscillator.onended = () => void audioContext.close();
    }, 420);

    return () => {
      clearTimeout(welcomeTimer);
      clearInterval(countdownTimer);
      clearTimeout(audioTimer);
    };
  }, [accessToken, isOAuthCallback, isMobileOAuthCallback]);

  useEffect(() => {
    if (!isOAuthCallback || isMobileOAuthCallback) return;

    let isCurrent = true;
    oauthRefreshRequest ??= fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
    }).then(async (response) => {
        if (!response.ok) throw new Error("Could not finish provider sign-in.");
        return response.json() as Promise<unknown>;
      });

    oauthRefreshRequest
      .then((result) => {
        if (
          !result ||
          typeof result !== "object" ||
          !("accessToken" in result) ||
          typeof result.accessToken !== "string" ||
          !result.accessToken
        ) {
          throw new Error("Could not finish provider sign-in.");
        }
        if (isCurrent) {
          setAccessToken(result.accessToken);
        }
      })
      .catch(() => {
        oauthRefreshRequest = null;
        if (isCurrent) {
          setError("We couldn’t finish sign-in. Please try again.");
        }
      })
      .finally(() => {
        if (isCurrent) setIsSubmitting(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [isOAuthCallback, isMobileOAuthCallback]);

  async function openMobileProviderSignIn(provider: "google" | "github") {
    setError("");

    try {
      const state = createUrlSafeRandomString();
      const codeVerifier = createUrlSafeRandomString();
      const codeChallenge = await createPkceChallenge(codeVerifier);
      const authorizationUrl = new URL(
        `${API_BASE_URL}/oauth2/authorization/${provider}`,
      );
      authorizationUrl.searchParams.set("app_redirect_uri", MOBILE_OAUTH_CALLBACK);
      authorizationUrl.searchParams.set("app_state", state);
      authorizationUrl.searchParams.set("app_code_challenge", codeChallenge);
      authorizationUrl.searchParams.set("app_code_challenge_method", "S256");
      mobileOAuthState.current = state;
      mobileOAuthVerifier.current = codeVerifier;
      await Browser.open({ url: authorizationUrl.toString() });
    } catch {
      mobileOAuthState.current = "";
      mobileOAuthVerifier.current = "";
      setError("We couldn’t open provider sign-in. Please try again.");
    }
  }

  function handleProviderSignInClick(
    event: React.MouseEvent<HTMLAnchorElement>,
    provider: "google" | "github",
  ) {
    if (!Capacitor.isNativePlatform()) return;
    event.preventDefault();
    void openMobileProviderSignIn(provider);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    const normalizedUsername = username.trim().toLowerCase();
    if (mode === "signup") {
      const normalizedEmail = email.trim();
      const normalizedName = fullName.trim();
      const normalizedCurrency = defaultCurrency.trim().toUpperCase();

      if (
        normalizedName.length === 0 ||
        normalizedName.length > 150 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
        normalizedUsername.length < 3 ||
        normalizedUsername.length > 50 ||
        password.length < 8 ||
        password.length > 72 ||
        !/^[A-Z]{3}$/.test(normalizedCurrency)
      ) {
        setError("Check your details: username must be 3–50 characters, password 8–72 characters, and currency a 3-letter code.");
        return;
      }
    } else if (!normalizedUsername || !password) {
      setError("Enter your username and password to continue.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response =
        mode === "signup"
          ? await fetch(`${API_BASE_URL}/api/v1/users`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: email.trim(),
                username: normalizedUsername,
                password,
                fullName: fullName.trim(),
                defaultCurrency: defaultCurrency.trim().toUpperCase(),
              }),
            })
          : await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username: normalizedUsername, password }),
              credentials: "include",
            });

      if (!response.ok) {
        setError(
          mode === "signup"
            ? "We couldn’t create your account. Check your details or try a different email or username."
            : "We couldn’t sign you in. Check your username and password and try again.",
        );
        return;
      }

      if (mode === "signup") {
        setUsername(normalizedUsername);
        setPassword("");
        setMode("login");
        setNotice("Your account is ready. Sign in with your username and password.");
        return;
      }

      const result = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        typeof result.accessToken !== "string" ||
        !result.accessToken
      ) {
        setError("Sign-in couldn’t be completed. Please try again.");
        return;
      }

      setAccessToken(result.accessToken);
    } catch {
      setError("We couldn’t reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (showRestoringSession) {
    return (
      <main className="page-shell">
        <PremiumLoader label="Restoring your session." variant="restore" />
      </main>
    );
  }

  if (showWelcome && !accessToken) {
    return <LuxuryWelcomeScreen secondsRemaining={welcomeSecondsRemaining} />;
  }

  if (accessToken && !showOAuthFinishing) {
    return (
      <FinanceDashboard
        accessToken={accessToken}
        initialUsername={username.trim().toLowerCase()}
        onAccessTokenChange={setAccessToken}
        onLogout={clearSession}
      />
    );
  }

  if (showOAuthFinishing) {
    return (
      <main className="page-shell">
        <PremiumLoader label="Finishing sign-in…" />
      </main>
    );
  }

  return (
    <main className="page-shell">
      <div className="login-layout">
        <section className="login-panel" aria-labelledby="login-heading">
          <BrandMark />
          <div className="form-wrap">
            <div className="form-intro">
              <span className="welcome-pill"><span /> Your finances, in flow</span>
              <p className="eyebrow">{mode === "login" ? "Welcome back" : "A fresh start"}</p>
              <h1 id="login-heading">
                {mode === "login" ? <>Make room for<br />what matters.</> : <>Make your money<br />feel at home.</>}
              </h1>
              <p className="intro-copy">
                {mode === "login"
                  ? "Sign in to see your money with a little more clarity."
                  : "Create an account to start seeing your finances clearly."}
              </p>
            </div>

            <form className="login-form" onSubmit={handleSubmit} noValidate>
              {mode === "signup" && (
                <>
                  <div className="field">
                    <label htmlFor="fullName">Full name</label>
                    <div className="input-wrap">
                      <input
                        autoComplete="name"
                        id="fullName"
                        maxLength={150}
                        name="fullName"
                        onChange={(event) => setFullName(event.target.value)}
                        placeholder="Your full name"
                        required
                        value={fullName}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="email">Email address</label>
                    <div className="input-wrap">
                      <input
                        autoComplete="email"
                        id="email"
                        name="email"
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="you@example.com"
                        required
                        type="email"
                        value={email}
                      />
                    </div>
                  </div>
                </>
              )}
              <div className="field">
                <label htmlFor="username">Username</label>
                <div className="input-wrap">
                  <span className="input-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M5.5 20c.6-3.4 2.9-5.2 6.5-5.2s5.9 1.8 6.5 5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    autoComplete="username"
                    id="username"
                    maxLength={50}
                    name="username"
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Your username"
                    required
                    minLength={mode === "signup" ? 3 : undefined}
                    value={username}
                  />
                </div>
              </div>

              {mode === "signup" && (
                <div className="field">
                  <label htmlFor="currency">Default currency</label>
                  <div className="input-wrap">
                    <CurrencySelect
                      aria-label="Default currency"
                      id="currency"
                      name="currency"
                      onChange={setDefaultCurrency}
                      required
                      value={defaultCurrency}
                    />
                  </div>
                </div>
              )}

              <div className="field">
                <div className="label-row">
                  <label htmlFor="password">Password</label>
                </div>
                <div className="input-wrap">
                  <span className="input-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <rect x="5" y="10" width="14" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                      <circle cx="12" cy="15" r="1.2" fill="currentColor" />
                    </svg>
                  </span>
                  <input
                    autoComplete="current-password"
                    id="password"
                    maxLength={72}
                    minLength={mode === "signup" ? 8 : undefined}
                    name="password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    required
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <button
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="visibility-toggle"
                    onClick={() => setShowPassword((visible) => !visible)}
                    type="button"
                  >
                    <PasswordIcon visible={showPassword} />
                  </button>
                </div>
              </div>

              {error && <p className="form-error" role="alert">{error}</p>}
              {notice && <p className="form-notice" role="status">{notice}</p>}

              <button className="submit-button" disabled={isSubmitting} type="submit">
                <span>
                  {isSubmitting
                    ? mode === "signup" ? "Creating account…" : "Signing you in…"
                    : mode === "signup" ? "Create account" : "Sign in"}
                </span>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>

            <div className="auth-switch">
              {mode === "login" ? (
                <>
                  <span>New to FinanceFlow?</span>
                  <button type="button" onClick={() => { setMode("signup"); setError(""); setNotice(""); }}>
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  <span>Already have an account?</span>
                  <button type="button" onClick={() => { setMode("login"); setError(""); setNotice(""); }}>
                    Sign in
                  </button>
                </>
              )}
            </div>

            {mode === "login" && (
              <>
                <div className="divider"><span>or continue with</span></div>
                <div className="provider-buttons">
                  <a
                    className="provider-button"
                    href={`${API_BASE_URL}/oauth2/authorization/google`}
                    onClick={(event) => handleProviderSignInClick(event, "google")}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#4285F4" d="M21.35 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.24a4.48 4.48 0 0 1-1.95 2.94v2.4h3.16c1.85-1.7 2.9-4.2 2.9-7.17Z" />
                      <path fill="#34A853" d="M12 21.75c2.64 0 4.85-.88 6.47-2.37l-3.16-2.4c-.88.59-2 .94-3.31.94-2.55 0-4.71-1.72-5.49-4.03H3.24v2.48A9.75 9.75 0 0 0 12 21.75Z" />
                      <path fill="#FBBC05" d="M6.51 13.89a5.86 5.86 0 0 1 0-3.78V7.63H3.24a9.75 9.75 0 0 0 0 8.74l3.27-2.48Z" />
                      <path fill="#EA4335" d="M12 6.08c1.44 0 2.73.5 3.75 1.5l2.81-2.8C16.84 3.17 14.64 2.25 12 2.25a9.75 9.75 0 0 0-8.76 5.38l3.27 2.48C7.29 7.8 9.45 6.08 12 6.08Z" />
                    </svg>
                    Google
                  </a>
                  <a
                    className="provider-button"
                    href={`${API_BASE_URL}/oauth2/authorization/github`}
                    onClick={(event) => handleProviderSignInClick(event, "github")}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="currentColor" d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.1c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.72 1.15 1.72 1.15.99 1.7 2.6 1.2 3.24.92.1-.72.39-1.2.7-1.48-2.48-.28-5.1-1.24-5.1-5.52 0-1.22.44-2.21 1.15-2.99-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.11-1.44 3.05-1.14 3.05-1.14.61 1.54.23 2.68.11 2.96.72.78 1.15 1.77 1.15 2.99 0 4.29-2.63 5.23-5.13 5.51.4.35.75 1.03.75 2.08v3.06c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z" />
                    </svg>
                    GitHub
                  </a>
                </div>
              </>
            )}

            <div className="form-footnote">
              <span className="secure-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="M10 2.5 4 5v4.2c0 4 2.4 6.8 6 8.3 3.6-1.5 6-4.3 6-8.3V5l-6-2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="m7.5 9.8 1.7 1.7 3.6-3.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span>Your financial details stay private and protected.</span>
            </div>
          </div>
          <footer className="login-footer">
            <span>© 2026 FinanceFlow</span>
            <span className="footer-dot">·</span>
            <span>Made for peace of mind</span>
          </footer>
        </section>

        <MoneyIllustration />
      </div>
    </main>
  );
}
