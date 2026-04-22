// =====================================================================
// SPLIT RESIZE — kéo divider để resize hai pane cạnh nhau
// =====================================================================

/**
 * Gắn event listeners để handle resize kéo thả lên split divider.
 * @param {HTMLElement} handle     — element .split-handle
 * @param {'horizontal'|'vertical'} direction
 */
export function initSplitHandleResize(handle, direction) {
  let dragging = false,
    startPos,
    prevEl,
    nextEl,
    prevSize,
    nextSize;
  const isH = direction === "horizontal";

  handle.addEventListener("mousedown", (e) => {
    prevEl = handle.previousElementSibling;
    nextEl = handle.nextElementSibling;
    if (!prevEl || !nextEl) return;
    dragging = true;
    startPos = isH ? e.clientX : e.clientY;
    prevSize = isH ? prevEl.offsetWidth : prevEl.offsetHeight;
    nextSize = isH ? nextEl.offsetWidth : nextEl.offsetHeight;
    handle.classList.add("active");
    document.body.style.cursor = isH ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const d = (isH ? e.clientX : e.clientY) - startPos;
    const total = prevSize + nextSize;
    const newPrev = Math.max(120, Math.min(prevSize + d, total - 120));
    prevEl.style.flex = `0 0 ${newPrev}px`;
    nextEl.style.flex = `0 0 ${total - newPrev}px`;
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
}
