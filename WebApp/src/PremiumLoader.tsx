import { useState } from "react";
import "./premium-loader.css";

type LoaderStyle = "cube" | "gyro" | "coins" | "growth" | "pulse" | "spark" | "ledger" | "orbit";
const LOADER_STYLES: LoaderStyle[] = ["cube", "gyro", "coins", "growth", "pulse", "spark", "ledger", "orbit"];

type Props = {
  label: string;
  compact?: boolean;
  variant?: "default" | "restore";
};

export default function PremiumLoader({ label, compact = false, variant = "default" }: Props) {
  const [loaderStyle] = useState<LoaderStyle>(() =>
    LOADER_STYLES[Math.floor(Math.random() * LOADER_STYLES.length)],
  );

  return (
    <div
      aria-live="polite"
      className={`premium-loader${compact ? " is-compact" : ""}${variant === "restore" ? " is-restore" : ""}`}
      role="status"
    >
      {variant === "restore" ? (
        <div aria-hidden="true" className="premium-restore-scene">
          <div className="premium-restore-orbit premium-restore-orbit-one" />
          <div className="premium-restore-orbit premium-restore-orbit-two" />
          <div className="premium-restore-globe">
            <span />
            <svg viewBox="0 0 32 36" fill="none">
              <path d="M16 2.5 27 7v8.2c0 7.8-4.7 13.7-11 17.3C9.7 28.9 5 23 5 15.2V7l11-4.5Z" />
              <path d="m11.5 17.2 3.1 3.1 6.2-6.4" />
            </svg>
          </div>
          <i />
        </div>
      ) : (
        <div aria-hidden="true" className={`premium-loader-scene is-${loaderStyle}`}>
          {loaderStyle === "cube" ? (
            <>
              <div className="premium-loader-cube">
                <span /><span /><span /><span /><span /><span />
              </div>
              <i />
              <b />
            </>
          ) : loaderStyle === "gyro" ? (
            <>
              <div className="premium-loader-gyro">
                <i />
                <b />
                <span />
                <em />
              </div>
              <div className="premium-loader-gyro-orbit" />
              <div className="premium-loader-gyro-orbit is-secondary" />
            </>
          ) : (
            loaderStyle === "coins" ? (
            <div className="premium-loader-coins">
              <div className="premium-loader-coin is-back"><span>$</span></div>
              <div className="premium-loader-coin is-middle"><span>$</span></div>
              <div className="premium-loader-coin is-front"><span>$</span></div>
            </div>
            ) : loaderStyle === "growth" ? (
              <div className="premium-loader-growth">
                <span /><span /><span /><span />
              </div>
            ) : loaderStyle === "pulse" ? (
              <div className="premium-loader-pulse">
                <span /><span /><i />
              </div>
            ) : loaderStyle === "spark" ? (
              <div className="premium-loader-spark">
                <span /><span /><span /><i />
              </div>
            ) : loaderStyle === "ledger" ? (
              <div className="premium-loader-ledger">
                <span /><span /><span />
              </div>
            ) : (
              <div className="premium-loader-orbit">
                <span>$</span>
                <i />
              </div>
            )
          )}
        </div>
      )}
      <div className="premium-loader-copy">
        <span className="premium-loader-eyebrow">FINANCEFLOW</span>
        <strong>{label}</strong>
        <span aria-hidden="true" className="premium-loader-progress"><i /></span>
      </div>
    </div>
  );
}
