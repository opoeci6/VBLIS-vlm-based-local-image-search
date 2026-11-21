import { cn } from '../../utils/cn';

// The one heading style of a settings section (the group's page has its own, larger title above).
export const SectionTitle = ({ children, className }) => (
  <h4 className={cn('text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400', className)}>{children}</h4>
);
