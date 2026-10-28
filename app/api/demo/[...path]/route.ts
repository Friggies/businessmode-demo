import { after, type NextRequest } from "next/server";
import { getRuntime } from "../../../../lib/runtime";
import { sampleTasks } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function route(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const demo = getRuntime();
  if (!demo) {
    const status = request.method === "GET" && path.join("/") === "state";
    return Response.json(status ? {
      configured: false, session: false, expiresAt: null, hasAccess: false, tasks: sampleTasks, publicCode: "",
    } : { error: "This demo is not connected to BusinessMode yet." }, {
      status: status ? 200 : 503, headers: { "Cache-Control": "no-store" },
    });
  }
  const response = await demo.handle(request, path);
  after(() => demo.cleanup());
  return response;
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
