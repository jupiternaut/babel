import { useCallback, type PointerEvent as ReactPointerEvent } from "react";

export function ResizeHandle({
  label,
  onDelta,
}: {
  label: string;
  onDelta: (delta: number) => void;
}) {
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      let last = event.clientX;
      const move = (next: PointerEvent) => {
        onDelta(next.clientX - last);
        last = next.clientX;
      };
      const up = () => {
        target.releasePointerCapture(event.pointerId);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onDelta],
  );

  return (
    <button
      type="button"
      className="resize"
      aria-label={label}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onDelta(-16);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onDelta(16);
        }
      }}
    />
  );
}
