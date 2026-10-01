import React, { useEffect, useRef, useState } from 'react';

interface PopoverProps {
  trigger: React.ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  align?: 'left' | 'right';
  panelClassName?: string;
  children: (close: () => void) => React.ReactNode;
}

/** Small click-to-open panel that closes on outside click or Escape. */
export const Popover: React.FC<PopoverProps> = ({ trigger, triggerClassName, triggerTitle, align = 'right', panelClassName = 'w-52', children }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button type="button" title={triggerTitle} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={triggerClassName}>
        {trigger}
      </button>
      {open && (
        <div className={`absolute z-40 mt-1.5 ${align === 'right' ? 'right-0' : 'left-0'} ${panelClassName} rounded-xl bg-slate-900 border border-slate-700 shadow-2xl shadow-black/50 p-1.5`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

interface MenuItemProps {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}

export const MenuItem: React.FC<MenuItemProps> = ({ onClick, disabled, title, children }) => (
  <button
    type="button"
    disabled={disabled}
    title={title}
    onClick={onClick}
    className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
  >
    {children}
  </button>
);

export const triggerBtn = 'flex items-center space-x-1.5 py-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition cursor-pointer';
