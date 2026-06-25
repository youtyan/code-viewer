export type SqlKind = "sqlite" | "postgresql" | "mysql";

export type FilterSql = {
  where: string;
  params: string[];
  useParams: boolean;
};

export function sanitizeIdentifier(
  name: string,
  kind: SqlKind = "sqlite",
): string {
  if (kind === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

export function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildFilterWhere(
  grouped: Map<string, string[]>,
  kind: SqlKind,
): FilterSql {
  const whereParts: string[] = [];
  const params: string[] = [];
  const useParams = kind === "sqlite";
  for (const [value, cols] of grouped) {
    const likeVal = useParams ? "?" : escapeSqlString(`%${value}%`);
    if (cols.length === 1) {
      const cast =
        kind === "mysql"
          ? `CAST(${sanitizeIdentifier(cols[0], kind)} AS CHAR)`
          : `CAST(${sanitizeIdentifier(cols[0], kind)} AS TEXT)`;
      whereParts.push(`${cast} LIKE ${likeVal}`);
      if (useParams) params.push(`%${value}%`);
    } else {
      const orParts = cols.map((column) => {
        const cast =
          kind === "mysql"
            ? `CAST(${sanitizeIdentifier(column, kind)} AS CHAR)`
            : `CAST(${sanitizeIdentifier(column, kind)} AS TEXT)`;
        return `${cast} LIKE ${likeVal}`;
      });
      whereParts.push(`(${orParts.join(" OR ")})`);
      if (useParams) {
        for (let i = 0; i < cols.length; i++) params.push(`%${value}%`);
      }
    }
  }
  return { where: whereParts.join(" AND "), params, useParams };
}

export function filterGroupedColumns(
  grouped: Map<string, string[]>,
  columnNames: Iterable<string>,
): Map<string, string[]> {
  const validColumns = new Set(columnNames);
  const filtered = new Map<string, string[]>();
  for (const [value, columns] of grouped) {
    const valid = columns.filter((column) => validColumns.has(column));
    if (valid.length > 0) filtered.set(value, valid);
  }
  return filtered;
}

export function filterOrderByColumns<T extends { column: string }>(
  orderBy: T[] | undefined,
  columnNames: Iterable<string>,
): T[] | undefined {
  if (!orderBy) return undefined;
  const validColumns = new Set(columnNames);
  const filtered = orderBy.filter((order) => validColumns.has(order.column));
  return filtered.length > 0 ? filtered : undefined;
}
