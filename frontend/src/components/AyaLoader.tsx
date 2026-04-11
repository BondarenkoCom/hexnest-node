interface AyaLoaderProps {
  title: string;
  subtitle?: string;
  variant?: "panel" | "inline" | "compact";
  className?: string;
}

export default function AyaLoader({
  title,
  subtitle,
  variant = "inline",
  className = ""
}: AyaLoaderProps) {
  const classes = ["room-loader", "aya-loader", `aya-loader-${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="status" aria-live="polite" aria-busy="true">
      <img src="/assets/aya/happy.png" alt="Aya loading" className="loader-aya" />
      <div className="loader-text">
        <p className="loader-title">{title}</p>
        <div className="loader-bar"><div className="loader-bar-fill" /></div>
        {subtitle ? <p className="loader-sub">{subtitle}</p> : null}
      </div>
    </div>
  );
}
