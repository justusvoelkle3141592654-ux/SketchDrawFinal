// Global overlay UI: tooltips, toasts, modal frame and confirmation dialogs.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useUi } from '../state/ui';
import { Icon } from './icons';
import { Button } from './controls/controls';

/** Shows `data-tip` text near hovered/focused elements after a short delay. */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const show = (el: HTMLElement, delay: number) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      if (timer.current) clearTimeout(timer.current);
      current.current = el;
      timer.current = setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const above = r.bottom + 40 > window.innerHeight;
        setTip({
          text,
          x: Math.min(window.innerWidth - 12, Math.max(12, r.left + r.width / 2)),
          y: above ? r.top - 6 : r.bottom + 6,
          above,
        });
      }, delay);
    };
    const hide = () => {
      if (timer.current) clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!el) return hide();
      if (el !== current.current) {
        setTip(null);
        show(el, 480);
      }
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el && (e.target as HTMLElement).matches(':focus-visible')) show(el, 250);
    };
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('focusin', focus);
    window.addEventListener('focusout', hide);
    window.addEventListener('keydown', hide);
    return () => {
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('focusin', focus);
      window.removeEventListener('focusout', hide);
      window.removeEventListener('keydown', hide);
    };
  }, []);
  if (!tip) return null;
  return (
    <div
      className={`tooltip ${tip.above ? 'is-above' : ''}`}
      style={{ left: tip.x, top: tip.y }}
      role="tooltip"
    >
      {tip.text}
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <Icon
            name={
              t.kind === 'error'
                ? 'warning'
                : t.kind === 'success'
                  ? 'check'
                  : t.kind === 'warning'
                    ? 'warning'
                    : 'info'
            }
            size={16}
          />
          <div className="toast-body">
            <div className="toast-text">{t.text}</div>
            {t.detail ? <div className="toast-detail">{t.detail}</div> : null}
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => dismiss(t.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Modal frame with focus trap, Escape handling and labelled title. */
export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const first = el.querySelector<HTMLElement>(
      '[autofocus], input, select, button:not(.modal-close), textarea',
    );
    (first ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
      if (e.key === 'Tab') {
        const items = [
          ...el.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && (i === 0 || i < 0)) {
          e.preventDefault();
          items[items.length - 1].focus();
        } else if (!e.shiftKey && i === items.length - 1) {
          e.preventDefault();
          items[0].focus();
        }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const titleId = `modal-title-${props.title.replace(/\W+/g, '-')}`;
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        ref={ref}
        className={`modal ${props.className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: props.width }}
        data-testid={props.testId}
      >
        <header className="modal-head">
          <h2 id={titleId}>{props.title}</h2>
          <button type="button" className="modal-close icon-btn" aria-label="Close" onClick={props.onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="modal-body">{props.children}</div>
        {props.footer ? <footer className="modal-foot">{props.footer}</footer> : null}
      </div>
    </div>
  );
}

export function ConfirmModal() {
  const req = useUi((s) => s.confirm);
  if (!req) return null;
  return (
    <Modal title={req.title} onClose={() => req.resolve(req.cancelId)} width={440} testId="confirm-dialog">
      <p className="confirm-text">{req.message}</p>
      <div className="confirm-buttons">
        {req.buttons.map((b, i) => (
          <Button
            key={b.id}
            kind={b.kind ?? 'default'}
            onClick={() => req.resolve(b.id)}
            autoFocus={i === 0}
            testId={`confirm-${b.id}`}
          >
            {b.label}
          </Button>
        ))}
      </div>
    </Modal>
  );
}
