import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export default function Dialog({
  title,
  children,
  onClose,
  wide = false,
  locked = false,
}) {
  const element = useRef(null);
  const closeRef = useRef(onClose);
  const lockedRef = useRef(locked);
  closeRef.current = onClose;
  lockedRef.current = locked;
  useEffect(() => {
    const previous = document.activeElement;
    const node = element.current;
    node?.querySelector("input,button,textarea,select")?.focus();
    const key = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!lockedRef.current) closeRef.current();
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...node.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
        ),
      ];
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1).focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === controls.at(-1)
      ) {
        event.preventDefault();
        controls[0].focus();
      }
    };
    node?.addEventListener("keydown", key);
    return () => {
      node?.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop feature-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <section
        ref={element}
        className={`modal feature-modal ${wide ? "feature-modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          className="icon-button modal-close"
          aria-label="关闭窗口"
          disabled={locked}
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <div className="modal-title">
          <h2>{title}</h2>
        </div>
        {children}
      </section>
    </div>
  );
}
