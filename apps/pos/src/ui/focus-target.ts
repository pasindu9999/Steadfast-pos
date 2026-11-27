/** The element that takes focus back after every action: the scan box (ARCH §9). */
export interface FocusTarget {
  set: (element: HTMLElement | null) => void;
  focus: () => void;
}

export function createFocusTarget(): FocusTarget {
  let target: HTMLElement | null = null;
  return {
    set(element) {
      target = element;
    },
    focus() {
      target?.focus();
    },
  };
}
