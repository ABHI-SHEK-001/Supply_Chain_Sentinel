export type GraphParam = null | string | number | boolean | GraphParams | GraphParam[];
export type GraphParams = { [key: string]: GraphParam };

/** The slice of GraphManager that services depend on (easy to fake in tests). */
export interface GraphLike {
  query<T = unknown>(cypher: string, params?: GraphParams): Promise<{ data?: T[] | undefined }>;
  readQuery<T = unknown>(cypher: string, params?: GraphParams): Promise<{ data?: T[] | undefined }>;
}