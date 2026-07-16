export type OrderedInsertOptions = {
  before_id?: string;
  after_id?: string;
  position?: number;
};

export function orderedInsertOptionCount(input: OrderedInsertOptions): number {
  return (
    (input.before_id ? 1 : 0) +
    (input.after_id ? 1 : 0) +
    (input.position !== undefined ? 1 : 0)
  );
}
