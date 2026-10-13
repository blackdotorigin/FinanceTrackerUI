import PremiumLoader from "./PremiumLoader";
import { useMinimumLoading } from "./hooks/useMinimumLoading";

type Props = {
  active: boolean;
  label: string;
  compact?: boolean;
  variant?: "default" | "restore";
};

export default function MinimumLoader({ active, label, compact, variant }: Props) {
  const isVisible = useMinimumLoading(active);
  return isVisible ? (
    <PremiumLoader compact={compact} label={label} variant={variant} />
  ) : null;
}
