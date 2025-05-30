import { components, paths } from "./apiSchema.generated";

export type RequestParamsType<
  Url extends keyof Paths,
  Method extends keyof Paths[Url],
  Paths = paths
> = OperationSchema<Url, Method, Paths>["parameters"] &
  OperationSchema<Url, Method, Paths>["requestBody"];

export type ResponseContent<
  Url extends keyof Paths,
  Method extends keyof Paths[Url],
  Paths
> = OperationSchema<
  Url,
  Method,
  Paths
>["responses"][200] extends NotNullAnyContent
  ? OperationSchema<Url, Method, Paths>["responses"][200]["content"]["*/*"]
  : OperationSchema<
      Url,
      Method,
      Paths
    >["responses"][200] extends NotNullJsonHalContent
  ? OperationSchema<
      Url,
      Method,
      Paths
    >["responses"][200]["content"]["application/hal+json"]
  : OperationSchema<
      Url,
      Method,
      Paths
    >["responses"][200] extends NotNullJsonContent
  ? OperationSchema<
      Url,
      Method,
      Paths
    >["responses"][200]["content"]["application/json"]
  : OperationSchema<
      Url,
      Method,
      Paths
    >["responses"][201] extends NotNullAnyContent
  ? OperationSchema<Url, Method, Paths>["responses"][201]["content"]["*/*"]
  : void;

type NotNullAnyContent = {
  content: {
    "*/*": any;
  };
};

type NotNullJsonHalContent = {
  content: {
    "application/hal+json": any;
  };
};

type NotNullJsonContent = {
  content: {
    "application/json": any;
  };
};

type ResponseType = {
  200?:
    | {
        content?: {
          "*/*"?: any;
          "application/json"?: any;
          "application/hal+json"?: any;
        };
      }
    | unknown;
  201?:
    | {
        content?: {
          "*/*"?: any;
        };
      }
    | unknown;
};

type OperationSchemaType = {
  requestBody?: {
    content?: {
      "multipart/form-data"?: { [key: string]: any };
      "application/json"?: any;
    };
  };
  parameters?: {
    path?: { [key: string]: any };
    query?: { [key: string]: { [key: string]: any } | any };
  };
  responses: ResponseType;
};

type OperationSchema<
  Url extends keyof Paths,
  Method extends keyof Paths[Url],
  Paths = paths
> = Paths[Url][Method] extends OperationSchemaType ? Paths[Url][Method] : never;

export type TranslationData = Record<
  string,
  Record<
    string,
    Omit<components["schemas"]["KeyWithTranslationsModel"], "translations"> & {
      translation: string;
    }
  >
>;
