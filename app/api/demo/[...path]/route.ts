import { type NextRequest } from "next/server";
import { getRuntime } from "../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function route(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const demo = getRuntime();
  if (!demo) {
    const status = request.method === "GET" && path.join("/") === "state";
    return Response.json(status ? {
      configured: false, session: false, sessionId: null, expiresAt: null, hasAccess: false, publicCode: "",
    } : { error: "This demo is not connected to BusinessMode yet." }, {
      status: status ? 200 : 503, headers: { "Cache-Control": "no-store" },
    });
  }
  return demo.handle(request, path);
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
