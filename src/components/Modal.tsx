import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    (
      d?.querySelector<HTMLElement>("[data-autofocus]") ??
      d?.querySelector<HTMLElement>(
        "input:not([type=checkbox]), textarea, select",
      )
    )?.focus();
    return () => {
      d?.close();
      requestAnimationFrame(() => {
        if (
          !d?.open &&
          document.activeElement === document.body &&
          trigger.current?.isConnected
        )
          trigger.current.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
