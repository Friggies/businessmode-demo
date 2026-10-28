import { createMachineClient, getRequestId } from "@businessmode/sdk";
import type { Config } from "./config";
import type { Assignment, Store } from "./store";

export class DemoError extends Error {
  constructor(public status: number, message: string, public requestId?: string | null) { super(message); }
}

export function businessmode(config: Config) {
  const client = createMachineClient({ baseUrl: config.apiUrl, apiKey: config.apiKey });
  return {
    async hasAccess(sessionId: string) {
      try {
        const { data, error, response } = await client.GET("/access", {
          params: { query: { externalUserId: externalUserId(sessionId), entitlementKey: config.entitlement } },
          signal: AbortSignal.timeout(8000), cache: "no-store",
        });
        if (error !== undefined || !data) throw serviceError(response);
        return data.hasAccess;
      } catch (error) { throw asServiceError(error); }
    },
    async redeem(sessionId: string, code: string): Promise<Assignment> {
      try {
        const { data, error, response } = await client.POST("/access-codes/redeem", {
          body: { code, externalUserId: externalUserId(sessionId) },
          signal: AbortSignal.timeout(8000),
        });
        if (error !== undefined || !data) {
          if (response.status === 429) throw new DemoError(429, "Too many attempts. Please wait a minute.", getRequestId(response));
          if ([400, 404, 409].includes(response.status)) {
            throw new DemoError(response.status, "This code could not grant access. Check the code or try the demo code.", getRequestId(response));
          }
          throw serviceError(response);
        }
        return { session: sessionId, license: data.licenseId, assignment: data.assignmentId };
      } catch (error) {
        if (error instanceof DemoError) throw error;
        // No automatic mutation retry. Retrying the same code and guest is domain-idempotent.
        throw new DemoError(503, "We could not confirm redemption. Retry the same code in this session.");
      }
    },
    async release(value: Assignment) {
      const { error, response } = await client.DELETE("/licenses/{licenseId}/assignments/{assignmentId}", {
        params: { path: { licenseId: value.license, assignmentId: value.assignment } },
        signal: AbortSignal.timeout(3000),
      });
      if (error !== undefined && response.status !== 404) throw serviceError(response);
    },
  };
}

export type AccessService = ReturnType<typeof businessmode>;
export function externalUserId(sessionId: string) { return `todo_demo:${sessionId}`; }

export async function cleanup(store: Store, access: AccessService) {
  for (const value of store.expiredAssignments()) {
    try { await access.release(value); store.forgetAssignment(value); }
    catch { /* Retain the handle for the next cleanup attempt; never log credentials or codes. */ }
  }
  store.prune();
}

function serviceError(response: Response) {
  return new DemoError(503, "BusinessMode is temporarily unavailable. Please try again.", getRequestId(response));
}
function asServiceError(error: unknown) {
  return error instanceof DemoError ? error : new DemoError(503, "We could not check access. Please try again.");
}
