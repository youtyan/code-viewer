import {
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";

/** Which part of the Data page failed; the console line starts with it. */
export type DatastoreFailureKind =
  | "S3"
  | "DynamoDB"
  | "Elasticsearch"
  | "Redis"
  | "SQL";

// 失敗の理由を err.message だけに潰すと、どの操作のどの対象で何が起きたかが
// 消える。console には error そのものと操作・対象を渡し、画面に出す文字列
// として cause の連鎖ごとの全文を返す。
export function reportDatastoreFailure(
  kind: DatastoreFailureKind,
  operation: string,
  error: unknown,
  ...context: unknown[]
): string {
  console.error(`[code-viewer] ${kind} ${operation} failed`, ...context, error);
  return formatErrorDetail(error);
}

/**
 * Throw a failed response as an error that names the operation, the HTTP
 * status and the body, so the caller's catch reports it like any other failure.
 */
export async function requireOkResponse(
  response: Response,
  operation: string,
): Promise<void> {
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, operation));
  }
}
