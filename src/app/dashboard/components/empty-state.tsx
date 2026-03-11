interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export default function EmptyState({
  icon,
  title,
  description,
  children,
}: EmptyStateProps) {
  return (
    <div className="flex h-80 flex-col items-center justify-center gap-3">
      {icon && (
        <div className="rounded-full bg-zinc-100 p-4 dark:bg-zinc-800">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-zinc-500">{title}</p>
      {description && (
        <p className="max-w-sm text-center text-xs text-zinc-400">
          {description}
        </p>
      )}
      {children}
    </div>
  );
}
