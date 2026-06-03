import { ZodError, type ZodTypeAny, type z } from 'zod';
import { CkanApiError } from '../lib/errors.ts';
import {
  DatasetDetailsResponseSchema,
  EgovErrorEnvelopeSchema,
  ListDatasetsResponseSchema,
  ListOrganisationsResponseSchema,
  ListResourcesResponseSchema,
  ResourceDataResponseSchema,
} from './egov-bg-schema.ts';
import type { PortalHttp } from './http.ts';

export interface EgovBgClientOptions {
  /** Portal API base, e.g. "https://data.egov.bg/api/". */
  baseUrl: string;
  http: PortalHttp;
  /** Optional api_key (read endpoints are public; key is sent when provided). */
  apiKey?: string | undefined;
}

function joinUrl(base: string, method: string): string {
  return new URL(method, base.endsWith('/') ? base : `${base}/`).toString();
}

/**
 * Client for data.egov.bg's custom API (governmentbg/data-gov-bg): every method
 * is a POST to `<base>/<method>` with a JSON body and a `{success, ...}` envelope.
 */
export class EgovBgClient {
  private readonly baseUrl: string;
  private readonly http: PortalHttp;
  private readonly apiKey: string | undefined;

  constructor(opts: EgovBgClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.http = opts.http;
    this.apiKey = opts.apiKey;
  }

  private async call<S extends ZodTypeAny>(
    method: string,
    body: Record<string, unknown>,
    schema: S,
  ): Promise<z.infer<S>> {
    const url = joinUrl(this.baseUrl, method);
    const payload = this.apiKey ? { api_key: this.apiKey, ...body } : body;
    const res = await this.http.postJson<unknown>(url, payload);
    const err = EgovErrorEnvelopeSchema.safeParse(res.body);
    if (err.success) {
      const fieldErrors = err.data.errors ? ` ${JSON.stringify(err.data.errors)}` : '';
      throw new CkanApiError(
        `egov-bg ${method} failed: ${err.data.error?.type ?? 'error'}${fieldErrors}`,
        res.status,
        { action: method },
      );
    }
    try {
      return schema.parse(res.body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new CkanApiError(`egov-bg ${method} schema violation`, res.status, {
          action: method,
          issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      throw e;
    }
  }

  listDatasets(params: { recordsPerPage?: number; pageNumber?: number } = {}) {
    return this.call(
      'listDatasets',
      { records_per_page: params.recordsPerPage ?? 100, page_number: params.pageNumber ?? 1 },
      ListDatasetsResponseSchema,
    );
  }

  getDatasetDetails(datasetUri: string, locale = 'bg') {
    return this.call(
      'getDatasetDetails',
      { dataset_uri: datasetUri, locale },
      DatasetDetailsResponseSchema,
    );
  }

  listResources(datasetUri: string) {
    return this.call(
      'listResources',
      { criteria: { dataset_uri: datasetUri } },
      ListResourcesResponseSchema,
    );
  }

  getResourceData(resourceUri: string) {
    return this.call('getResourceData', { resource_uri: resourceUri }, ResourceDataResponseSchema);
  }

  listOrganisations(params: { recordsPerPage?: number; pageNumber?: number } = {}) {
    return this.call(
      'listOrganisations',
      {
        criteria: {},
        records_per_page: params.recordsPerPage ?? 100,
        page_number: params.pageNumber ?? 1,
      },
      ListOrganisationsResponseSchema,
    );
  }
}
