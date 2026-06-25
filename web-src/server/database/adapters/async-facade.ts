import type {
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
  DbOrder,
  DbTableInfo,
  DbValue,
  EsIndexInfo,
  EsMapping,
  EsSearchResult,
  RedisType,
} from "../../../core/database/types";
import type { DocSource, KvKeyEntry, KvSource } from "../sources/types";
import type { DatabaseAdapter, QueryResult, TriggerInfo } from "./types";

export function asAsync(adapter: DatabaseAdapter) {
  return {
    tables(signal?: AbortSignal): Promise<DbTableInfo[]> {
      return adapter.getTablesAsync(signal);
    },

    columns(table: string, signal?: AbortSignal): Promise<DbColumn[]> {
      return adapter.getColumnsAsync(table, signal);
    },

    columnsMulti(
      tables: string[],
      signal?: AbortSignal,
    ): Promise<Map<string, DbColumn[]>> {
      return adapter.getColumnsMultiAsync(tables, signal);
    },

    indexes(signal?: AbortSignal): Promise<DbIndexInfo[]> {
      return adapter.getIndexesAsync(signal);
    },

    foreignKeys(signal?: AbortSignal): Promise<DbForeignKey[]> {
      return adapter.getForeignKeysAsync(signal);
    },

    tableRowCount(table: string, signal?: AbortSignal): Promise<number> {
      return adapter.getTableRowCountAsync(table, signal);
    },

    tableRowCounts(
      tables: string[],
      signal?: AbortSignal,
    ): Promise<Map<string, number>> {
      return adapter.getTableRowCountsAsync(tables, signal);
    },

    tablePage(
      table: string,
      options: { offset: number; limit: number; orderBy?: DbOrder[] },
      signal?: AbortSignal,
    ): Promise<QueryResult> {
      return adapter.getTablePageAsync(table, options, signal);
    },

    readonlyQuery(
      sql: string,
      params?: DbValue[],
      maxRows?: number,
      signal?: AbortSignal,
    ): Promise<QueryResult> {
      return adapter.executeReadonlyQueryAsync(sql, params, maxRows, signal);
    },

    createStatement(table: string, signal?: AbortSignal): Promise<string> {
      return adapter.getCreateStatementAsync(table, signal);
    },

    triggers(table: string, signal?: AbortSignal): Promise<TriggerInfo[]> {
      return adapter.getTriggersAsync(table, signal);
    },
  };
}

export function asAsyncKv<TValue, TKeyType extends string = RedisType>(
  source: KvSource<TValue, TKeyType>,
) {
  return {
    listDatabases(
      signal?: AbortSignal,
    ): Promise<Array<{ index: number; keyCount: number }>> {
      return source.listDatabasesAsync(signal);
    },

    listKeys(opts: {
      db: number;
      pattern?: string;
      cursor?: string;
      count?: number;
      signal?: AbortSignal;
    }): Promise<{ keys: Array<KvKeyEntry<TKeyType>>; nextCursor: string }> {
      return source.listKeysAsync(opts);
    },

    getValue(opts: {
      db: number;
      key: string;
      signal?: AbortSignal;
    }): Promise<TValue> {
      return source.getValueAsync(opts);
    },
  };
}

export function asAsyncDoc(source: DocSource) {
  return {
    listIndices(signal?: AbortSignal): Promise<EsIndexInfo[]> {
      return source.listIndicesAsync(signal);
    },

    getMapping(index: string, signal?: AbortSignal): Promise<EsMapping> {
      return source.getMappingAsync(index, signal);
    },

    searchDocs(opts: {
      index: string;
      query?: string;
      size?: number;
      searchAfter?: unknown[];
      signal?: AbortSignal;
    }): Promise<EsSearchResult> {
      return source.searchDocsAsync(opts);
    },

    getDoc(opts: { index: string; id: string; signal?: AbortSignal }): Promise<{
      found: boolean;
      source: unknown;
      seqNo?: number;
      primaryTerm?: number;
    }> {
      return source.getDocAsync(opts);
    },
  };
}
