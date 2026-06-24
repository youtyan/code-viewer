export type ImeKeyboardEventLike = {
  isComposing?: boolean;
  keyCode?: number;
};

export function isImeComposing(event: ImeKeyboardEventLike): boolean {
  return event.isComposing === true || event.keyCode === 229;
}
