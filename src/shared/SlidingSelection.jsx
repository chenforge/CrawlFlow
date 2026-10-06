import { useLayoutEffect, useRef, useState } from "react";

/** One continuous highlight travels between selected controls. */
export default function SlidingSelection({
  value,
  items,
  onChange,
  className = "",
  label,
  disabled = false,
  vertical = false,
}) {
  const container = useRef(null);
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    const node = container.current;
    const measure = () => {
      const active = node?.querySelector('[data-selected="true"]');
      if (active)
        setPosition({
          width: active.offsetWidth,
          height: active.offsetHeight,
          transform: `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`,
        });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [value, items]);
  return (
    <div
      ref={container}
      className={`sliding-selection ${vertical ? "vertical" : ""} ${className}`}
      role={vertical ? "navigation" : "tablist"}
      aria-label={label}
    >
      <span
        className={`selection-highlight ${position ? "positioned" : ""}`}
        aria-hidden="true"
        style={position || {}}
      />
      {items.map(({ id, Icon, label: text }) => (
        <button
          key={id}
          type="button"
          className={`selection-item ${value === id ? "selected" : ""}`}
          data-selected={value === id}
          disabled={disabled}
          role={vertical ? undefined : "tab"}
          aria-current={vertical && value === id ? "page" : undefined}
          aria-selected={vertical ? undefined : value === id}
          onClick={() => onChange(id)}
        >
          {Icon && <Icon size={19} />}
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
}
